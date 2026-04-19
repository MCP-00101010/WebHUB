#!/usr/bin/env bash
# Morpheus WebHub — native messaging host installer (Linux / macOS)
# Run from the extension/native/ directory:
#   bash install.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Morpheus WebHub — native host installer"
echo ""

# --- Find Python ---
PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
        PYTHON=$(command -v "$cmd")
        break
    fi
done
if [ -z "$PYTHON" ]; then
    echo "ERROR: Python 3 not found. Install Python 3 and ensure it is in PATH."
    exit 1
fi
echo "Python  : $PYTHON"

HOST="$SCRIPT_DIR/morpheus_host.py"
chmod +x "$HOST"

# --- Write manifest ---
if [[ "$OSTYPE" == "darwin"* ]]; then
    MANIFEST_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
else
    MANIFEST_DIR="$HOME/.mozilla/native-messaging-hosts"
fi

mkdir -p "$MANIFEST_DIR"
MANIFEST="$MANIFEST_DIR/morpheus_webhub.json"

cat > "$MANIFEST" <<JSON
{
  "name": "morpheus_webhub",
  "description": "Morpheus WebHub native messaging host",
  "path": "$HOST",
  "type": "stdio",
  "allowed_extensions": ["morpheus-webhub@local"]
}
JSON

echo "Manifest: $MANIFEST"
echo ""
echo "Installation complete."
echo "Restart Firefox to activate the native host."
