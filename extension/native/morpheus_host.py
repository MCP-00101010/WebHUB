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


def backup_database_file(path):
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
    if existing_backups and time.time() - os.path.getmtime(existing_backups[0]) < DATABASE_BACKUP_MIN_INTERVAL_SECONDS:
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
    data = {
        'databasePath': (config or {}).get('databasePath', '') or ''
    }
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


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
