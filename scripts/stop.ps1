$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root 'logs\app.pid'
if (-not (Test-Path $pidFile)) {
  Write-Output 'no logs\app.pid; app is probably not running'
  exit 0
}
$appPid = (Get-Content $pidFile -Raw).Trim()
$proc = Get-Process -Id $appPid -ErrorAction SilentlyContinue
if ($null -eq $proc) {
  Write-Output "PID $appPid is gone; removing stale pid file"
  Remove-Item $pidFile -Force
  exit 0
}
if ($proc.Path -notlike '*electron.exe') {
  Write-Output "PID $appPid is not electron.exe ($($proc.Path)); refuse to kill"
  exit 1
}
& taskkill /PID $appPid /T /F | Out-Null
Write-Output "stopped pet app (PID $appPid)"
