# 班序 · Windows 启动脚本（首次会自动创建虚拟环境、安装依赖并构建前端）
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$venvPython = Join-Path $root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "首次启动：创建 Python 虚拟环境…"
    python -m venv backend\.venv
    if ($LASTEXITCODE -ne 0) { throw "创建虚拟环境失败，请确认已安装 Python 3.9+ 并加入 PATH" }
}
Write-Host "安装/更新后端依赖…"
& $venvPython -m pip install -q -r backend\requirements.txt
if ($LASTEXITCODE -ne 0) { throw "后端依赖安装失败" }

if (-not (Test-Path (Join-Path $root "frontend\node_modules"))) {
    Write-Host "安装前端依赖…"
    Push-Location frontend
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "前端依赖安装失败，请确认已安装 Node.js 20+" }
    Pop-Location
}
Write-Host "构建前端…"
Push-Location frontend
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "前端构建失败" }
Pop-Location

$listenHost = if ($env:BANXU_HOST) { $env:BANXU_HOST } else { "127.0.0.1" }
$port = if ($env:PORT) { $env:PORT } else { "8000" }
try {
    $health = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/api/health" -TimeoutSec 2
    if ($health.StatusCode -eq 200) {
        Write-Host "班序已在运行，直接打开：http://127.0.0.1:$port"
        Start-Process "http://127.0.0.1:$port"
        exit 0
    }
} catch { }

Write-Host "启动班序：http://127.0.0.1:$port （监听 $listenHost）"
Start-Process "http://127.0.0.1:$port"
& $venvPython -m uvicorn app.main:app --app-dir backend --host $listenHost --port $port
