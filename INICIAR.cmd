@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  if exist "demo\APRESENTAR-CRM.html" (
    start "" "%~dp0demo\APRESENTAR-CRM.html"
    exit /b 0
  )
  echo Extraia a pasta completa do projeto. A demonstracao nao foi encontrada.
  pause
  exit /b 1
)
if not exist "serve.mjs" (
  echo Extraia a pasta completa do projeto antes de iniciar.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:4173"
node serve.mjs
pause
