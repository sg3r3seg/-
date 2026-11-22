@echo off
chcp 65001 >nul
title LiveX - issue KEYNAME
cd /d "%~dp0"
echo.
echo  LIVEX - issue a license KEYNAME
echo  ===============================
echo  The account must already exist (create it on http://127.0.0.1:8787/register.html).
echo.
where node >nul 2>nul || ( echo  Node.js 22 is required: https://nodejs.org & pause & exit /b 1 )
if not exist "keys\token_ed25519.pem" ( echo  Missing keys folder - extract livex-dev-server-keys.zip here first. & pause & exit /b 1 )
if not exist "node_modules" ( call npm ci --omit=dev --no-audit --no-fund || ( pause & exit /b 1 ) )
set /p EMAIL= Account email: 
echo  Product:  1 = LiveX PRO   2 = LiveX TTS   3 = COMPLETE BUNDLE
set /p CHOICE= Choose 1, 2 or 3: 
set PRODUCT=BUNDLE
if "%CHOICE%"=="1" set PRODUCT=PRO
if "%CHOICE%"=="2" set PRODUCT=TTS
node --disable-warning=ExperimentalWarning scripts\admin.js issue "%EMAIL%" %PRODUCT%
pause
