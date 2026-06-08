#!/bin/bash
# NST Solutions - cPanel Hostking Setup Script
# Run this once via SSH: bash setup.sh

set -e

echo "=== NST Solutions Setup ==="

# 1. Install Node.js dependencies
echo "[1/3] Installing Node.js dependencies..."
cd ~/domains/nstsolutions.co.za/public_html/server
npm install --production
echo "    Done."

# 2. Install Python reportlab for PDF generation
echo "[2/3] Installing Python reportlab..."
PYTHON=$(which python3 2>/dev/null || which python 2>/dev/null)
if [ -z "$PYTHON" ]; then
  echo "    WARNING: Python not found. PDF export will not work."
else
  echo "    Python found at: $PYTHON"
  $PYTHON -m pip install --user reportlab 2>/dev/null \
    || pip3 install --user reportlab 2>/dev/null \
    || echo "    WARNING: Could not install reportlab. Try manually: pip3 install reportlab"
  echo "    Done."
fi

# 3. Verify .env exists
echo "[3/3] Checking .env file..."
if [ -f .env ]; then
  echo "    .env found."
else
  echo "    ERROR: .env file missing! Upload server/.env before running this script."
  exit 1
fi

echo ""
echo "=== Setup complete! ==="
echo "Now go to cPanel > Node.js Apps and click 'Restart' on your app."
