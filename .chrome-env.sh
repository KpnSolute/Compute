#!/bin/bash
export CHROME_PATH=/home/local/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome
export LD_LIBRARY_PATH=$(find /tmp/chromedeps/root -type d | tr '\n' ':')
exec "$@"
