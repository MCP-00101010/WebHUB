#!/usr/bin/env bash
# Morpheus WebHub — native messaging host installer (Linux / macOS)
# Run from the extension/native/ directory:
#   bash install.sh
# Optional for temporary/debug add-ons:
#   bash install.sh morpheus-webhub@local '<temporary-id>'

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALLOWED_EXTENSIONS=("$@")
if [ ${#ALLOWED_EXTENSIONS[@]} -eq 0 ]; then
    ALLOWED_EXTENSIONS=("morpheus-webhub@local")
fi

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
echo "Allowed : ${ALLOWED_EXTENSIONS[*]}"

ALLOWED_JSON=$(printf '%s\n' "${ALLOWED_EXTENSIONS[@]}" | "$PYTHON" -c 'import json,sys; print(json.dumps([line.strip() for line in sys.stdin if line.strip()]))')

HOST="$SCRIPT_DIR/morpheus_host.py"
chmod +x "$HOST"

# --- Write default config.json if missing ---
CONFIG="$SCRIPT_DIR/config.json"
if [ ! -f "$CONFIG" ]; then
cat > "$CONFIG" <<JSON
{
  "databasePath": ""
}
JSON
    echo "Config  : $CONFIG"
else
    echo "Config  : $CONFIG (existing)"
fi

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
  "allowed_extensions": $ALLOWED_JSON
}
JSON

echo "Manifest: $MANIFEST"
echo ""
echo "Installation complete."
echo "Restart Firefox to activate the native host."
