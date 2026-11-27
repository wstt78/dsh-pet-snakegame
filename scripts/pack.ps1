# 打包成便携版 exe：复制本机已装好的 Electron 运行时 + 程序文件，不联网、不装打包器。
# 产物：dist\WhaleSnakePet\WhaleSnakePet.exe（双击运行，托盘图标右键有设置/退出）
param([string]$Name = 'WhaleSnakePet')
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist'
$out = Join-Path $root "dist\$Name"

if (-not (Test-Path (Join-Path $electron 'electron.exe'))) {
  throw "找不到 $electron\electron.exe；先跑 node node_modules\electron\install.js"
}
if (Test-Path $out) {
  $resolved = (Resolve-Path $out).Path
  if ($resolved -notlike (Join-Path $root 'dist\*')) { throw "拒绝删除非 dist 目录：$resolved" }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

New-Item -ItemType Directory -Path $out -Force | Out-Null
Copy-Item (Join-Path $electron '*') $out -Recurse -Force

$res = Join-Path $out 'resources'
Remove-Item (Join-Path $res 'default_app.asar') -Force -ErrorAction SilentlyContinue

# Electron 启动时优先加载 resources\app（没有 app.asar 时）
$app = Join-Path $res 'app'
New-Item -ItemType Directory -Path $app -Force | Out-Null
foreach ($item in @('src', 'assets', 'bin', 'package.json')) {
  Copy-Item (Join-Path $root $item) $app -Recurse -Force
}

# 便携版入口是 Electron 的 src/main.js，而仓库根 package.json 的 main 指向 DSH bundle 的 index.mjs（未打包进 app）
$pkgPath = Join-Path $app 'package.json'
$env:PET_PKG_PATH = $pkgPath
node -e "const fs=require('fs');const p=process.env.PET_PKG_PATH;const j=JSON.parse(fs.readFileSync(p,'utf8'));j.main='src/main.js';delete j.dsh;fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')"
	Remove-Item Env:\PET_PKG_PATH

Rename-Item (Join-Path $out 'electron.exe') "$Name.exe"

$readme = @"
鲸鱼娘桌宠贪吃蛇（便携版）
================================
双击 $Name.exe 启动。托盘图标右键：玩一会儿 / 设置… / 退出。

热键：Ctrl+Alt+S 玩一会儿；Ctrl+Alt+Shift+Q 退出。
设置：托盘菜单「设置…」或桌面右键宠物；改完保存立即生效。
配置：config.json 与 exe 同目录（resources\app\config.json），可手工改。
日志：resources\app\logs\main.log。
卸载：整个文件夹删掉即可（不会写注册表）。

注意：首次运行 Windows SmartScreen 可能提示「未知发布者」，
选择「更多信息 → 仍要运行」即可（本程序未做代码签名）。
"@
$readme | Set-Content -LiteralPath (Join-Path $out '使用说明.txt') -Encoding UTF8

$size = [math]::Round(((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 0)
Write-Host "[OK] 已打包 $out （$size MB）"
