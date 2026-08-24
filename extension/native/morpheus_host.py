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
import urllib.error
import hashlib
import tempfile
import stat
import re
import platform
import subprocess
import secrets
import importlib.util
from pathlib import Path
from contextlib import contextmanager
from html.parser import HTMLParser
import ctypes
from ctypes import wintypes

HOST_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HOST_DIR, 'config.json')
MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
MAX_FAVICON_BYTES = 1024 * 1024
MAX_APPLICATION_ICON_BYTES = 480 * 1024
MAX_FAVICON_HTML_BYTES = 1024 * 1024
MAX_DATABASE_BACKUPS = 30
DATABASE_BACKUP_MIN_INTERVAL_SECONDS = 60
SECRET_TARGET_PREFIX = 'Morpheus WebHub/'
THEME_ID_PATTERN = re.compile(r'^[a-z0-9][a-z0-9_-]{0,79}$', re.IGNORECASE)
APPLICATION_KEY_PATTERN = re.compile(r'^app_[a-zA-Z0-9_-]{12,75}$')
GAME_KEY_PATTERN = re.compile(r'^game_[a-zA-Z0-9_-]{12,75}$')
EMUGUI_ID_PATTERN = re.compile(r'^[a-zA-Z0-9_-]{1,120}$')
GAME_SYSTEM_ID_PATTERN = re.compile(r'^[a-z0-9][a-z0-9_-]{0,47}$')
APPLICATION_URI_SCHEMES = {
    'steam', 'goggalaxy', 'com.epicgames.launcher', 'uplay', 'origin',
    'origin2', 'ea', 'battlenet', 'xbox', 'ms-xbl', 'heroic'
}
MAX_INTERNET_SHORTCUT_BYTES = 64 * 1024
MAX_GAME_BINDINGS = 512
MAX_EMUGUI_RPC_REQUEST_BYTES = 2 * 1024 * 1024
MAX_EMUGUI_RPC_RESPONSE_BYTES = 32 * 1024 * 1024
MAX_EMUGUI_ASSET_BYTES = 4 * 1024 * 1024
MAX_EMUGUI_TRANSFER_CHUNK_BYTES = 384 * 1024
MAX_EMUGUI_TRANSFERS = 4
EMUGUI_TRANSFER_TTL_SECONDS = 180
EMUGUI_MODULE = None
EMUGUI_MODULE_PATH = ''
EMUGUI_TRANSFERS = {}


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
    if accept == 'application':
        if sys.platform == 'win32':
            return [('Applications', '*.exe *.com *.lnk *.url'), ('All files', '*.*')]
        if sys.platform == 'darwin':
            return [('Applications', '*.app'), ('All files', '*.*')]
        return [('Applications', '*.desktop'), ('All files', '*.*')]
    return [('All files', '*.*')]


def _windows_filter_string(accept=''):
    if accept == 'image':
        return 'Image Files (*.png,*.jpg,*.jpeg,*.gif,*.webp,*.bmp)|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp|All Files (*.*)|*.*'
    if accept == 'json':
        return 'JSON Files (*.json)|*.json|All Files (*.*)|*.*'
    if accept == 'application':
        return 'Applications (*.exe,*.com,*.lnk,*.url)|*.exe;*.com;*.lnk;*.url|All Files (*.*)|*.*'
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
                '$d.Title = $args[0];'
                '$d.Filter = $args[1];'
                'if ($d.ShowDialog() -eq \'OK\') { Write-Output $d.FileName }'
            )
            result = subprocess.run(
                ['powershell', '-STA', '-NonInteractive', '-Command', ps_script, str(title or 'Select file')[:160], filter_str],
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
    emugui_root = config.get('emuguiRoot')
    if emugui_root is None:
        emugui_root = load_config().get('emuguiRoot', '')
    emugui_root = str(emugui_root or '').strip()
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
    applications = config.get('approvedApplications')
    if applications is None:
        applications = load_config().get('approvedApplications', {})
    if not isinstance(applications, dict):
        applications = {}
    safe_applications = {}
    for app_key, entry in list(applications.items())[:256]:
        if not APPLICATION_KEY_PATTERN.fullmatch(str(app_key)) or not isinstance(entry, dict):
            continue
        kind = str(entry.get('kind', '') or '')
        if kind == 'protocol-link':
            try:
                target_uri = _validated_application_uri(entry.get('targetUri', ''))
            except ValueError:
                continue
            safe_applications[str(app_key)] = {
                'targetUri': target_uri,
                'kind': kind,
                'label': str(entry.get('label', '') or urllib.parse.urlsplit(target_uri).scheme or 'Application')[:160],
                'approvedAt': int(entry.get('approvedAt', 0) or 0),
                'iconDataUrl': str(entry.get('iconDataUrl', '') or '')[:700000]
            }
            continue
        path = os.path.realpath(str(entry.get('path', '') or ''))
        if not path or kind not in {'executable', 'shortcut', 'uri-shortcut', 'app-bundle', 'desktop-entry'}:
            continue
        safe_applications[str(app_key)] = {
            'path': path,
            'kind': kind,
            'label': str(entry.get('label', '') or os.path.splitext(os.path.basename(path))[0] or 'Application')[:160],
            'approvedAt': int(entry.get('approvedAt', 0) or 0),
            'iconDataUrl': str(entry.get('iconDataUrl', '') or '')[:700000]
        }
    games = config.get('approvedGames')
    if games is None:
        games = load_config().get('approvedGames', {})
    if not isinstance(games, dict):
        games = {}
    safe_games = {}
    for game_key, entry in list(games.items())[:MAX_GAME_BINDINGS]:
        if not GAME_KEY_PATTERN.fullmatch(str(game_key)) or not isinstance(entry, dict):
            continue
        library_id = str(entry.get('libraryId', '') or '')
        game_id = str(entry.get('gameId', '') or '')
        emulator_id = str(entry.get('emulatorId', '') or '')
        profile_id = str(entry.get('profileId', '') or '')
        if not all(EMUGUI_ID_PATTERN.fullmatch(value) for value in (library_id, game_id, emulator_id)):
            continue
        if profile_id and not EMUGUI_ID_PATTERN.fullmatch(profile_id):
            continue
        safe_games[str(game_key)] = {
            'libraryId': library_id,
            'gameId': game_id,
            'emulatorId': emulator_id,
            'profileId': profile_id,
            'label': str(entry.get('label', '') or 'Game')[:160],
            'systemId': str(entry.get('systemId', '') or '')[:48] if GAME_SYSTEM_ID_PATTERN.fullmatch(str(entry.get('systemId', '') or '')) else '',
            'systemName': str(entry.get('systemName', '') or '')[:80],
            'emulatorName': str(entry.get('emulatorName', '') or '')[:120],
            'profileName': str(entry.get('profileName', '') or '')[:120],
            'approvedAt': int(entry.get('approvedAt', 0) or 0)
        }
    data = {
        'databasePath': config.get('databasePath', '') or '',
        'emuguiRoot': os.path.realpath(emugui_root) if emugui_root else '',
        'approvedDirectories': safe_approved,
        'approvedApplications': safe_applications,
        'approvedGames': safe_games
    }
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


# ---------------------------------------------------------------------------
# EmuGUI service bridge
# ---------------------------------------------------------------------------

def _configured_emugui_server():
    configured_root = str(load_config().get('emuguiRoot', '') or '').strip()
    if not configured_root:
        raise RuntimeError('Morpheus EmuGUI is not configured in the native host')
    root = os.path.realpath(configured_root)
    server_path = os.path.join(root, 'server.py')
    if not os.path.isdir(root) or not os.path.isfile(server_path):
        raise FileNotFoundError('The configured Morpheus EmuGUI installation is unavailable')
    return root, server_path


def _load_emugui_module():
    global EMUGUI_MODULE, EMUGUI_MODULE_PATH
    root, server_path = _configured_emugui_server()
    if EMUGUI_MODULE is not None and EMUGUI_MODULE_PATH == server_path:
        return EMUGUI_MODULE

    module_name = 'morpheus_emugui_native_service'
    spec = importlib.util.spec_from_file_location(module_name, server_path)
    if spec is None or spec.loader is None:
        raise RuntimeError('The Morpheus EmuGUI service could not be loaded')
    module = importlib.util.module_from_spec(spec)
    previous = sys.modules.get(module_name)
    added_path = root not in sys.path
    if added_path:
        sys.path.insert(0, root)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        if previous is None:
            sys.modules.pop(module_name, None)
        else:
            sys.modules[module_name] = previous
        raise
    finally:
        if added_path:
            try:
                sys.path.remove(root)
            except ValueError:
                pass
    if not callable(getattr(module, 'dispatch_emugui_read', None)):
        raise RuntimeError('The configured EmuGUI does not expose the native service contract')
    EMUGUI_MODULE = module
    EMUGUI_MODULE_PATH = server_path
    return module


def authorize_emugui_page(page_url):
    root, _server_path = _configured_emugui_server()
    parsed = urllib.parse.urlsplit(str(page_url or ''))
    if parsed.scheme.casefold() != 'file' or parsed.netloc not in {'', 'localhost'}:
        return False
    path = urllib.request.url2pathname(parsed.path or '')
    if sys.platform == 'win32' and re.match(r'^/[a-zA-Z]:[\\/]', path):
        path = path[1:]
    expected = os.path.realpath(os.path.join(root, 'web', 'index.html'))
    return os.path.normcase(os.path.realpath(path)) == os.path.normcase(expected)


def emugui_api_request(method, path, query=None, body=None):
    method = str(method or '').strip().upper()
    path = str(path or '').strip()
    query = query if isinstance(query, dict) else {}
    body = body if isinstance(body, dict) else {}
    if method not in {'GET', 'POST'} or not re.fullmatch(r'/api/[a-z0-9/-]{1,80}', path):
        raise ValueError('The EmuGUI API request is invalid')
    if len(json.dumps({'query': query, 'body': body}, ensure_ascii=False)) > MAX_EMUGUI_RPC_REQUEST_BYTES:
        raise ValueError('The EmuGUI API request is too large')
    module = _load_emugui_module()
    dispatcher = getattr(module, 'dispatch_emugui_api', None)
    if not callable(dispatcher):
        raise RuntimeError('The configured EmuGUI does not expose the API service contract')
    result = dispatcher(method, path, query, body)
    if not isinstance(result, dict):
        raise RuntimeError('The EmuGUI API service returned invalid data')
    if len(json.dumps(result, ensure_ascii=False)) > MAX_EMUGUI_RPC_RESPONSE_BYTES:
        raise ValueError('The EmuGUI API response is too large')
    return result


def emugui_asset(relative_path):
    module = _load_emugui_module()
    reader = getattr(module, 'read_emugui_asset', None)
    if not callable(reader):
        raise RuntimeError('The configured EmuGUI does not expose the asset service contract')
    result = reader(str(relative_path or ''), MAX_EMUGUI_ASSET_BYTES)
    if not isinstance(result, dict):
        raise RuntimeError('The EmuGUI asset service returned invalid data')
    return result


def _cleanup_emugui_transfers(now=None):
    now = time.monotonic() if now is None else now
    expired = [transfer_id for transfer_id, record in EMUGUI_TRANSFERS.items()
               if now - record['createdAt'] > EMUGUI_TRANSFER_TTL_SECONDS]
    for transfer_id in expired:
        EMUGUI_TRANSFERS.pop(transfer_id, None)


def read_emugui_transfer_chunk(transfer_id, offset=0):
    transfer_id = str(transfer_id or '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{16,80}', transfer_id):
        raise ValueError('The EmuGUI transfer ID is invalid')
    _cleanup_emugui_transfers()
    record = EMUGUI_TRANSFERS.get(transfer_id)
    if not record:
        raise ValueError('The EmuGUI transfer expired or is unknown')
    data = record['data']
    offset = int(offset or 0)
    if offset < 0 or offset > len(data):
        raise ValueError('The EmuGUI transfer offset is invalid')
    end = min(len(data), offset + MAX_EMUGUI_TRANSFER_CHUNK_BYTES)
    done = end >= len(data)
    result = {
        'transferId': transfer_id,
        'chunk': base64.b64encode(data[offset:end]).decode('ascii'),
        'nextOffset': end,
        'totalSize': len(data),
        'done': done,
    }
    if done:
        EMUGUI_TRANSFERS.pop(transfer_id, None)
    return result


def start_emugui_transfer(payload):
    data = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(data) > MAX_EMUGUI_RPC_RESPONSE_BYTES:
        raise ValueError('The EmuGUI response is too large')
    _cleanup_emugui_transfers()
    while len(EMUGUI_TRANSFERS) >= MAX_EMUGUI_TRANSFERS:
        oldest = min(EMUGUI_TRANSFERS, key=lambda key: EMUGUI_TRANSFERS[key]['createdAt'])
        EMUGUI_TRANSFERS.pop(oldest, None)
    transfer_id = secrets.token_urlsafe(18)
    EMUGUI_TRANSFERS[transfer_id] = {'data': data, 'createdAt': time.monotonic()}
    return read_emugui_transfer_chunk(transfer_id, 0)


def emugui_service_status():
    """Return a path-free summary suitable for the ordinary Hub client."""
    payload = _load_emugui_module().dispatch_emugui_read('STATUS')
    if not isinstance(payload, dict):
        raise RuntimeError('The Morpheus EmuGUI service returned an invalid status')
    active = payload.get('active') if isinstance(payload.get('active'), dict) else {}
    collections = payload.get('collections') if isinstance(payload.get('collections'), list) else []
    emulators = payload.get('emulators') if isinstance(payload.get('emulators'), list) else []
    profiles = payload.get('profiles') if isinstance(payload.get('profiles'), list) else []
    return {
        'available': True,
        'serviceVersion': int(payload.get('serviceVersion', 0) or 0),
        'activeCollection': {
            'id': str(active.get('id', '') or '')[:120],
            'name': str(active.get('name', '') or '')[:160]
        },
        'collectionCount': len(collections),
        'emulatorCount': len(emulators),
        'profileCount': len(profiles)
    }


def _emugui_record(method, params=None):
    payload = _load_emugui_module().dispatch_emugui_read(method, params or {})
    if not isinstance(payload, dict):
        raise RuntimeError('The Morpheus EmuGUI service returned invalid data')
    return payload


def _emugui_binding_thumbnail(module, game):
    collection_root = os.path.realpath(str(getattr(module, 'COLLECTION', '') or ''))
    def thumbnail_from_record(record):
        for raw_source in (record.get('loading_screen'), record.get('screenshot')):
            source = str(raw_source or '').strip()
            if not source:
                continue
            parsed = urllib.parse.urlsplit(source)
            if parsed.scheme:
                if parsed.scheme.lower() != 'https' or not parsed.netloc or parsed.username or parsed.password:
                    continue
                try:
                    downloaded = _download_favicon_candidate(source, MAX_APPLICATION_ICON_BYTES)
                except Exception:
                    continue
                if downloaded.get('contentType') in {'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'}:
                    return str(downloaded.get('dataUrl') or '')[:700000]
                continue
            if not collection_root:
                continue
            target = os.path.realpath(os.path.join(collection_root, source.replace('/', os.sep)))
            try:
                if os.path.commonpath([collection_root, target]) != collection_root:
                    continue
            except ValueError:
                continue
            data_url = _bounded_local_image_data_url(target)
            if data_url:
                return data_url
        return ''

    direct = thumbnail_from_record(game)
    if direct:
        return direct

    title = str(game.get('title') or '').strip()
    if not title:
        return ''
    try:
        matches = module.dispatch_emugui_read('SEARCH_GAMES', {'query': title, 'view': 'all', 'limit': 50}).get('games', [])
    except Exception:
        return ''
    source_system = _game_system_info(game)[0]
    for candidate in matches:
        if not isinstance(candidate, dict) or str(candidate.get('id') or '') == str(game.get('id') or ''):
            continue
        if str(candidate.get('title') or '').strip().casefold() != title.casefold():
            continue
        candidate_system = _game_system_info(candidate)[0]
        if source_system and candidate_system and source_system != candidate_system:
            continue
        fallback = thumbnail_from_record(candidate)
        if fallback:
            return fallback
    return ''


def _game_system_info(game=None, entry=None):
    game = game if isinstance(game, dict) else {}
    entry = entry if isinstance(entry, dict) else {}
    explicit_name = str(game.get('system') or game.get('platform') or entry.get('systemName') or '').strip()[:80]
    emulator_id = str(entry.get('emulatorId') or game.get('default_emulator') or '').strip()
    values = [explicit_name, emulator_id]
    tags = game.get('tags')
    if isinstance(tags, list):
        values.extend(str(value or '') for value in tags[:12])
    haystack = ' '.join(values).lower().replace('_', ' ').replace('-', ' ')
    compact = re.sub(r'[^a-z0-9+]+', '', haystack)

    systems = (
        ('zx-spectrum', 'ZX Spectrum', ('zx spectrum', 'spectrum', 'eightyone', 'spectaculator', 'fuse')),
        ('atari-st', 'Atari ST', ('atari st', 'steem', 'hatari')),
        ('game-boy', 'Game Boy', ('game boy', 'gameboy', 'visualboy', 'sameboy', 'gambatte')),
        ('snes', 'Super Nintendo', ('super nintendo', 'snes', 'snes9x', 'bsnes')),
        ('scummvm', 'ScummVM', ('scummvm', 'scumm vm')),
        ('dosbox', 'DOSBox', ('dosbox', 'ms dos', 'dos game')),
        ('mame', 'Arcade / MAME', ('mame', 'arcade')),
    )
    for system_id, system_name, aliases in systems:
        if any(alias in haystack or alias.replace(' ', '') in compact for alias in aliases):
            return system_id, system_name
    spectrum_memory = explicit_name.lower().replace(' ', '')
    if re.fullmatch(r'(?:16k|48k|128k|\+2a?|\+3)(?:[-/](?:16k|48k|128k|\+2a?|\+3))*', spectrum_memory):
        return 'zx-spectrum', 'ZX Spectrum'

    stored_id = str(entry.get('systemId') or '').strip().lower()
    if GAME_SYSTEM_ID_PATTERN.fullmatch(stored_id):
        return stored_id, explicit_name or str(entry.get('systemName') or 'Game system')[:80]
    if explicit_name:
        derived_id = re.sub(r'[^a-z0-9]+', '-', explicit_name.lower()).strip('-')[:48]
        if GAME_SYSTEM_ID_PATTERN.fullmatch(derived_id):
            return derived_id, explicit_name
    return '', ''


def _game_public_record(game_key, entry, game=None, state='ready', thumbnail_data_url=''):
    system_id, system_name = _game_system_info(game, entry)
    record = {
        'gameKey': str(game_key),
        'state': state,
        'title': str((game or {}).get('title') or entry.get('label') or 'Game')[:160],
        'tags': ['Games'] + ([system_name] if system_name else []),
        'systemId': system_id,
        'systemName': system_name,
        'emulatorName': str(entry.get('emulatorName') or '')[:120],
        'profileName': str(entry.get('profileName') or '')[:120],
        'thumbnailCache': str(thumbnail_data_url or '')[:700000]
    }
    return record


def create_emugui_game_binding(game_id, emulator_id='', profile_id='', game_key=''):
    game_id = str(game_id or '').strip()
    emulator_id = str(emulator_id or '').strip()
    profile_id = str(profile_id or '').strip()
    if not EMUGUI_ID_PATTERN.fullmatch(game_id):
        raise ValueError('The EmuGUI game ID is invalid')
    if emulator_id and not EMUGUI_ID_PATTERN.fullmatch(emulator_id):
        raise ValueError('The EmuGUI emulator ID is invalid')
    if profile_id and not EMUGUI_ID_PATTERN.fullmatch(profile_id):
        raise ValueError('The EmuGUI profile ID is invalid')
    game_key = str(game_key or '').strip()
    if game_key and not GAME_KEY_PATTERN.fullmatch(game_key):
        raise ValueError('The game binding key is invalid')

    module = _load_emugui_module()
    status = _emugui_record('STATUS')
    game = _emugui_record('GET_GAME', {'gameId': game_id}).get('game')
    if not isinstance(game, dict):
        raise ValueError('The selected EmuGUI game is unavailable')
    active = status.get('active') if isinstance(status.get('active'), dict) else {}
    library_id = str(active.get('id', '') or '')
    if not EMUGUI_ID_PATTERN.fullmatch(library_id):
        raise ValueError('The active EmuGUI library has no stable ID')

    emulators = [item for item in status.get('emulators', []) if isinstance(item, dict)]
    if not emulator_id:
        emulator_id = str(game.get('default_emulator') or '')
    if not emulator_id:
        emulator_id = str(next((item.get('id') for item in emulators if item.get('available') is not False), '') or '')
    emulator = next((item for item in emulators if str(item.get('id', '')) == emulator_id), None)
    if emulator is None or emulator.get('available') is False:
        raise ValueError('The selected EmuGUI emulator is unavailable')

    profiles = [item for item in status.get('profiles', []) if isinstance(item, dict)]
    profile = None
    if profile_id:
        profile = next((item for item in profiles if str(item.get('id', '')) == profile_id), None)
        if profile is None or str(profile.get('emulator_id', '')) != emulator_id:
            raise ValueError('The selected EmuGUI profile is unavailable for this emulator')

    config = load_config()
    bindings = config.setdefault('approvedGames', {})
    if game_key and not isinstance(bindings.get(game_key), dict):
        raise KeyError('This game is not set up on this device')
    existing = game_key or next((key for key, entry in bindings.items() if isinstance(entry, dict)
                                and entry.get('libraryId') == library_id and entry.get('gameId') == game_id
                                and entry.get('emulatorId') == emulator_id and entry.get('profileId', '') == profile_id), '')
    if not existing and len(bindings) >= MAX_GAME_BINDINGS:
        raise ValueError(f'This device already has the maximum of {MAX_GAME_BINDINGS} game bindings')
    game_key = existing if GAME_KEY_PATTERN.fullmatch(str(existing)) else f'game_{secrets.token_urlsafe(18)}'
    system_id, system_name = _game_system_info(game, {'emulatorId': emulator_id})
    entry = {
        'libraryId': library_id,
        'gameId': game_id,
        'emulatorId': emulator_id,
        'profileId': profile_id,
        'label': str(game.get('title') or 'Game')[:160],
        'systemId': system_id,
        'systemName': system_name,
        'emulatorName': str(emulator.get('name') or emulator_id)[:120],
        'profileName': str((profile or {}).get('name') or profile_id or 'Automatic')[:120],
        'approvedAt': int(time.time() * 1000)
    }
    bindings[game_key] = entry
    save_config(config)
    return _game_public_record(game_key, entry, game, thumbnail_data_url=_emugui_binding_thumbnail(module, game))


def resolve_emugui_game_source(game_key):
    game_key = str(game_key or '')
    if not GAME_KEY_PATTERN.fullmatch(game_key):
        raise ValueError('The game binding key is invalid')
    entry = load_config().get('approvedGames', {}).get(game_key)
    if not isinstance(entry, dict):
        raise KeyError('This game is not set up on this device')
    status = _emugui_record('STATUS')
    active = status.get('active') if isinstance(status.get('active'), dict) else {}
    if str(active.get('id', '')) != str(entry.get('libraryId', '')):
        raise RuntimeError('The game library is not currently active in EmuGUI')
    game = _emugui_record('GET_GAME', {'gameId': entry.get('gameId', '')}).get('game')
    if not isinstance(game, dict):
        raise FileNotFoundError('The bound game is missing from EmuGUI')
    return entry, game, status


def resolve_emugui_game_binding(game_key):
    entry, game, status = resolve_emugui_game_source(game_key)
    emulator = next((item for item in status.get('emulators', []) if isinstance(item, dict)
                     and str(item.get('id', '')) == str(entry.get('emulatorId', ''))), None)
    if emulator is None or emulator.get('available') is False:
        raise FileNotFoundError('The bound emulator is unavailable')
    public_entry = dict(entry)
    public_entry['emulatorName'] = str(emulator.get('name') or entry.get('emulatorName') or entry.get('emulatorId') or '')[:120]
    profile_id = str(entry.get('profileId') or '')
    profiles = [item for item in status.get('profiles', []) if isinstance(item, dict)]
    profile = next((item for item in profiles if str(item.get('id', '')) == profile_id), None) if profile_id else None
    if profile_id and (profile is None or str(profile.get('emulator_id', '')) != str(entry.get('emulatorId', ''))):
        raise FileNotFoundError('The bound emulator profile is unavailable')
    public_entry['profileName'] = str((profile or {}).get('name') or entry.get('profileName') or profile_id or 'Automatic')[:120]
    return entry, game, public_entry


def emugui_game_status(game_key, include_thumbnail=False):
    game_key = str(game_key or '')
    if not GAME_KEY_PATTERN.fullmatch(game_key):
        return _game_public_record(game_key, {}, state='unbound') | {'error': 'The game binding key is invalid'}
    entry = load_config().get('approvedGames', {}).get(game_key)
    if not isinstance(entry, dict):
        return _game_public_record(game_key, {}, state='unbound')
    try:
        module = _load_emugui_module()
        status = _emugui_record('STATUS')
    except Exception as error:
        return _game_public_record(game_key, entry, state='unavailable') | {'error': str(error)}
    active = status.get('active') if isinstance(status.get('active'), dict) else {}
    if str(active.get('id', '')) != str(entry.get('libraryId', '')):
        return _game_public_record(game_key, entry, state='library-missing') | {'error': 'The bound game library is not active'}
    try:
        game = _emugui_record('GET_GAME', {'gameId': entry.get('gameId', '')}).get('game')
    except Exception as error:
        return _game_public_record(game_key, entry, state='game-missing') | {'error': str(error)}
    if not isinstance(game, dict):
        return _game_public_record(game_key, entry, state='game-missing') | {'error': 'The bound game is missing from EmuGUI'}
    emulators = [item for item in status.get('emulators', []) if isinstance(item, dict)]
    emulator = next((item for item in emulators if str(item.get('id', '')) == str(entry.get('emulatorId', ''))), None)
    if emulator is None or emulator.get('available') is False:
        return _game_public_record(game_key, entry, game, state='emulator-missing') | {'error': 'The bound emulator is unavailable'}
    public_entry = dict(entry)
    public_entry['emulatorName'] = str(emulator.get('name') or entry.get('emulatorName') or entry.get('emulatorId') or '')[:120]
    profile_id = str(entry.get('profileId') or '')
    if profile_id:
        profiles = [item for item in status.get('profiles', []) if isinstance(item, dict)]
        profile = next((item for item in profiles if str(item.get('id', '')) == profile_id), None)
        if profile is None or str(profile.get('emulator_id', '')) != str(entry.get('emulatorId', '')):
            return _game_public_record(game_key, public_entry, game, state='profile-missing') | {'error': 'The bound emulator profile is unavailable'}
        public_entry['profileName'] = str(profile.get('name') or entry.get('profileName') or profile_id)[:120]
    thumbnail = _emugui_binding_thumbnail(module, game) if include_thumbnail else ''
    return _game_public_record(game_key, public_entry, game, thumbnail_data_url=thumbnail)


def emugui_game_link(game_key, rebind=False):
    entry, _game, _status = resolve_emugui_game_source(game_key)
    query = {'game': str(entry.get('gameId') or '')}
    if rebind:
        query['hubRebind'] = str(game_key)
    root, _server_path = _configured_emugui_server()
    page_path = os.path.realpath(os.path.join(root, 'web', 'index.html'))
    page_url = Path(page_path).as_uri()
    return f'{page_url}?{urllib.parse.urlencode(query)}'


def reveal_emugui_game(game_key):
    _entry, game, _status = resolve_emugui_game_source(game_key)
    path = os.path.realpath(str(game.get('path') or ''))
    if not path or not os.path.isfile(path):
        raise FileNotFoundError('The bound game file is missing or unavailable')
    if sys.platform == 'win32':
        subprocess.Popen(['explorer.exe', '/select,', path])
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', '-R', path], close_fds=True)
    else:
        subprocess.Popen(['xdg-open', os.path.dirname(path) or path], close_fds=True)
    return True


def rebind_emugui_game(game_key, game_id, emulator_id='', profile_id=''):
    return create_emugui_game_binding(game_id, emulator_id, profile_id, game_key)


def launch_emugui_game(game_key):
    entry, _game, _public_entry = resolve_emugui_game_binding(game_key)
    result = _load_emugui_module().launch_game(
        entry['gameId'], entry['emulatorId'], profile_id=entry.get('profileId', '')
    )
    if not isinstance(result, dict) or result.get('ok') is not True:
        error = str((result or {}).get('error') or 'EmuGUI could not launch the game')
        if isinstance(result, dict) and (result.get('needs_choice') or result.get('needs_confirmation')):
            error += ' Open the game in EmuGUI to choose how to handle the running emulator.'
        raise RuntimeError(error)
    return True


def forget_emugui_game(game_key):
    if not GAME_KEY_PATTERN.fullmatch(str(game_key or '')):
        raise ValueError('The game binding key is invalid')
    config = load_config()
    removed = config.get('approvedGames', {}).pop(str(game_key), None)
    save_config(config)
    return removed is not None


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
# User-approved applications and fixed launch/reveal operations
# ---------------------------------------------------------------------------

def _internet_shortcut_scheme(path):
    if os.path.getsize(path) > MAX_INTERNET_SHORTCUT_BYTES:
        raise ValueError('The Internet Shortcut is too large')
    with open(path, 'rb') as shortcut_file:
        raw = shortcut_file.read(MAX_INTERNET_SHORTCUT_BYTES + 1)
    text = None
    encodings = ('utf-16', 'utf-8-sig', 'cp1252') if raw.startswith((b'\xff\xfe', b'\xfe\xff')) or b'\x00' in raw else ('utf-8-sig', 'cp1252')
    for encoding in encodings:
        try:
            text = raw.decode(encoding)
            break
        except UnicodeError:
            continue
    if text is None:
        raise ValueError('The Internet Shortcut could not be read')
    in_shortcut_section = False
    targets = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith('[') and stripped.endswith(']'):
            in_shortcut_section = stripped.casefold() == '[internetshortcut]'
        elif in_shortcut_section and stripped.casefold().startswith('url='):
            targets.append(stripped[4:].strip())
    if len(targets) != 1:
        raise ValueError('The Internet Shortcut must contain one application target')
    target = targets[0]
    return urllib.parse.urlsplit(_validated_application_uri(target)).scheme.casefold()


def _validated_application_uri(target):
    target = str(target or '').strip()
    if not target or len(target) > 4096 or any(ord(char) < 32 for char in target):
        raise ValueError('The application link has no valid target')
    parsed = urllib.parse.urlsplit(target)
    scheme = parsed.scheme.casefold()
    if scheme not in APPLICATION_URI_SCHEMES:
        raise ValueError('Only approved game and application protocol shortcuts are supported')
    return target


def _application_kind(path):
    extension = os.path.splitext(path)[1].lower()
    if sys.platform == 'win32':
        if not os.path.isfile(path):
            raise ValueError('The selected application is unavailable')
        if extension in {'.exe', '.com'}:
            return 'executable'
        if extension == '.lnk':
            return 'shortcut'
        if extension == '.url':
            _internet_shortcut_scheme(path)
            return 'uri-shortcut'
        raise ValueError('Select an executable or Windows application shortcut')
    if sys.platform == 'darwin':
        if extension == '.app' and os.path.isdir(path):
            return 'app-bundle'
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return 'executable'
        raise ValueError('Select an application bundle or executable')
    if extension == '.desktop' and os.path.isfile(path):
        return 'desktop-entry'
    if os.path.isfile(path) and os.access(path, os.X_OK):
        return 'executable'
    raise ValueError('Select a desktop application entry or executable')


def _application_icon_data_url(path):
    if sys.platform != 'win32':
        return ''
    script = (
        'Add-Type -AssemblyName System.Drawing;'
        '$p=[Console]::In.ReadToEnd().Trim();'
        '$i=[System.Drawing.Icon]::ExtractAssociatedIcon($p);'
        'if($i){$m=New-Object System.IO.MemoryStream;'
        '$i.ToBitmap().Save($m,[System.Drawing.Imaging.ImageFormat]::Png);'
        '[Convert]::ToBase64String($m.ToArray());$m.Dispose();$i.Dispose()}'
    )
    try:
        result = subprocess.run(
            ['powershell', '-NoProfile', '-NonInteractive', '-Command', script],
            input=str(path), capture_output=True, text=True, timeout=15,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        )
        encoded = (result.stdout or '').strip()
        if not encoded or len(encoded) > 512 * 1024:
            return ''
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > 256 * 1024 or not raw.startswith(b'\x89PNG\r\n\x1a\n'):
            return ''
        return 'data:image/png;base64,' + encoded
    except Exception:
        return ''


def _steam_app_id(target_uri):
    try:
        parsed = urllib.parse.urlsplit(str(target_uri or '').strip())
    except ValueError:
        return ''
    if parsed.scheme.casefold() != 'steam' or parsed.netloc.casefold() != 'rungameid':
        return ''
    match = re.fullmatch(r'/(\d{1,10})/?', parsed.path or '')
    return match.group(1) if match else ''


def _steam_library_cache_dir():
    if sys.platform != 'win32':
        return ''
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Valve\Steam') as key:
            steam_path, _ = winreg.QueryValueEx(key, 'SteamPath')
        return os.path.realpath(os.path.join(str(steam_path), 'appcache', 'librarycache'))
    except (ImportError, OSError, TypeError, ValueError):
        return ''


def _bounded_local_image_data_url(path):
    try:
        if not os.path.isfile(path) or os.path.getsize(path) > MAX_APPLICATION_ICON_BYTES:
            return ''
        with open(path, 'rb') as image_file:
            data = image_file.read(MAX_APPLICATION_ICON_BYTES + 1)
    except OSError:
        return ''
    if not data or len(data) > MAX_APPLICATION_ICON_BYTES:
        return ''
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        mime = 'image/png'
    elif data.startswith(b'\xff\xd8\xff'):
        mime = 'image/jpeg'
    elif data.startswith((b'GIF87a', b'GIF89a')):
        mime = 'image/gif'
    elif data.startswith(b'RIFF') and data[8:12] == b'WEBP':
        mime = 'image/webp'
    elif data.startswith(b'\x00\x00\x01\x00'):
        mime = 'image/x-icon'
    else:
        return ''
    return f'data:{mime};base64,{base64.b64encode(data).decode("ascii")}'


def _steam_cached_app_icon_data_url(app_id):
    if not re.fullmatch(r'\d{1,10}', str(app_id or '')):
        return ''
    cache_dir = _steam_library_cache_dir()
    if not cache_dir:
        return ''
    cache_dir = os.path.realpath(cache_dir)
    legacy_candidates = [
        os.path.join(cache_dir, f'{app_id}_icon.jpg'),
        os.path.join(cache_dir, f'{app_id}_icon.png')
    ]
    for candidate in legacy_candidates:
        resolved = os.path.realpath(candidate)
        try:
            if os.path.commonpath([os.path.normcase(cache_dir), os.path.normcase(resolved)]) != os.path.normcase(cache_dir):
                continue
        except ValueError:
            continue
        icon_data = _bounded_local_image_data_url(resolved)
        if icon_data:
            return icon_data

    app_dir = os.path.realpath(os.path.join(cache_dir, str(app_id)))
    try:
        if os.path.commonpath([os.path.normcase(cache_dir), os.path.normcase(app_dir)]) != os.path.normcase(cache_dir):
            return ''
        candidates = []
        with os.scandir(app_dir) as entries:
            for index, entry in enumerate(entries):
                if index >= 64:
                    break
                if not entry.is_file(follow_symlinks=False):
                    continue
                extension = os.path.splitext(entry.name)[1].casefold()
                if extension not in {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.ico'}:
                    continue
                resolved = os.path.realpath(entry.path)
                if os.path.commonpath([os.path.normcase(app_dir), os.path.normcase(resolved)]) != os.path.normcase(app_dir):
                    continue
                try:
                    size = os.path.getsize(resolved)
                except OSError:
                    continue
                if 0 < size <= MAX_APPLICATION_ICON_BYTES:
                    name = entry.name.casefold()
                    is_hashed_icon = re.fullmatch(r'[0-9a-f]{40}\.(?:jpe?g|png|gif|webp|ico)', name) is not None
                    priority = 0 if 'icon' in name or is_hashed_icon else 1
                    candidates.append((priority, size, resolved))
    except (OSError, ValueError):
        return ''
    for _, _, candidate in sorted(candidates):
        icon_data = _bounded_local_image_data_url(candidate)
        if icon_data:
            return icon_data
    return ''


def _steam_store_art_data_url(app_id):
    if not re.fullmatch(r'\d{1,10}', str(app_id or '')):
        return ''
    url = f'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{app_id}/library_600x900.jpg'
    try:
        return _download_favicon_candidate(url, MAX_APPLICATION_ICON_BYTES).get('dataUrl', '')
    except (OSError, ValueError, urllib.error.URLError):
        return ''


def _application_link_icon_data_url(target_uri, icon_hint=''):
    if sys.platform != 'win32' or urllib.parse.urlsplit(target_uri).scheme.casefold() != 'steam':
        return ''
    hinted_path = str(icon_hint or '').strip().strip('"')
    if hinted_path and os.path.splitext(hinted_path)[1].casefold() == '.ico':
        icon_path = os.path.realpath(hinted_path)
        icon_dir = os.path.dirname(icon_path)
        steam_dir = os.path.dirname(icon_dir)
        if os.path.basename(icon_dir).casefold() == 'games' and os.path.basename(steam_dir).casefold() == 'steam':
            try:
                if os.path.isfile(icon_path) and os.path.getsize(icon_path) <= MAX_FAVICON_BYTES:
                    icon_data = _application_icon_data_url(icon_path)
                    if icon_data:
                        return icon_data
            except OSError:
                pass
    app_id = _steam_app_id(target_uri)
    if not app_id:
        return ''
    return _steam_cached_app_icon_data_url(app_id) or _steam_store_art_data_url(app_id)


def _application_public_record(app_key, entry, state='ready'):
    return {
        'appKey': app_key,
        'label': str(entry.get('label', '') or 'Application')[:160],
        'kind': str(entry.get('kind', '') or ''),
        'state': state,
        'iconDataUrl': str(entry.get('iconDataUrl', '') or '')[:700000]
    }


def approve_application(app_key='', title='Select application', selected_path=None):
    requested_key = str(app_key or '')
    if requested_key and not APPLICATION_KEY_PATTERN.fullmatch(requested_key):
        raise ValueError('Application key is invalid')
    selected = selected_path or open_file_picker('application', str(title or 'Select application')[:160])
    if not selected:
        return None
    path = os.path.realpath(selected)
    kind = _application_kind(path)
    key = requested_key or f'app_{secrets.token_urlsafe(18)}'
    label = os.path.splitext(os.path.basename(path.rstrip('\\/')))[0] or 'Application'
    entry = {
        'path': path,
        'kind': kind,
        'label': label[:160],
        'approvedAt': int(time.time() * 1000),
        'iconDataUrl': _application_icon_data_url(path)
    }
    config = load_config()
    config.setdefault('approvedApplications', {})[key] = entry
    save_config(config)
    return _application_public_record(key, entry)


def approve_application_link(app_key='', title='Application', target_uri='', icon_hint=''):
    requested_key = str(app_key or '')
    if requested_key and not APPLICATION_KEY_PATTERN.fullmatch(requested_key):
        raise ValueError('Application key is invalid')
    target = _validated_application_uri(target_uri)
    key = requested_key or f'app_{secrets.token_urlsafe(18)}'
    fallback_label = urllib.parse.urlsplit(target).scheme or 'Application'
    entry = {
        'targetUri': target,
        'kind': 'protocol-link',
        'label': str(title or fallback_label)[:160],
        'approvedAt': int(time.time() * 1000),
        'iconDataUrl': _application_link_icon_data_url(target, icon_hint)
    }
    config = load_config()
    config.setdefault('approvedApplications', {})[key] = entry
    save_config(config)
    return _application_public_record(key, entry)


def resolve_approved_application(app_key, require_exists=True):
    key = str(app_key or '')
    if not APPLICATION_KEY_PATTERN.fullmatch(key):
        raise ValueError('Application key is invalid')
    entry = load_config().get('approvedApplications', {}).get(key)
    if not isinstance(entry, dict):
        raise ValueError('Application is not approved on this device')
    if entry.get('kind') == 'protocol-link':
        return _validated_application_uri(entry.get('targetUri', '')), entry
    path = os.path.realpath(str(entry.get('path', '') or ''))
    exists = os.path.isdir(path) if entry.get('kind') == 'app-bundle' else os.path.isfile(path)
    if require_exists and not exists:
        raise FileNotFoundError('The approved application is missing or unavailable')
    if exists and _application_kind(path) != entry.get('kind'):
        raise ValueError('The approved application type changed; approve it again')
    return path, entry


def application_status(app_key):
    try:
        _, entry = resolve_approved_application(app_key)
        public = _application_public_record(str(app_key), entry)
        if not public['iconDataUrl']:
            config = load_config()
            stored = config.get('approvedApplications', {}).get(str(app_key), {})
            if stored.get('kind') == 'protocol-link':
                icon_data = _application_link_icon_data_url(stored.get('targetUri', ''))
            else:
                path = stored.get('path', '')
                icon_data = _application_icon_data_url(path) if path else ''
            if icon_data:
                stored['iconDataUrl'] = icon_data
                save_config(config)
                public['iconDataUrl'] = icon_data
        return public
    except FileNotFoundError:
        return {'appKey': str(app_key or ''), 'label': 'Application', 'kind': '', 'state': 'missing', 'iconDataUrl': ''}
    except ValueError as error:
        state = 'unbound' if 'not approved' in str(error) else 'changed'
        return {'appKey': str(app_key or ''), 'label': 'Application', 'kind': '', 'state': state, 'iconDataUrl': ''}


def launch_approved_application(app_key):
    path, entry = resolve_approved_application(app_key)
    if sys.platform == 'win32':
        kind = entry.get('kind')
        if kind == 'executable':
            subprocess.Popen([path], cwd=os.path.dirname(path) or None, close_fds=True)
        else:
            subprocess.Popen(
                ['explorer.exe', path], close_fds=True,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', path], close_fds=True) if entry.get('kind') == 'app-bundle' else subprocess.Popen([path], close_fds=True)
    elif entry.get('kind') == 'desktop-entry':
        launcher = shutil.which('gio')
        if not launcher:
            raise RuntimeError('No supported desktop-entry launcher was found')
        subprocess.Popen([launcher, 'launch', path], close_fds=True)
    else:
        subprocess.Popen([path], close_fds=True)
    return True


def reveal_approved_application(app_key):
    path, entry = resolve_approved_application(app_key)
    if entry.get('kind') == 'protocol-link':
        raise ValueError('Application protocol links do not have a file to reveal')
    if sys.platform == 'win32':
        subprocess.Popen(['explorer.exe', '/select,', path])
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', '-R', path], close_fds=True)
    else:
        subprocess.Popen(['xdg-open', os.path.dirname(path) or path], close_fds=True)
    return True


def forget_approved_application(app_key):
    key = str(app_key or '')
    if not APPLICATION_KEY_PATTERN.fullmatch(key):
        raise ValueError('Application key is invalid')
    config = load_config()
    removed = config.get('approvedApplications', {}).pop(key, None)
    save_config(config)
    return removed is not None


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

    elif msg_type == 'APPROVE_APPLICATION':
        try:
            reply_ok(application=approve_application(msg.get('appKey', ''), msg.get('title', 'Select application')))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'APPROVE_APPLICATION_LINK':
        try:
            reply_ok(application=approve_application_link(
                msg.get('appKey', ''), msg.get('title', 'Application'), msg.get('targetUri', ''), msg.get('iconHint', '')
            ))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'GET_APPLICATION_STATUS':
        try:
            reply_ok(application=application_status(msg.get('appKey', '')))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'LAUNCH_APPROVED_APPLICATION':
        try:
            launch_approved_application(msg.get('appKey', ''))
            reply_ok()
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'REVEAL_APPROVED_APPLICATION':
        try:
            reveal_approved_application(msg.get('appKey', ''))
            reply_ok()
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'FORGET_APPROVED_APPLICATION':
        try:
            reply_ok(removed=forget_approved_application(msg.get('appKey', '')))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'EMUGUI_STATUS':
        try:
            reply_ok(emugui=emugui_service_status())
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'EMUGUI_AUTHORIZE_PAGE':
        try:
            reply_ok(authorized=authorize_emugui_page(msg.get('pageUrl', '')))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'EMUGUI_API':
        try:
            reply_ok(transfer=start_emugui_transfer(emugui_api_request(
                msg.get('method', ''), msg.get('path', ''), msg.get('query', {}), msg.get('body', {})
            )))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'EMUGUI_ASSET':
        try:
            reply_ok(transfer=start_emugui_transfer(emugui_asset(msg.get('path', ''))))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'EMUGUI_TRANSFER_CHUNK':
        try:
            reply_ok(transfer=read_emugui_transfer_chunk(msg.get('transferId', ''), msg.get('offset', 0)))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'EMUGUI_CREATE_HUB_BINDING':
        try:
            reply_ok(game=create_emugui_game_binding(
                msg.get('gameId', ''), msg.get('emulatorId', ''), msg.get('profileId', '')
            ))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'GAME_STATUS':
        try:
            reply_ok(game=emugui_game_status(msg.get('gameKey', ''), msg.get('includeThumbnail') is True))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'LAUNCH_GAME':
        try:
            launch_emugui_game(msg.get('gameKey', ''))
            reply_ok()
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'OPEN_GAME_IN_EMUGUI':
        try:
            reply_ok(url=emugui_game_link(msg.get('gameKey', ''), msg.get('rebind') is True))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'REVEAL_GAME':
        try:
            reveal_emugui_game(msg.get('gameKey', ''))
            reply_ok()
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'REBIND_GAME':
        try:
            reply_ok(game=rebind_emugui_game(
                msg.get('gameKey', ''), msg.get('gameId', ''),
                msg.get('emulatorId', ''), msg.get('profileId', '')
            ))
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'FORGET_GAME':
        try:
            reply_ok(removed=forget_emugui_game(msg.get('gameKey', '')))
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
