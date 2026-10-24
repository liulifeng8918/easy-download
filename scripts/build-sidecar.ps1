$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$spec = Join-Path $project 'packaging\easy_download_sidecar.spec'
$runtime = Join-Path $project 'runtime'
$work = Join-Path $project 'build\pyinstaller'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
& python -m PyInstaller --noconfirm --clean --distpath $runtime --workpath $work $spec
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed with exit code $LASTEXITCODE" }
