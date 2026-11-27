@echo off
rem 演示模式：无人值守跑完整状态机，26 秒后自动退出。用于截图/验收。
setlocal
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0.."
start "" "node_modules\electron\dist\electron.exe" "src\main.js" --demo
