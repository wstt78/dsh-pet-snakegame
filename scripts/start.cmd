@echo off
rem 正常启动：桌宠常驻。必须清掉 ELECTRON_RUN_AS_NODE，否则 electron.exe 会当 node 跑、不出窗口。
setlocal
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0.."
start "" "node_modules\electron\dist\electron.exe" "src\main.js"
