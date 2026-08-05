@echo off
setlocal
set PORT=8420
if not "%~1"=="" set PORT=%~1

echo Stopping process listening on port %PORT% ...
set FOUND=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  set FOUND=1
  echo   killing PID %%p
  taskkill /F /PID %%p >nul 2>&1
)
if "%FOUND%"=="0" (
  echo   no process was listening on port %PORT%.
) else (
  echo   stopped.
)
