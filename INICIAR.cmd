@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js para iniciar o CRM local.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:4173"
node serve.mjs
pause
