@echo off
chcp 65001 >nul
title LiveX - create a test account
cd /d "%~dp0"
echo.
echo  LIVEX - create a ready-to-use account (email already verified) with a license
echo  =============================================================================
where node >nul 2>nul || ( echo  Node.js 22 is required: https://nodejs.org & pause & exit /b 1 )
if not exist "keys\token_ed25519.pem" ( echo  Missing keys folder - extract livex-dev-server-keys.zip here first. & pause & exit /b 1 )
if not exist "node_modules" ( call npm ci --omit=dev --no-audit --no-fund || ( pause & exit /b 1 ) )
set /p EMAIL= Email: 
set /p LIVEX_NEW_PASSWORD= Password (8+ chars, letters and numbers): 
set /p FIRST= First name: 
set /p LAST= Last name: 
echo  License:  1 = LiveX PRO   2 = LiveX TTS   3 = COMPLETE BUNDLE
set /p CHOICE= Choose 1, 2 or 3: 
set PRODUCT=BUNDLE
if "%CHOICE%"=="1" set PRODUCT=PRO
if "%CHOICE%"=="2" set PRODUCT=TTS
node --disable-warning=ExperimentalWarning scripts\admin.js create-account "%EMAIL%" "%FIRST%" "%LAST%" %PRODUCT%
set LIVEX_NEW_PASSWORD=
pause
