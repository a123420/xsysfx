@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo 正在安装依赖...
  call npm install
)
echo 启动像素陨石防线服务...
call npm start
pause
