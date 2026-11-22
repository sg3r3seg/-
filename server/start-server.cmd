@echo off
chcp 65001 >nul
title LiveX Server (test)
cd /d "%~dp0"
echo.
echo  LIVEX - local test server
echo  =========================
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js 22 or newer is required. Download it from https://nodejs.org and run this file again.
  start "" https://nodejs.org/en/download
  pause & exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo  Your Node.js version is too old. Install Node.js 22.13 or newer from https://nodejs.org
  pause & exit /b 1
)
if not exist "keys\token_ed25519.pem" (
  echo  Missing server keys. Extract livex-dev-server-keys.zip into this folder,
  echo  so that a "keys" folder sits next to this file, then run it again.
  pause & exit /b 1
)
if not exist "node_modules" (
  echo  Installing server components - first run only...
  call npm ci --omit=dev --no-audit --no-fund
  if errorlevel 1 ( echo  Installation failed. & pause & exit /b 1 )
)
echo  Server: http://127.0.0.1:8787   (keep this window open while using LiveX)
start "" http://127.0.0.1:8787
node --disable-warning=ExperimentalWarning src\index.js
pause
