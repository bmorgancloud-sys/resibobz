@echo off
rem ResiboBZ: double-click to start the dev server on http://localhost:3000 and open it.
rem Runs tools\server.js with Node's full path (PATH isn't reliable on double-click).
rem Keep this window open while you use the app; close it to stop the server.
setlocal
title ResiboBZ server

cd /d "%~dp0"
if errorlevel 1 goto no_folder

rem Find node.exe: the standard install path first, then PATH, then a per-user install.
set "NODE=C:\Program Files\nodejs\node.exe"
if exist "%NODE%" goto have_node
set "NODE="
for /f "delims=" %%i in ('where node.exe 2^>nul') do if not defined NODE set "NODE=%%i"
if defined NODE goto have_node
set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if exist "%NODE%" goto have_node
goto no_node

:have_node
echo Using Node: "%NODE%"
echo Project:    "%CD%"
echo.
"%NODE%" tools\server.js 3000
if errorlevel 1 goto server_failed
rem Exit code 0 means it was already running and the browser was opened.
ping -n 4 127.0.0.1 >nul
exit /b 0

:no_folder
echo ERROR: Could not open the project folder "%~dp0".
goto stay_open

:no_node
echo ERROR: Node.js was not found.
echo Looked in "C:\Program Files\nodejs\node.exe", on PATH, and in "%LOCALAPPDATA%\Programs\nodejs".
echo Install Node.js from https://nodejs.org and double-click start.bat again.
goto stay_open

:server_failed
echo The server stopped. See the error above.
goto stay_open

:stay_open
echo.
pause
exit /b 1
