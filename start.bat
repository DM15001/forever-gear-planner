@echo off
rem Starts the gear planner on this PC and opens it in the browser. Needs Node.js 20 or newer (https://nodejs.org).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org, install it, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules\@fontsource\cinzel (
  echo Installing packages, this takes a minute the first time...
  call npm install
  if errorlevel 1 (
    echo npm install failed. See the messages above.
    pause
    exit /b 1
  )
)
echo Starting the gear planner. Close this window to stop it.
call npm run dev -- --open
pause
