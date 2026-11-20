@echo off
rem Start the ResiboBZ dev server on http://localhost:3000 and open it in the default browser.
rem The server runs in its own window; close that window to stop it.
setlocal
cd /d "%~dp0"
set "URL=http://localhost:3000"

rem Already running? Just open the browser.
call :ping && goto open

rem Use npx.cmd's full path: called by a quoted bare name it can't find its own folder.
set "NPX="
for /f "delims=" %%i in ('where npx.cmd 2^>nul') do if not defined NPX set "NPX=%%i"
if not defined NPX set "NPX=%ProgramFiles%\nodejs\npx.cmd"
if not exist "%NPX%" (
  echo Node.js not found. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
rem `call` first, so cmd /k doesn't strip the quotes around a path with spaces.
start "ResiboBZ server" cmd /k call "%NPX%" --yes serve . -l 3000 --no-clipboard

rem Wait up to 60s for the server (the first run downloads `serve`).
set /a tries=0
:wait
call :ping && goto open
set /a tries+=1
if %tries% geq 60 (
  echo Server did not start. Check the "ResiboBZ server" window for errors.
  pause
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait

:open
start "" "%URL%"
exit /b 0

:ping
powershell -NoProfile -Command "try { Invoke-WebRequest '%URL%' -UseBasicParsing -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
exit /b %errorlevel%
