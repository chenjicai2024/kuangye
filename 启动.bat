@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title Kuangye Desktop Agent

echo ========================================
echo  Kuangye Desktop Agent
echo ========================================
echo.

if not exist "package.json" (
  echo [ERROR] package.json not found.
  echo Please put this file in the project root directory.
  echo Current directory: %cd%
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm is not installed or not in PATH.
  echo Please install Node.js LTS first: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [ERROR] Dependencies are not installed.
  echo Run this command first:
  echo   npm install
  pause
  exit /b 1
)

if not exist "out\main\index.js" (
  echo [INFO] Build output not found. Building first...
  call npm run build
  if errorlevel 1 goto failed
  echo.
)

echo Starting app...
call npm start
if errorlevel 1 goto failed

exit /b 0

:failed
echo.
echo [ERROR] Program exited with code %errorlevel%.
pause
exit /b %errorlevel%
