@echo off
rem Ordo ADB runner - double-click to start.
rem First run asks for the server and the branch login and saves them;
rem after that it starts on its own and drives every device plugged in by USB.
rem It restarts itself if it ever exits, so it can be left running all day.
rem   ordo-adb.bat setup      change the saved login
rem   ordo-adb.bat devices    list the plugged-in devices
rem   ordo-adb.bat dump       print what is on a device screen
rem   ordo-adb.bat test NAME  run one task from the config once
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0.."
set PY=python
where python >nul 2>nul || set PY=py -3
%PY% --version >nul 2>nul
if errorlevel 1 (
  echo Python is not installed. Install Python 3.9 or newer from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" in the installer, then run this file again.
  pause
  exit /b 1
)
if not "%~1"=="" (
  %PY% -m adb %*
  pause
  exit /b
)
:loop
%PY% -m adb
echo.
echo Runner stopped. Restarting in 5 seconds - close this window to stop for good.
timeout /t 5 >nul
goto loop
