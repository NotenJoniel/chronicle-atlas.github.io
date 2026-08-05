@echo off
setlocal
set PORT=8420
if not "%~1"=="" set PORT=%~1

start "" cmd /c "timeout /t 1 >nul & start http://localhost:%PORT%/index.html"
node "%~dp0serve.js" %PORT%
