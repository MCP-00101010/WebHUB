#!/usr/bin/env python3
"""
Morpheus WebHub — native messaging host.
Handles file read/write and file-picker dialogs for the Firefox extension.
"""

import sys
import json
import struct
import os
import shutil
import time
import base64
import mimetypes
import urllib.request
import urllib.parse
import hashlib
import tempfile
import stat
import re
import platform
import subprocess
import secrets
from contextlib import contextmanager
from html.parser import HTMLParser
import ctypes
from ctypes import wintypes

HOST_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HOST_DIR, 'config.json')
MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
MAX_FAVICON_BYTES = 1024 * 1024
MAX_FAVICON_HTML_BYTES = 1024 * 1024
MAX_DATABASE_BACKUPS = 30
DATABASE_BACKUP_MIN_INTERVAL_SECONDS = 60
SECRET_TARGET_PREFIX = 'Morpheus WebHub/'
THEME_ID_PATTERN = re.compile(r'^[a-z0-9][a-z0-9_-]{0,79}$', re.IGNORECASE)


# ---------------------------------------------------------------------------
# Native messaging protocol (stdin/stdout, 4-byte length-prefixed JSON)
# ---------------------------------------------------------------------------

def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    length = struct.unpack('=I', raw)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode('utf-8'))


def send_message(obj):
    encoded = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('=I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def reply_ok(**kwargs):
    send_message({'ok': True, **kwargs})


def reply_err(msg):
    send_message({'ok': False, 'error': msg})


# ---------------------------------------------------------------------------
# Windows Credential Manager secrets
# ---------------------------------------------------------------------------

class FILETIME(ctypes.Structure):
    _fields_ = [
        ('dwLowDateTime', wintypes.DWORD),
        ('dwHighDateTime', wintypes.DWORD)
    ]


class CREDENTIALW(ctypes.Structure):
    _fields_ = [
        ('Flags', wintypes.DWORD),
        ('Type', wintypes.DWORD),
        ('TargetName', wintypes.LPWSTR),
        ('Comment', wintypes.LPWSTR),
        ('LastWritten', FILETIME),
        ('CredentialBlobSize', wintypes.DWORD),
        ('CredentialBlob', ctypes.POINTER(ctypes.c_byte)),
        ('Persist', wintypes.DWORD),
        ('AttributeCount', wintypes.DWORD),
        ('Attributes', ctypes.c_void_p),
        ('TargetAlias', wintypes.LPWSTR),
        ('UserName', wintypes.LPWSTR)
    ]


PCREDENTIALW = ctypes.POINTER(CREDENTIALW)
PPCREDENTIALW = ctypes.POINTER(PCREDENTIALW)
CRED_TYPE_GENERIC = 1
CRED_PERSIST_LOCAL_MACHINE = 2


def _credential_api():
    if sys.platform != 'win32':
        raise RuntimeError('Secret storage currently supports Windows only')
    advapi32 = ctypes.WinDLL('Advapi32', use_last_error=True)
    advapi32.CredWriteW.argtypes = [PCREDENTIALW, wintypes.DWORD]
    advapi32.CredWriteW.restype = wintypes.BOOL
    advapi32.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(PCREDENTIALW)]
    advapi32.CredReadW.restype = wintypes.BOOL
    advapi32.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
    advapi32.CredDeleteW.restype = wintypes.BOOL
    advapi32.CredEnumerateW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(PPCREDENTIALW)]
    advapi32.CredEnumerateW.restype = wintypes.BOOL
    advapi32.CredFree.argtypes = [ctypes.c_void_p]
    advapi32.CredFree.restype = None
    return advapi32


def _secret_target_name(key):
    key = (key or '').strip()
    if not key:
        raise ValueError('Secret key is required')
    if len(key) > 200 or any(ch in key for ch in '\r\n\0'):
        raise ValueError('Secret key is invalid')
    return SECRET_TARGET_PREFIX + key


def secret_status():
    return {
        'available': sys.platform == 'win32',
        'provider': 'windows-credential-manager' if sys.platform == 'win32' else '',
        'error': '' if sys.platform == 'win32' else 'Secret storage currently supports Windows only'
    }


def secret_set(key, value):
    advapi32 = _credential_api()
    target = _secret_target_name(key)
    blob = (value or '').encode('utf-16-le')
    blob_buffer = ctypes.create_string_buffer(blob)
    credential = CREDENTIALW()
    credential.Type = CRED_TYPE_GENERIC
    credential.TargetName = target
    credential.CredentialBlobSize = len(blob)
    credential.CredentialBlob = ctypes.cast(blob_buffer, ctypes.POINTER(ctypes.c_byte))
    credential.Persist = CRED_PERSIST_LOCAL_MACHINE
    credential.UserName = 'Morpheus WebHub'
    if not advapi32.CredWriteW(ctypes.byref(credential), 0):
        raise ctypes.WinError(ctypes.get_last_error())


def secret_get(key):
    advapi32 = _credential_api()
    target = _secret_target_name(key)
    credential_ptr = PCREDENTIALW()
    if not advapi32.CredReadW(target, CRED_TYPE_GENERIC, 0, ctypes.byref(credential_ptr)):
        error = ctypes.get_last_error()
        if error == 1168:
            return ''
        raise ctypes.WinError(error)
    try:
        credential = credential_ptr.contents
        if not credential.CredentialBlob or not credential.CredentialBlobSize:
            return ''
        raw = ctypes.string_at(credential.CredentialBlob, credential.CredentialBlobSize)
        return raw.decode('utf-16-le')
    finally:
        advapi32.CredFree(credential_ptr)


def secret_delete(key):
    advapi32 = _credential_api()
    target = _secret_target_name(key)
    if not advapi32.CredDeleteW(target, CRED_TYPE_GENERIC, 0):
        error = ctypes.get_last_error()
        if error != 1168:
            raise ctypes.WinError(error)


def secret_list():
    advapi32 = _credential_api()
    count = wintypes.DWORD()
    credentials = PPCREDENTIALW()
    if not advapi32.CredEnumerateW(SECRET_TARGET_PREFIX + '*', 0, ctypes.byref(count), ctypes.byref(credentials)):
        error = ctypes.get_last_error()
        if error == 1168:
            return []
        raise ctypes.WinError(error)
    try:
        keys = []
        for i in range(count.value):
            target = credentials[i].contents.TargetName or ''
            if target.startswith(SECRET_TARGET_PREFIX):
                keys.append(target[len(SECRET_TARGET_PREFIX):])
        return sorted(keys)
    finally:
        advapi32.CredFree(credentials)


# ---------------------------------------------------------------------------
# File picker — try tkinter, fall back to PowerShell on Windows
# ---------------------------------------------------------------------------

def _picker_filetypes(accept=''):
    if accept == 'image':
        return [('Image files', '*.png *.jpg *.jpeg *.gif *.webp *.svg *.bmp'), ('All files', '*.*')]
    if accept == 'json':
        return [('JSON files', '*.json'), ('All files', '*.*')]
    return [('All files', '*.*')]


def _windows_filter_string(accept=''):
    if accept == 'image':
        return 'Image Files (*.png,*.jpg,*.jpeg,*.gif,*.webp,*.bmp)|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp|All Files (*.*)|*.*'
    if accept == 'json':
        return 'JSON Files (*.json)|*.json|All Files (*.*)|*.*'
    return 'All Files (*.*)|*.*'


def open_file_picker(accept='', title='Select file'):
    """
    Open a system file dialog and return the selected path or None.
    """
    filetypes_tk = _picker_filetypes(accept)

    # --- try tkinter (cross-platform) ---
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes('-topmost', True)
        path = filedialog.askopenfilename(title=title, filetypes=filetypes_tk)
        root.destroy()
        if path:
            return path
    except Exception:
        pass

    # --- Windows fallback: PowerShell file dialog ---
    if sys.platform == 'win32':
        try:
            import subprocess
            filter_str = _windows_filter_string(accept)
            ps_script = (
                'Add-Type -AssemblyName System.Windows.Forms;'
                '$d = New-Object System.Windows.Forms.OpenFileDialog;'
                f'$d.Title = \'{title}\';'
                f'$d.Filter = \'{filter_str}\';'
                'if ($d.ShowDialog() -eq \'OK\') { Write-Output $d.FileName }'
            )
            result = subprocess.run(
                ['powershell', '-NonInteractive', '-Command', ps_script],
                capture_output=True, text=True, timeout=60
            )
            path = result.stdout.strip()
            if path:
                return path
        except Exception:
            pass

    return None


def save_file_picker(accept='json', title='Choose file', default_name='morpheus-webhub.json'):
    filetypes_tk = _picker_filetypes(accept)

    # --- Windows first: PowerShell save dialog in STA mode ---
    if sys.platform == 'win32':
        try:
            import subprocess
            filter_str = _windows_filter_string(accept)
            safe_default_name = (default_name or '').replace("'", "''")
            ps_script = (
                'Add-Type -AssemblyName System.Windows.Forms;'
                '$d = New-Object System.Windows.Forms.SaveFileDialog;'
                f'$d.Title = \'{title}\';'
                f'$d.Filter = \'{filter_str}\';'
                f'$d.FileName = \'{safe_default_name}\';'
                '$d.CheckPathExists = $true;'
                '$d.OverwritePrompt = $false;'
                '$d.AddExtension = $true;'
                '$d.DefaultExt = \'json\';'
                '$d.RestoreDirectory = $true;'
                'if ($d.ShowDialog() -eq \'OK\') { Write-Output $d.FileName }'
            )
            result = subprocess.run(
                ['powershell', '-STA', '-NonInteractive', '-Command', ps_script],
                capture_output=True, text=True, timeout=60
            )
            path = result.stdout.strip()
            if path:
                return path
        except Exception:
            pass

    # --- try tkinter (cross-platform) ---
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes('-topmost', True)
        path = filedialog.asksaveasfilename(
            title=title,
            filetypes=filetypes_tk,
            defaultextension='.json' if accept == 'json' else '',
            initialfile=default_name or ''
        )
        root.destroy()
        if path:
            return path
    except Exception:
        pass

    return None


def file_to_data_url(path):
    mime, _ = mimetypes.guess_type(path)
    if not mime:
        mime = 'application/octet-stream'
    with open(path, 'rb') as f:
        data = base64.b64encode(f.read()).decode('ascii')
    return f'data:{mime};base64,{data}'


class FaviconLinkParser(HTMLParser):
    def __init__(self, base_url):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != 'link':
            return
        data = {str(k).lower(): (v or '') for k, v in attrs}
        rel_tokens = set((data.get('rel') or '').lower().split())
        if not rel_tokens.intersection({'icon', 'shortcut', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'mask-icon'}):
            return
        href = (data.get('href') or '').strip()
        if not href:
            return
        self.links.append({
            'url': urllib.parse.urljoin(self.base_url, href),
            'rel': ' '.join(sorted(rel_tokens)),
            'type': (data.get('type') or '').strip().lower(),
            'sizes': (data.get('sizes') or '').strip().lower()
        })


def _request_headers(accept):
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0 MorpheusWebHub/1.0',
        'Accept': accept,
        'Accept-Language': 'en-US,en;q=0.8'
    }


def _read_response_limited(response, max_bytes):
    chunks = []
    total = 0
    while True:
        chunk = response.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise ValueError('Response was too large')
        chunks.append(chunk)
    return b''.join(chunks)


def _guess_mime_from_url(url, content_type=''):
    mime = (content_type or '').split(';', 1)[0].strip().lower()
    if mime:
        return mime
    path = urllib.parse.urlparse(url or '').path or ''
    guessed, _ = mimetypes.guess_type(path)
    return guessed or 'image/x-icon'


def _favicon_size_score(sizes):
    if not sizes or sizes == 'any':
        return 48
    best = 0
    for part in sizes.split():
        pieces = part.lower().split('x', 1)
        if len(pieces) != 2:
            continue
        try:
            best = max(best, min(int(pieces[0]), int(pieces[1])))
        except ValueError:
            continue
    if best >= 128:
        return 80
    if best >= 64:
        return 70
    if best >= 32:
        return 55
    if best >= 16:
        return 35
    return 20


def _favicon_candidate_score(candidate, index):
    rel = candidate.get('rel', '')
    type_name = candidate.get('type', '')
    url = candidate.get('url', '')
    score = 0
    if 'apple-touch-icon' in rel:
        score += 90
    if 'icon' in rel:
        score += 80
    if 'mask-icon' in rel:
        score += 35
    score += _favicon_size_score(candidate.get('sizes', ''))
    if 'svg' in type_name or url.lower().split('?', 1)[0].endswith('.svg'):
        score += 12
    elif 'png' in type_name or url.lower().split('?', 1)[0].endswith('.png'):
        score += 10
    elif 'webp' in type_name or url.lower().split('?', 1)[0].endswith('.webp'):
        score += 9
    elif 'ico' in type_name or url.lower().split('?', 1)[0].endswith('.ico'):
        score += 7
    return score - index


def _download_favicon_candidate(url, max_bytes):
    parsed = urllib.parse.urlparse(url or '')
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Only http and https favicon URLs are supported')
    request = urllib.request.Request(
        url,
        headers=_request_headers('image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/*;q=0.8,*/*;q=0.4')
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        content_type = (response.headers.get('Content-Type') or '').split(';', 1)[0].strip().lower()
        data = _read_response_limited(response, max_bytes)
    if not data:
        raise ValueError('Favicon was empty')
    mime = _guess_mime_from_url(url, content_type)
    if not (mime.startswith('image/') or mime in ('application/octet-stream', 'binary/octet-stream')):
        raise ValueError(f'Favicon URL did not return an image ({mime})')
    if mime in ('application/octet-stream', 'binary/octet-stream'):
        mime = _guess_mime_from_url(url)
    return {
        'dataUrl': f'data:{mime};base64,{base64.b64encode(data).decode("ascii")}',
        'iconUrl': url,
        'contentType': mime,
        'bytes': len(data)
    }


def fetch_favicon(url, max_bytes=MAX_FAVICON_BYTES):
    parsed = urllib.parse.urlparse(url or '')
    if parsed.scheme not in ('http', 'https') or not parsed.netloc:
        raise ValueError('Only http and https page URLs are supported')

    page_url = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, parsed.path or '/', '', parsed.query, ''))
    origin = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, '', '', '', ''))
    candidates = []
    errors = []

    try:
        request = urllib.request.Request(page_url, headers=_request_headers('text/html,application/xhtml+xml;q=0.9,*/*;q=0.3'))
        with urllib.request.urlopen(request, timeout=20) as response:
            content_type = (response.headers.get('Content-Type') or '').split(';', 1)[0].strip().lower()
            charset = response.headers.get_content_charset() or 'utf-8'
            if content_type and 'html' not in content_type and 'xml' not in content_type:
                raise ValueError(f'Page did not return HTML ({content_type})')
            html = _read_response_limited(response, MAX_FAVICON_HTML_BYTES).decode(charset, errors='replace')
        parser = FaviconLinkParser(response.geturl() or page_url)
        parser.feed(html)
        candidates.extend(parser.links)
    except Exception as exc:
        errors.append(str(exc))

    fallback_paths = [
        '/favicon.ico',
        '/favicon.png',
        '/favicon.svg',
        '/apple-touch-icon.png',
        '/apple-touch-icon-precomposed.png',
        '/favicon-32x32.png',
        '/favicon-16x16.png',
        '/android-chrome-192x192.png',
        '/android-chrome-512x512.png'
    ]
    candidates.extend({'url': urllib.parse.urljoin(origin, path), 'rel': 'fallback icon', 'type': '', 'sizes': ''} for path in fallback_paths)

    seen = set()
    unique = []
    for candidate in candidates:
        candidate_url = (candidate.get('url') or '').strip()
        if not candidate_url or candidate_url in seen:
            continue
        seen.add(candidate_url)
        unique.append({**candidate, 'url': candidate_url})

    sorted_candidates = sorted(enumerate(unique), key=lambda pair: _favicon_candidate_score(pair[1], pair[0]), reverse=True)
    for _, candidate in sorted_candidates:
        try:
            return _download_favicon_candidate(candidate['url'], max_bytes)
        except Exception as exc:
            errors.append(f'{candidate["url"]}: {exc}')

    raise ValueError('No favicon found' + (f': {errors[-1]}' if errors else ''))


def download_url_to_file(url, path, temp_path, max_bytes=MAX_DOWNLOAD_BYTES):
    parsed = urllib.parse.urlparse(url or '')
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Only http and https image URLs can be cached as assets')

    request = urllib.request.Request(
        url,
        headers=_request_headers('image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,image/*;q=0.8,*/*;q=0.5')
    )
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    os.makedirs(os.path.dirname(os.path.abspath(temp_path)), exist_ok=True)
    written = 0
    content_type = ''
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            content_type = (response.headers.get('Content-Type') or '').split(';', 1)[0].strip().lower()
            if content_type and not content_type.startswith('image/'):
                raise ValueError(f'URL did not return an image ({content_type})')
            with open(temp_path, 'wb') as f:
                while True:
                    chunk = response.read(128 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > max_bytes:
                        raise ValueError('Image is too large to cache')
                    f.write(chunk)
        if written <= 0:
            raise ValueError('Downloaded image was empty')
        os.replace(temp_path, path)
        return {'bytes': written, 'contentType': content_type}
    finally:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass


def hash_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def hash_text(content):
    return hashlib.sha256((content or '').encode('utf-8')).hexdigest()


def get_file_info(path, include_hash=False):
    normalized = str(path or '').strip()
    if not normalized:
        return {
            'exists': False,
            'version': None,
            'modifiedMs': None,
            'size': None
        }
    try:
        file_stat = os.stat(normalized)
        if not os.path.isfile(normalized):
            return {
                'exists': False,
                'version': None,
                'modifiedMs': None,
                'size': None
            }
        info = {
            'exists': True,
            'version': f'{file_stat.st_mtime_ns}:{file_stat.st_size}',
            'modifiedMs': int(file_stat.st_mtime_ns / 1_000_000),
            'size': file_stat.st_size
        }
        if include_hash:
            for _attempt in range(3):
                content_hash = hash_file(normalized)
                verified_stat = os.stat(normalized)
                if (
                    verified_stat.st_mtime_ns == file_stat.st_mtime_ns
                    and verified_stat.st_size == file_stat.st_size
                ):
                    info['contentHash'] = content_hash
                    break
                file_stat = verified_stat
                info.update({
                    'version': f'{file_stat.st_mtime_ns}:{file_stat.st_size}',
                    'modifiedMs': int(file_stat.st_mtime_ns / 1_000_000),
                    'size': file_stat.st_size
                })
            else:
                info['contentHash'] = hash_file(normalized)
        return info
    except FileNotFoundError:
        return {
            'exists': False,
            'version': None,
            'modifiedMs': None,
            'size': None
        }


def resolve_theme_path(themes_dir, theme_id):
    directory = os.path.abspath(str(themes_dir or '').strip())
    identifier = str(theme_id or '').strip()
    if not directory or not THEME_ID_PATTERN.fullmatch(identifier):
        raise ValueError('Theme ID must contain only letters, numbers, hyphens, or underscores')
    target = os.path.abspath(os.path.join(directory, f'{identifier}.json'))
    if os.path.commonpath([directory, target]) != directory:
        raise ValueError('Theme path escapes the configured themes directory')
    return target


def read_file_chunk(path, offset=0, length=512 * 1024, expected_version=None):
    offset = max(0, int(offset or 0))
    length = max(1, min(768 * 1024, int(length or 512 * 1024)))
    before = get_file_info(path, include_hash=offset == 0)
    if not before['exists']:
        return {
            'chunk': '', 'offset': offset, 'nextOffset': offset,
            'totalSize': 0, 'done': True, 'fileInfo': before,
            'readVersion': None
        }
    if expected_version and before.get('version') != expected_version:
        raise RuntimeError('Shared database changed during chunked read; retry required')
    with open(path, 'rb') as source:
        source.seek(offset)
        data = source.read(length)
    after = get_file_info(path)
    if before.get('version') != after.get('version'):
        raise RuntimeError('Shared database changed during chunked read; retry required')
    next_offset = offset + len(data)
    total_size = before.get('size') or 0
    return {
        'chunk': base64.b64encode(data).decode('ascii'),
        'offset': offset,
        'nextOffset': next_offset,
        'totalSize': total_size,
        'done': next_offset >= total_size,
        'fileInfo': before,
        'readVersion': before.get('version')
    }


@contextmanager
def database_write_lock(path, timeout_seconds=15):
    lock_path = f'{os.path.abspath(path)}.lock'
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    lock_file = open(lock_path, 'a+b')
    if os.path.getsize(lock_path) == 0:
        lock_file.write(b'\0')
        lock_file.flush()
    deadline = time.monotonic() + timeout_seconds
    locked = False
    try:
        while not locked:
            try:
                lock_file.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                locked = True
            except (OSError, IOError):
                if time.monotonic() >= deadline:
                    raise TimeoutError('Timed out waiting for the shared database write lock')
                time.sleep(0.05)
        yield
    finally:
        if locked:
            try:
                lock_file.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            except (OSError, IOError):
                pass
        lock_file.close()


def atomic_write_text(path, content):
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    existing_mode = None
    try:
        existing_mode = stat.S_IMODE(os.stat(path).st_mode)
    except FileNotFoundError:
        pass
    fd, temp_path = tempfile.mkstemp(prefix=f'.{os.path.basename(path)}.', suffix='.tmp', dir=directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as target:
            target.write(content)
            target.flush()
            os.fsync(target.fileno())
        if existing_mode is not None:
            os.chmod(temp_path, existing_mode)
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def write_file_if_unchanged(path, content, expected_version=None, expected_hash=''):
    with database_write_lock(path):
        current_info = get_file_info(path, include_hash=True)
        incoming_hash = hash_text(content)
        version_matches = current_info['version'] == expected_version
        creating_new = expected_version is None and not current_info['exists']
        baseline_content_unchanged = bool(
            expected_hash and current_info.get('contentHash') == expected_hash
        )
        if not version_matches and not creating_new and not baseline_content_unchanged:
            if current_info.get('contentHash') == incoming_hash:
                return {
                    'conflict': False,
                    'alreadyCurrent': True,
                    'fileInfo': current_info
                }
            return {'conflict': True, 'fileInfo': current_info}

        if current_info['exists'] and os.path.splitext(path)[1].lower() == '.json':
            with open(path, 'r', encoding='utf-8') as source:
                existing_content = source.read()
            if replacement_looks_dangerously_smaller(content, existing_content):
                raise ValueError('Refusing to overwrite a large shared database with a much smaller browser cache')

        backup_path = backup_database_file(path)
        atomic_write_text(path, content)
        return {
            'conflict': False,
            'fileInfo': get_file_info(path, include_hash=True),
            'backupPath': backup_path
        }


def summarize_hub_content(content):
    summary = {
        'valid': False,
        'bytes': len(content or ''),
        'boards': 0,
        'bookmarks': 0,
        'folders': 0,
        'titles': 0,
        'importItems': 0
        , 'schemaVersion': 0
        , 'tabs': 0
        , 'sets': 0
        , 'tags': 0
        , 'settings': 0
    }
    try:
        data = json.loads(content or '{}')
    except Exception:
        return summary

    summary['valid'] = isinstance(data, dict)
    if not isinstance(data, dict):
        return summary

    boards = data.get('boards')
    summary['boards'] = len(boards) if isinstance(boards, list) else 0
    summary['schemaVersion'] = int(data.get('schemaVersion') or 0)
    summary['sets'] = len(data.get('sets')) if isinstance(data.get('sets'), list) else 0
    summary['tags'] = len(data.get('tags')) if isinstance(data.get('tags'), list) else 0
    summary['settings'] = len(data.get('settings')) if isinstance(data.get('settings'), dict) else 0
    if isinstance(boards, list):
        summary['tabs'] = sum(len(board.get('tabs', [])) for board in boards if isinstance(board, dict) and isinstance(board.get('tabs'), list))

    import_manager = data.get('importManager')
    import_items = import_manager.get('items') if isinstance(import_manager, dict) else None
    summary['importItems'] = len(import_items) if isinstance(import_items, list) else 0

    def walk(value):
        if isinstance(value, list):
            for item in value:
                walk(item)
            return
        if not isinstance(value, dict):
            return
        item_type = value.get('type')
        if item_type == 'bookmark':
            summary['bookmarks'] += 1
        elif item_type == 'folder':
            summary['folders'] += 1
        elif item_type == 'title':
            summary['titles'] += 1
        for child in value.values():
            walk(child)

    walk(boards)
    walk(import_items)
    return summary


def hub_content_count(summary):
    return (
        summary.get('boards', 0)
        + summary.get('bookmarks', 0)
        + summary.get('folders', 0)
        + summary.get('titles', 0)
        + summary.get('importItems', 0)
    )


def replacement_looks_dangerously_smaller(new_content, existing_content):
    existing = summarize_hub_content(existing_content)
    incoming = summarize_hub_content(new_content)
    existing_count = hub_content_count(existing)
    incoming_count = hub_content_count(incoming)
    if not existing.get('valid'):
        return False
    if existing.get('bytes', 0) < 100000 or existing_count < 50:
        return False
    if not incoming.get('valid'):
        return True
    if incoming.get('bytes', 0) >= existing.get('bytes', 0) * 0.25:
        return False
    if incoming_count >= existing_count * 0.5:
        return False
    return True


def backup_database_file(path, force=False):
    normalized = str(path or '').strip()
    if not normalized or not os.path.isfile(normalized):
        return None
    if os.path.getsize(normalized) <= 0:
        return None
    if os.path.splitext(normalized)[1].lower() != '.json':
        return None

    backup_dir = os.path.join(os.path.dirname(os.path.abspath(normalized)), 'backups')
    os.makedirs(backup_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(normalized))[0]
    existing_backups = sorted(
        (
            os.path.join(backup_dir, name)
            for name in os.listdir(backup_dir)
            if name.startswith(f'{stem}.before-write.') and name.endswith('.json')
        ),
        key=lambda item: os.path.getmtime(item),
        reverse=True
    )
    if not force and existing_backups and time.time() - os.path.getmtime(existing_backups[0]) < DATABASE_BACKUP_MIN_INTERVAL_SECONDS:
        return existing_backups[0]
    timestamp = time.strftime('%Y%m%d-%H%M%S')
    backup_path = os.path.join(backup_dir, f'{stem}.before-write.{timestamp}.json')
    suffix = 1
    while os.path.exists(backup_path):
        backup_path = os.path.join(backup_dir, f'{stem}.before-write.{timestamp}-{suffix}.json')
        suffix += 1
    shutil.copy2(normalized, backup_path)

    backups = [backup_path, *existing_backups]
    for old_path in backups[MAX_DATABASE_BACKUPS:]:
        try:
            os.remove(old_path)
        except Exception:
            pass
    return backup_path


def database_backup_dir(database_path):
    normalized = os.path.abspath(str(database_path or '').strip())
    if not normalized or os.path.splitext(normalized)[1].lower() != '.json':
        raise ValueError('A JSON database path is required')
    return os.path.join(os.path.dirname(normalized), 'backups')


def resolve_database_backup_path(database_path, name):
    backup_dir = os.path.abspath(database_backup_dir(database_path))
    safe_name = os.path.basename(str(name or '').strip())
    stem = os.path.splitext(os.path.basename(str(database_path)))[0]
    if safe_name != name or not safe_name.startswith(f'{stem}.before-write.') or not safe_name.endswith('.json'):
        raise ValueError('Invalid database backup name')
    target = os.path.abspath(os.path.join(backup_dir, safe_name))
    if os.path.commonpath([backup_dir, target]) != backup_dir:
        raise ValueError('Backup path escapes the configured backup directory')
    return target


def list_database_backups(database_path):
    backup_dir = database_backup_dir(database_path)
    if not os.path.isdir(backup_dir):
        return []
    stem = os.path.splitext(os.path.basename(str(database_path)))[0]
    output = []
    for name in os.listdir(backup_dir):
        if not name.startswith(f'{stem}.before-write.') or not name.endswith('.json'):
            continue
        try:
            path = resolve_database_backup_path(database_path, name)
            with open(path, 'r', encoding='utf-8') as source:
                content = source.read()
            summary = summarize_hub_content(content)
            info = get_file_info(path, include_hash=True)
            output.append({
                'name': name,
                'size': info.get('size'),
                'modifiedMs': info.get('modifiedMs'),
                'version': info.get('version'),
                'contentHash': info.get('contentHash'),
                'integrity': 'ok' if summary.get('valid') else 'invalid-json',
                'summary': summary
            })
        except Exception as error:
            output.append({'name': name, 'integrity': f'unreadable: {error}', 'summary': {}})
    return sorted(output, key=lambda item: item.get('modifiedMs') or 0, reverse=True)


def read_database_backup_chunk(database_path, name, offset=0, length=512 * 1024, expected_version=None):
    path = resolve_database_backup_path(database_path, name)
    result = read_file_chunk(path, offset, length, expected_version)
    if int(offset or 0) == 0:
        with open(path, 'r', encoding='utf-8') as source:
            result['summary'] = summarize_hub_content(source.read())
    return result


def load_config():
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except FileNotFoundError:
        return {}
    except Exception:
        return {}
    return {}


def save_config(config):
    config = config or {}
    approved = config.get('approvedDirectories')
    if approved is None:
        approved = load_config().get('approvedDirectories', {})
    if not isinstance(approved, dict):
        approved = {}
    safe_approved = {}
    for handle, entry in list(approved.items())[:64]:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{12,80}', str(handle)) or not isinstance(entry, dict):
            continue
        path = os.path.realpath(str(entry.get('path', '') or ''))
        purpose = str(entry.get('purpose', '') or '')
        if not path or purpose not in {'git', 'recent-files'}:
            continue
        safe_approved[str(handle)] = {
            'path': path, 'purpose': purpose, 'label': str(entry.get('label', '') or os.path.basename(path) or path)[:160],
            'approvedAt': int(entry.get('approvedAt', 0) or 0)
        }
    data = {
        'databasePath': config.get('databasePath', '') or '',
        'approvedDirectories': safe_approved
    }
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


# ---------------------------------------------------------------------------
# Fixed-purpose system metrics (no arbitrary commands or process details)
# ---------------------------------------------------------------------------

def _cpu_snapshot():
    if sys.platform == 'win32':
        idle = FILETIME()
        kernel = FILETIME()
        user = FILETIME()
        if not ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
            return None
        value = lambda part: (part.dwHighDateTime << 32) | part.dwLowDateTime
        return value(idle), value(kernel), value(user)
    try:
        with open('/proc/stat', 'r', encoding='ascii') as source:
            parts = source.readline().split()[1:]
        values = [int(value) for value in parts]
        return values[3] + (values[4] if len(values) > 4 else 0), sum(values)
    except Exception:
        return None


def _cpu_percent():
    first = _cpu_snapshot()
    if first is None:
        load = os.getloadavg()[0] if hasattr(os, 'getloadavg') else 0
        return round(min(100.0, max(0.0, load * 100.0 / max(1, os.cpu_count() or 1))), 1)
    time.sleep(0.1)
    second = _cpu_snapshot()
    if second is None:
        return None
    if sys.platform == 'win32':
        idle_delta = second[0] - first[0]
        total_delta = (second[1] - first[1]) + (second[2] - first[2])
    else:
        idle_delta = second[0] - first[0]
        total_delta = second[1] - first[1]
    return round(max(0.0, min(100.0, 100.0 * (1.0 - idle_delta / max(1, total_delta)))), 1)


def _memory_metrics():
    if sys.platform == 'win32':
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [('dwLength', wintypes.DWORD), ('dwMemoryLoad', wintypes.DWORD),
                        ('ullTotalPhys', ctypes.c_ulonglong), ('ullAvailPhys', ctypes.c_ulonglong),
                        ('ullTotalPageFile', ctypes.c_ulonglong), ('ullAvailPageFile', ctypes.c_ulonglong),
                        ('ullTotalVirtual', ctypes.c_ulonglong), ('ullAvailVirtual', ctypes.c_ulonglong),
                        ('ullAvailExtendedVirtual', ctypes.c_ulonglong)]
        status = MEMORYSTATUSEX()
        status.dwLength = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return {'percent': float(status.dwMemoryLoad), 'usedBytes': int(status.ullTotalPhys - status.ullAvailPhys),
                    'totalBytes': int(status.ullTotalPhys), 'availableBytes': int(status.ullAvailPhys)}
    try:
        values = {}
        with open('/proc/meminfo', 'r', encoding='ascii') as source:
            for line in source:
                key, value = line.split(':', 1)
                values[key] = int(value.strip().split()[0]) * 1024
        total = values.get('MemTotal', 0)
        available = values.get('MemAvailable', values.get('MemFree', 0))
        return {'percent': round(100.0 * (total - available) / max(1, total), 1),
                'usedBytes': total - available, 'totalBytes': total, 'availableBytes': available}
    except Exception:
        return None


def _disk_metrics():
    roots = []
    if sys.platform == 'win32':
        mask = ctypes.windll.kernel32.GetLogicalDrives()
        roots = [f'{chr(65 + index)}:\\' for index in range(26) if mask & (1 << index)]
    else:
        roots = ['/']
        try:
            with open('/proc/mounts', 'r', encoding='utf-8') as source:
                for line in source:
                    parts = line.split()
                    if len(parts) >= 3 and parts[2] in {'ext4', 'xfs', 'btrfs', 'zfs', 'apfs'}:
                        roots.append(parts[1].replace('\\040', ' '))
        except Exception:
            pass
    disks = []
    for root in dict.fromkeys(roots):
        try:
            usage = shutil.disk_usage(root)
            disks.append({'name': root, 'totalBytes': usage.total, 'usedBytes': usage.used,
                          'freeBytes': usage.free, 'percent': round(100.0 * usage.used / max(1, usage.total), 1)})
        except Exception:
            continue
        if len(disks) >= 16:
            break
    return disks


def _network_metrics():
    try:
        if sys.platform.startswith('linux'):
            received = sent = 0
            with open('/proc/net/dev', 'r', encoding='ascii') as source:
                for line in source.readlines()[2:]:
                    _, values = line.split(':', 1)
                    fields = values.split()
                    received += int(fields[0])
                    sent += int(fields[8])
            return {'receivedBytes': received, 'sentBytes': sent}
        if sys.platform == 'win32':
            result = subprocess.run(['netstat', '-e'], capture_output=True, text=True, timeout=3,
                                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            for line in result.stdout.splitlines():
                if line.strip().lower().startswith('bytes'):
                    values = re.findall(r'\d+', line)
                    if len(values) >= 2:
                        return {'receivedBytes': int(values[0]), 'sentBytes': int(values[1])}
    except Exception:
        pass
    return None


def _battery_metrics():
    if sys.platform != 'win32':
        return None
    class SYSTEM_POWER_STATUS(ctypes.Structure):
        _fields_ = [('ACLineStatus', ctypes.c_ubyte), ('BatteryFlag', ctypes.c_ubyte),
                    ('BatteryLifePercent', ctypes.c_ubyte), ('SystemStatusFlag', ctypes.c_ubyte),
                    ('BatteryLifeTime', wintypes.DWORD), ('BatteryFullLifeTime', wintypes.DWORD)]
    status = SYSTEM_POWER_STATUS()
    if not ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(status)) or status.BatteryFlag == 128:
        return None
    return {'percent': None if status.BatteryLifePercent == 255 else int(status.BatteryLifePercent),
            'charging': status.ACLineStatus == 1, 'secondsRemaining': None if status.BatteryLifeTime == 0xFFFFFFFF else int(status.BatteryLifeTime)}


def collect_system_metrics(requested):
    allowed = {'cpu', 'memory', 'disk', 'network', 'uptime', 'battery', 'platform'}
    selected = [name for name in (requested or []) if name in allowed][:len(allowed)]
    result = {'sampledAt': int(time.time() * 1000)}
    if 'cpu' in selected:
        result['cpu'] = {'percent': _cpu_percent(), 'cores': os.cpu_count() or 1}
    if 'memory' in selected:
        result['memory'] = _memory_metrics()
    if 'disk' in selected:
        result['disk'] = _disk_metrics()
    if 'network' in selected:
        result['network'] = _network_metrics()
    if 'uptime' in selected:
        result['uptime'] = {'seconds': int(ctypes.windll.kernel32.GetTickCount64() / 1000) if sys.platform == 'win32' else int(time.monotonic())}
    if 'battery' in selected:
        result['battery'] = _battery_metrics()
    if 'platform' in selected:
        result['platform'] = {'system': platform.system(), 'release': platform.release(), 'machine': platform.machine()}
    return result


# ---------------------------------------------------------------------------
# User-approved directory handles and fixed repository/file operations
# ---------------------------------------------------------------------------

def open_directory_picker(title='Select folder'):
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes('-topmost', True)
        path = filedialog.askdirectory(title=str(title or 'Select folder')[:160], mustexist=True)
        root.destroy()
        if path:
            return path
    except Exception:
        pass
    if sys.platform == 'win32':
        try:
            safe_title = str(title or 'Select folder')[:160].replace("'", "''")
            script = ('Add-Type -AssemblyName System.Windows.Forms;'
                      '$d = New-Object System.Windows.Forms.FolderBrowserDialog;'
                      f'$d.Description = \'{safe_title}\';'
                      'if ($d.ShowDialog() -eq \'OK\') { Write-Output $d.SelectedPath }')
            result = subprocess.run(['powershell', '-STA', '-NonInteractive', '-Command', script],
                                    capture_output=True, text=True, timeout=60,
                                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if result.stdout.strip():
                return result.stdout.strip()
        except Exception:
            pass
    return None


def approve_directory(purpose, title='Select folder', selected_path=None):
    if purpose not in {'git', 'recent-files'}:
        raise ValueError('Unsupported directory approval purpose')
    path = os.path.realpath(selected_path or open_directory_picker(title) or '')
    if not path:
        return None
    if not os.path.isdir(path):
        raise ValueError('The selected directory is unavailable')
    config = load_config()
    approved = config.setdefault('approvedDirectories', {})
    for handle, entry in approved.items():
        if entry.get('purpose') == purpose and os.path.normcase(os.path.realpath(entry.get('path', ''))) == os.path.normcase(path):
            return {'handle': handle, 'label': entry.get('label') or os.path.basename(path) or path, 'path': path, 'purpose': purpose}
    handle = f'dir_{secrets.token_urlsafe(18)}'
    label = os.path.basename(path.rstrip('\\/')) or path
    approved[handle] = {'path': path, 'purpose': purpose, 'label': label, 'approvedAt': int(time.time() * 1000)}
    save_config(config)
    return {'handle': handle, 'label': label, 'path': path, 'purpose': purpose}


def resolve_approved_directory(handle, purpose=None, require_exists=True):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{12,80}', str(handle or '')):
        raise ValueError('Directory approval handle is invalid')
    entry = load_config().get('approvedDirectories', {}).get(str(handle))
    if not isinstance(entry, dict):
        raise ValueError('Directory approval was not found')
    if purpose and entry.get('purpose') != purpose:
        raise ValueError('Directory approval does not grant this capability')
    path = os.path.realpath(entry.get('path', ''))
    if require_exists and not os.path.isdir(path):
        raise FileNotFoundError('The approved directory is missing or unavailable')
    return path, entry


def _run_git(path, arguments, timeout=8):
    result = subprocess.run(['git', '-C', path, *arguments], capture_output=True, text=True,
                            encoding='utf-8', errors='replace', timeout=timeout,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    output = (result.stdout or '')[:1024 * 1024]
    error = (result.stderr or '')[:4096]
    if result.returncode != 0:
        raise RuntimeError(error.strip() or 'Git command failed')
    return output


def _git_remote_link(remote):
    value = str(remote or '').strip()
    if value.startswith('git@') and ':' in value:
        host, repo = value[4:].split(':', 1)
        value = f'https://{host}/{repo}'
    elif value.startswith('ssh://git@'):
        value = 'https://' + value[len('ssh://git@'):]
    if not value.startswith('https://'):
        return ''
    return value[:-4] if value.endswith('.git') else value


def git_workspace_status(handle):
    path, entry = resolve_approved_directory(handle, 'git')
    status = _run_git(path, ['status', '--porcelain=v2', '--branch', '--untracked-files=normal'])
    branch = ''
    detached = False
    ahead = behind = staged = unstaged = untracked = 0
    for line in status.splitlines():
        if line.startswith('# branch.head '):
            branch = line[len('# branch.head '):].strip()
            detached = branch == '(detached)'
        elif line.startswith('# branch.ab '):
            match = re.search(r'\+(\d+)\s+-(\d+)', line)
            if match:
                ahead, behind = int(match.group(1)), int(match.group(2))
        elif line.startswith('? '):
            untracked += 1
            unstaged += 1
        elif line.startswith(('1 ', '2 ', 'u ')):
            parts = line.split()
            xy = parts[1] if len(parts) > 1 else '..'
            if len(xy) >= 1 and xy[0] not in {'.', ' '}:
                staged += 1
            if len(xy) >= 2 and xy[1] not in {'.', ' '}:
                unstaged += 1
    try:
        commit = _run_git(path, ['log', '-1', '--format=%H%x1f%h%x1f%ct%x1f%s']).strip().split('\x1f')
    except Exception:
        commit = []
    try:
        remote = _run_git(path, ['remote', 'get-url', 'origin']).strip()
    except Exception:
        remote = ''
    return {
        'handle': handle, 'label': entry.get('label') or os.path.basename(path), 'path': path,
        'branch': branch or 'HEAD', 'detached': detached, 'ahead': ahead, 'behind': behind,
        'staged': staged, 'unstaged': unstaged, 'untracked': untracked, 'clean': staged == 0 and unstaged == 0,
        'lastCommit': {'hash': commit[0] if len(commit) > 0 else '', 'shortHash': commit[1] if len(commit) > 1 else '',
                       'timestamp': int(commit[2]) * 1000 if len(commit) > 2 and commit[2].isdigit() else 0,
                       'subject': commit[3][:300] if len(commit) > 3 else ''},
        'remoteUrl': _git_remote_link(remote), 'sampledAt': int(time.time() * 1000)
    }


def _launch_terminal(path):
    if sys.platform == 'win32':
        windows_terminal = shutil.which('wt.exe')
        if windows_terminal:
            try:
                subprocess.Popen([windows_terminal, '-d', path], cwd=path, close_fds=True)
                return
            except OSError:
                pass

        powershell = shutil.which('pwsh.exe') or shutil.which('powershell.exe')
        if powershell:
            try:
                subprocess.Popen(
                    [powershell, '-NoExit', '-NoLogo'], cwd=path, close_fds=True,
                    creationflags=getattr(subprocess, 'CREATE_NEW_CONSOLE', 0)
                )
                return
            except OSError:
                pass

        command_prompt = os.environ.get('COMSPEC') or shutil.which('cmd.exe') or 'cmd.exe'
        subprocess.Popen(
            [command_prompt, '/D', '/K'], cwd=path, close_fds=True,
            creationflags=getattr(subprocess, 'CREATE_NEW_CONSOLE', 0)
        )
        return

    if sys.platform == 'darwin':
        subprocess.Popen(['open', '-a', 'Terminal', path], close_fds=True)
        return

    terminal = shutil.which('x-terminal-emulator')
    if not terminal:
        raise RuntimeError('No supported terminal application was found')
    subprocess.Popen([terminal, '--working-directory', path], close_fds=True)


def open_approved_directory(handle, purpose, action):
    path, _ = resolve_approved_directory(handle, purpose)
    if action not in {'folder', 'terminal'}:
        raise ValueError('Unsupported directory action')
    if sys.platform == 'win32':
        if action == 'folder':
            os.startfile(path)
        else:
            _launch_terminal(path)
    elif sys.platform == 'darwin':
        if action == 'folder':
            subprocess.Popen(['open', path], close_fds=True)
        else:
            _launch_terminal(path)
    else:
        if action == 'folder':
            subprocess.Popen(['xdg-open', path], close_fds=True)
        else:
            _launch_terminal(path)
    return True


def _approved_child_path(handle, purpose, relative_path, require_file=False):
    root, _ = resolve_approved_directory(handle, purpose)
    relative = str(relative_path or '').replace('\\', '/')
    if not relative or relative.startswith('/') or '\x00' in relative:
        raise ValueError('Relative file path is invalid')
    candidate = os.path.realpath(os.path.join(root, *relative.split('/')))
    try:
        contained = os.path.commonpath([os.path.normcase(root), os.path.normcase(candidate)]) == os.path.normcase(root)
    except ValueError:
        contained = False
    if not contained:
        raise ValueError('File path escapes the approved directory')
    if require_file and not os.path.isfile(candidate):
        raise FileNotFoundError('The selected file was renamed, deleted, or is unavailable')
    return root, candidate


def list_recent_files(handle, extensions=None, max_age_hours=168, limit=30, recursive=False):
    root, entry = resolve_approved_directory(handle, 'recent-files')
    allowed_extensions = {str(value).lower().lstrip('.')[:16] for value in (extensions or []) if re.fullmatch(r'\.?[A-Za-z0-9]{1,16}', str(value))}
    max_age = max(1, min(24 * 365, int(max_age_hours or 168)))
    max_results = max(1, min(100, int(limit or 30)))
    cutoff = time.time() - max_age * 3600
    deadline = time.monotonic() + 3.0
    scanned = 0
    results = []
    if recursive:
        iterator = os.walk(root, followlinks=False)
    else:
        iterator = [(root, [], os.listdir(root))]
    for current, directories, names in iterator:
        if recursive:
            relative_depth = os.path.relpath(current, root).count(os.sep)
            if relative_depth >= 3:
                directories[:] = []
            directories[:] = [name for name in directories if not os.path.islink(os.path.join(current, name))][:100]
        for name in names:
            if scanned >= 5000 or time.monotonic() > deadline:
                break
            scanned += 1
            candidate = os.path.join(current, name)
            try:
                if os.path.islink(candidate) or not os.path.isfile(candidate):
                    continue
                info = os.stat(candidate)
                if info.st_mtime < cutoff:
                    continue
                extension = os.path.splitext(name)[1].lower().lstrip('.')
                if allowed_extensions and extension not in allowed_extensions:
                    continue
                relative = os.path.relpath(candidate, root).replace(os.sep, '/')
                results.append({'name': name[:260], 'relativePath': relative[:2048], 'extension': extension,
                                'sizeBytes': int(info.st_size), 'modifiedAt': int(info.st_mtime * 1000)})
            except (FileNotFoundError, PermissionError, OSError):
                continue
        if scanned >= 5000 or time.monotonic() > deadline:
            break
    results.sort(key=lambda item: item['modifiedAt'], reverse=True)
    return {'handle': handle, 'label': entry.get('label') or os.path.basename(root), 'files': results[:max_results],
            'scanned': scanned, 'truncated': scanned >= 5000 or time.monotonic() > deadline, 'sampledAt': int(time.time() * 1000)}


def open_approved_file(handle, relative_path, action):
    if action not in {'open', 'reveal'}:
        raise ValueError('Unsupported file action')
    root, path = _approved_child_path(handle, 'recent-files', relative_path, require_file=True)
    if sys.platform == 'win32':
        if action == 'open':
            os.startfile(path)
        else:
            subprocess.Popen(['explorer.exe', '/select,', path])
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', path] if action == 'open' else ['open', '-R', path])
    else:
        subprocess.Popen(['xdg-open', path] if action == 'open' else ['xdg-open', os.path.dirname(path) or root])
    return True


# ---------------------------------------------------------------------------
# Message handlers
# ---------------------------------------------------------------------------

def handle(msg):
    msg_type = msg.get('type', '')

    if msg_type == 'PING':
        reply_ok(version='1.0')

    elif msg_type == 'READ_CONFIG':
        reply_ok(config=load_config())

    elif msg_type == 'WRITE_CONFIG':
        try:
            save_config(msg.get('config', {}))
            reply_ok(config=load_config())
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'READ_FILE':
        path = msg.get('path', '')
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            reply_ok(content=content, fileInfo=get_file_info(path, include_hash=True))
        except FileNotFoundError:
            reply_ok(content=None, fileInfo=get_file_info(path))   # not found is not an error — caller falls back
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'READ_FILE_CHUNK':
        path = msg.get('path', '')
        try:
            reply_ok(**read_file_chunk(
                path,
                msg.get('offset', 0),
                msg.get('length', 512 * 1024),
                msg.get('expectedVersion') or None
            ))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'WRITE_FILE':
        path = msg.get('path', '')
        content = msg.get('content', '')
        try:
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
            reply_ok(fileInfo=get_file_info(path))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'WRITE_THEME_FILE':
        try:
            path = resolve_theme_path(msg.get('themesDir', ''), msg.get('themeId', ''))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'w', encoding='utf-8') as theme_file:
                theme_file.write(msg.get('content', ''))
            reply_ok(fileInfo=get_file_info(path))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'BEGIN_FILE_WRITE':
        temp_path = msg.get('tempPath', '')
        try:
            os.makedirs(os.path.dirname(os.path.abspath(temp_path)), exist_ok=True)
            with open(temp_path, 'wb'):
                pass
            reply_ok()
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'APPEND_FILE_CHUNK':
        temp_path = msg.get('tempPath', '')
        chunk = msg.get('chunk', '')
        try:
            data = base64.b64decode(chunk.encode('ascii'))
            with open(temp_path, 'ab') as f:
                f.write(data)
            reply_ok(written=len(data))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'FINISH_FILE_WRITE':
        temp_path = msg.get('tempPath', '')
        path = msg.get('path', '')
        try:
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
            os.replace(temp_path, path)
            reply_ok(fileInfo=get_file_info(path))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'DOWNLOAD_URL_TO_FILE':
        url = msg.get('url', '')
        path = msg.get('path', '')
        temp_path = msg.get('tempPath', '')
        max_bytes = min(MAX_DOWNLOAD_BYTES, max(1, int(msg.get('maxBytes', MAX_DOWNLOAD_BYTES) or MAX_DOWNLOAD_BYTES)))
        try:
            result = download_url_to_file(url, path, temp_path, max_bytes)
            reply_ok(fileInfo=get_file_info(path), **result)
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'FETCH_FAVICON':
        url = msg.get('url', '')
        max_bytes = min(MAX_FAVICON_BYTES, max(1, int(msg.get('maxBytes', MAX_FAVICON_BYTES) or MAX_FAVICON_BYTES)))
        try:
            reply_ok(**fetch_favicon(url, max_bytes))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'DELETE_FILE':
        path = msg.get('path', '')
        try:
            if path and os.path.isfile(path):
                os.remove(path)
            reply_ok()
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'WRITE_FILE_IF_UNCHANGED':
        path = msg.get('path', '')
        content = msg.get('content', '')
        expected_version = msg.get('expectedVersion') or None
        expected_hash = msg.get('expectedHash') or ''
        try:
            reply_ok(**write_file_if_unchanged(
                path,
                content,
                expected_version=expected_version,
                expected_hash=expected_hash
            ))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'STAT_FILE':
        path = msg.get('path', '')
        try:
            reply_ok(fileInfo=get_file_info(path, include_hash=msg.get('includeHash') is True))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'LIST_DATABASE_BACKUPS':
        try:
            reply_ok(backups=list_database_backups(msg.get('databasePath', '')))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'READ_DATABASE_BACKUP_CHUNK':
        try:
            reply_ok(**read_database_backup_chunk(
                msg.get('databasePath', ''), msg.get('name', ''),
                msg.get('offset', 0), msg.get('length', 512 * 1024),
                msg.get('expectedVersion') or None
            ))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'CREATE_DATABASE_BACKUP':
        try:
            database_path = msg.get('databasePath', '')
            with database_write_lock(database_path):
                backup_path = backup_database_file(database_path, force=True)
            if not backup_path:
                raise ValueError('The configured database is missing or empty')
            reply_ok(name=os.path.basename(backup_path), fileInfo=get_file_info(backup_path, include_hash=True))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'SECRET_STATUS':
        try:
            reply_ok(**secret_status())
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'SECRET_GET':
        try:
            reply_ok(value=secret_get(msg.get('key', '')))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'SECRET_SET':
        try:
            secret_set(msg.get('key', ''), msg.get('value', ''))
            reply_ok()
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'SECRET_DELETE':
        try:
            secret_delete(msg.get('key', ''))
            reply_ok()
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'SECRET_LIST':
        try:
            reply_ok(keys=secret_list())
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'SYSTEM_METRICS':
        try:
            reply_ok(metrics=collect_system_metrics(msg.get('metrics', [])))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'APPROVE_DIRECTORY':
        try:
            approved = approve_directory(msg.get('purpose', ''), msg.get('title', 'Select folder'))
            reply_ok(directory=approved)
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'GIT_WORKSPACE_STATUS':
        try:
            reply_ok(repository=git_workspace_status(msg.get('handle', '')))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'OPEN_APPROVED_DIRECTORY':
        try:
            open_approved_directory(msg.get('handle', ''), msg.get('purpose', ''), msg.get('action', ''))
            reply_ok()
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'LIST_RECENT_FILES':
        try:
            reply_ok(result=list_recent_files(msg.get('handle', ''), msg.get('extensions', []),
                                              msg.get('maxAgeHours', 168), msg.get('limit', 30),
                                              msg.get('recursive') is True))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'OPEN_APPROVED_FILE':
        try:
            open_approved_file(msg.get('handle', ''), msg.get('relativePath', ''), msg.get('action', ''))
            reply_ok()
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'OPEN_FILE_PICKER':
        accept = msg.get('accept', '')
        title  = msg.get('title', 'Select file')
        path = open_file_picker(accept, title)
        if path:
            try:
                data_url = file_to_data_url(path)
                reply_ok(path=path, name=os.path.basename(path), dataUrl=data_url)
            except Exception as e:
                reply_err(str(e))
        else:
            reply_ok(path=None, name=None, dataUrl=None)   # user cancelled

    elif msg_type == 'SAVE_FILE_PICKER':
        accept = msg.get('accept', 'json')
        title = msg.get('title', 'Choose file')
        default_name = msg.get('defaultName', 'morpheus-webhub.json')
        path = save_file_picker(accept, title, default_name)
        if path:
            reply_ok(path=path, name=os.path.basename(path))
        else:
            reply_ok(path=None, name=None)

    elif msg_type == 'LIST_DIR':
        path = msg.get('path', '')
        ext  = msg.get('ext', '')
        try:
            if not os.path.isdir(path):
                reply_ok(files=[])
            else:
                files = [f for f in os.listdir(path)
                         if os.path.isfile(os.path.join(path, f))
                         and (not ext or f.endswith(ext))]
                reply_ok(files=sorted(files))
        except Exception as e:
            reply_err(str(e))

    else:
        reply_err(f'Unknown message type: {msg_type}')


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main():
    while True:
        msg = read_message()
        if msg is None:
            break
        try:
            handle(msg)
        except Exception as e:
            reply_err(f'Host error: {e}')


if __name__ == '__main__':
    main()
