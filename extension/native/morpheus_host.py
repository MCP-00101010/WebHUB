#!/usr/bin/env python3
"""
Morpheus WebHub — native messaging host.
Handles file read/write and file-picker dialogs for the Firefox extension.
"""

import sys
import json
import struct
import os
import base64
import mimetypes


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
# File picker — try tkinter, fall back to PowerShell on Windows
# ---------------------------------------------------------------------------

def open_file_picker(accept='', title='Select file'):
    """
    Open a system file dialog and return (path, mime_type) or (None, None).
    `accept` is a hint: 'image' selects image filetypes.
    """
    filetypes_tk = []
    if accept == 'image':
        filetypes_tk = [('Image files', '*.png *.jpg *.jpeg *.gif *.webp *.svg *.bmp'), ('All files', '*.*')]
    else:
        filetypes_tk = [('All files', '*.*')]

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
            if accept == 'image':
                filter_str = 'Image Files (*.png,*.jpg,*.jpeg,*.gif,*.webp,*.bmp)|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp|All Files (*.*)|*.*'
            else:
                filter_str = 'All Files (*.*)|*.*'
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


def file_to_data_url(path):
    mime, _ = mimetypes.guess_type(path)
    if not mime:
        mime = 'application/octet-stream'
    with open(path, 'rb') as f:
        data = base64.b64encode(f.read()).decode('ascii')
    return f'data:{mime};base64,{data}'


# ---------------------------------------------------------------------------
# Message handlers
# ---------------------------------------------------------------------------

def handle(msg):
    msg_type = msg.get('type', '')

    if msg_type == 'PING':
        reply_ok(version='1.0')

    elif msg_type == 'READ_FILE':
        path = msg.get('path', '')
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            reply_ok(content=content)
        except FileNotFoundError:
            reply_ok(content=None)   # not found is not an error — caller falls back
        except Exception as e:
            reply_err(str(e))

    elif msg_type == 'WRITE_FILE':
        path = msg.get('path', '')
        content = msg.get('content', '')
        try:
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
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
