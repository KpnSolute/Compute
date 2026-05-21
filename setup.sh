#!/bin/bash
# Miami Job Corps Inventory Dashboard — Library Setup Script
# Run this once to download all required libraries for offline use.
# Usage: bash setup.sh

echo "======================================"
echo " MJC Inventory Dashboard Setup"
echo "======================================"

mkdir -p libs

echo ""
echo "Downloading libraries..."

download() {
  local url="$1"
  local file="$2"
  if command -v curl &>/dev/null; then
    curl -sL "$url" -o "libs/$file" && echo "  ✓ $file" || echo "  ✗ Failed: $file"
  elif command -v wget &>/dev/null; then
    wget -q "$url" -O "libs/$file" && echo "  ✓ $file" || echo "  ✗ Failed: $file"
  else
    echo "  ✗ No curl or wget found. Please install one and retry."
    exit 1
  fi
}

download "https://cdnjs.cloudflare.com/ajax/libs/JsBarcode/3.11.5/JsBarcode.all.min.js"  "JsBarcode.all.min.js"
download "https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.4.4/lz-string.min.js"       "lz-string.min.js"
download "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"           "qrcode.min.js"
download "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"  "supabase.min.js"

echo ""
echo "======================================"
echo " Setup complete!"
echo " Open inventory_dashboard_offline.html"
echo " in your browser to use offline mode."
echo "======================================"
