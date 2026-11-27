@echo off
rem 定格模式：sleep / wander / coursing / dying / quietExit，45 秒后自动退出。
setlocal
set "ELECTRON_RUN_AS_NODE="
set "POSE=%~1"
if "%POSE%"=="" set "POSE=wander"
cd /d "%~dp0.."
start "" "node_modules\electron\dist\electron.exe" "src\main.js" "--pose=%POSE%"
