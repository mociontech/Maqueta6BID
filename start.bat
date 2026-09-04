@echo off
cd /d %~dp0
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
start "Maqueta 6 Server" cmd /k npm start
timeout /t 2 >nul
start http://localhost:3000/controller/
start http://localhost:3000/display/
