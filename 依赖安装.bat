@echo off
setlocal EnableExtensions

echo ========================================
echo   Kuangye Desktop Agent - Install
echo ========================================
echo.

REM === Mirrors (env vars recognized by @electron/get and electron-builder) ===
set ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://cdn.npmmirror.com/binaries/electron-builder-binaries/

echo [1/3] npm install...
call npm install
if %ERRORLEVEL% neq 0 (
    echo.
    echo [FAIL] npm install error. Check network and retry.
    pause
    exit /b 1
)

echo.
echo [2/3] Verify Electron binary...
if exist "node_modules\electron\dist\electron.exe" if exist "node_modules\electron\path.txt" (
    echo       Electron binary OK, skip
    goto :check_native
)

echo       Binary missing, re-running install.js...
call node node_modules\electron\install.js
if exist "node_modules\electron\dist\electron.exe" (
    echo       Download OK
    goto :check_native
)

echo       Still missing, fallback: direct zip download...
for /f "delims=" %%v in ('node -p "require('./node_modules/electron/package.json').version"') do set EL_VER=%%v
echo       Target version: %EL_VER%
powershell -NoProfile -Command "$url='https://cdn.npmmirror.com/binaries/electron/%EL_VER%/electron-v%EL_VER%-win32-x64.zip'; $zip=\"$env:TEMP\electron-%EL_VER%.zip\"; Write-Host '  downloading: '$url; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing; Expand-Archive -Path $zip -DestinationPath 'node_modules\electron\dist' -Force; Set-Content -Path 'node_modules\electron\path.txt' -Value 'electron.exe' -NoNewline; Write-Host '  extracted'"
if not exist "node_modules\electron\dist\electron.exe" (
    echo.
    echo [FAIL] Electron binary download failed. Check network.
    echo        Manual: download and unzip to node_modules\electron\dist\
    echo        https://cdn.npmmirror.com/binaries/electron/%EL_VER%/electron-v%EL_VER%-win32-x64.zip
    pause
    exit /b 1
)

:check_native
echo.
echo [3/3] Verify native modules...
if exist "node_modules\@hurdlegroup\robotjs\build\Release\robotjs.node" (
    echo       robotjs OK
) else (
    echo       [WARN] robotjs missing, re-running electron-builder install-app-deps...
    call npx electron-builder install-app-deps
)

echo.
echo [DONE] All dependencies installed. Run start.bat to launch.
echo.
pause
