@echo off
REM Miami Job Corps Inventory Dashboard — Library Setup Script (Windows)
REM Run this once to download all required libraries for offline use.
REM Double-click this file or run from Command Prompt.

echo ======================================
echo  MJC Inventory Dashboard Setup
echo ======================================
echo.

if not exist libs mkdir libs

echo Downloading libraries...
echo.

powershell -Command "Invoke-WebRequest -Uri 'https://cdnjs.cloudflare.com/ajax/libs/JsBarcode/3.11.5/JsBarcode.all.min.js' -OutFile 'libs\JsBarcode.all.min.js'" && echo   OK: JsBarcode.all.min.js || echo   FAILED: JsBarcode.all.min.js

powershell -Command "Invoke-WebRequest -Uri 'https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.4.4/lz-string.min.js' -OutFile 'libs\lz-string.min.js'" && echo   OK: lz-string.min.js || echo   FAILED: lz-string.min.js

powershell -Command "Invoke-WebRequest -Uri 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js' -OutFile 'libs\qrcode.min.js'" && echo   OK: qrcode.min.js || echo   FAILED: qrcode.min.js

powershell -Command "Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js' -OutFile 'libs\supabase.min.js'" && echo   OK: supabase.min.js || echo   FAILED: supabase.min.js

echo.
echo ======================================
echo  Setup complete!
echo  Open inventory_dashboard_offline.html
echo  in your browser to use offline mode.
echo ======================================
echo.
pause
