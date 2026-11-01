param(
    [Parameter(Mandatory=$true)][string]$TargetDirectory,
    [Parameter(Mandatory=$true)][string]$BackupRoot
)
$ErrorActionPreference='Stop'
$sourceRoot=Split-Path $PSScriptRoot -Parent
$targetRoot=(Resolve-Path -LiteralPath $TargetDirectory).Path
$appRoot=Join-Path $targetRoot 'resources\app'
$exeName=([string][char]0x6613)+([char]0x4E0B)+([char]0x8F7D)+'.exe'
$targetExe=Join-Path $targetRoot $exeName
if(!(Test-Path -LiteralPath $targetExe)){throw 'Target executable is missing'}
if((Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).name -ne 'easy-download'){throw 'Not an Easy Download folder'}
$files=@('package.json','electron/main.cjs','electron/renderer/app.html','electron/download/yifan-resolver.cjs','electron/download/yifan-browser.cjs')
foreach($relative in $files){if(!(Test-Path -LiteralPath (Join-Path $sourceRoot $relative))){throw 'Incomplete source update'}}
$engines=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'easy_download_sidecar.exe' -and $_.ExecutablePath -eq (Join-Path $appRoot 'runtime\easy_download_sidecar.exe') })
if($engines.Count){
    $match=[regex]::Match($engines[0].CommandLine,'--token(?:=|\s+)"?([^"\s]+)')
    if(!$match.Success){throw 'Cannot safely identify current application session'}
    $state=Invoke-RestMethod 'http://127.0.0.1:17893/v1/downloads' -Headers @{'x-easy-download-session'=$match.Groups[1].Value}
    if(@($state.tasks | Where-Object { $_.status -in @('running','queued','verifying') }).Count){throw 'Downloads are active; update cancelled'}
}
$dataRoot=Join-Path $appRoot 'user-data'
$data=@(Get-ChildItem -LiteralPath $dataRoot -Filter '*.dat' -Recurse -File | ForEach-Object {[pscustomobject]@{Path=$_.FullName;Hash=(Get-FileHash -LiteralPath $_.FullName).Hash}})
$settings=Get-ChildItem -LiteralPath $dataRoot -Filter 'settings.json' -Recurse -File | ForEach-Object {[pscustomobject]@{Path=$_.FullName;Hash=(Get-FileHash -LiteralPath $_.FullName).Hash}}
$data+=@($settings)
$backup=Join-Path $BackupRoot ('EasyDownload-before-1.0.3-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup | Out-Null
foreach($relative in $files){
    $oldFile=Join-Path $appRoot $relative
    if(Test-Path -LiteralPath $oldFile){
        $backupFile=Join-Path $backup ('resources\app\'+$relative)
        New-Item -ItemType Directory -Path (Split-Path $backupFile) -Force | Out-Null
        Copy-Item -LiteralPath $oldFile -Destination $backupFile
    }
}
# Close only the selected application's top-level window, never unrelated apps.
$processes=@(Get-Process | Where-Object { $_.Path -eq $targetExe -and $_.MainWindowHandle -ne 0 })
foreach($process in $processes){
    if(!$process.CloseMainWindow()){throw 'Please close the selected application manually'}
    if(!$process.WaitForExit(15000)){throw 'Application is still open; files were not replaced'}
}
foreach($relative in $files){
    $from=Join-Path $sourceRoot $relative
    $to=Join-Path $appRoot $relative
    Copy-Item -LiteralPath $from -Destination $to
    if((Get-FileHash -LiteralPath $from).Hash -ne (Get-FileHash -LiteralPath $to).Hash){throw 'Updated resource verification failed'}
}
$unchanged=@($data | Where-Object {(Get-FileHash -LiteralPath $_.Path).Hash -ne $_.Hash}).Count -eq 0
if(!$unchanged){throw 'User data changed unexpectedly; inspect backup before continuing'}
$report=[pscustomobject]@{target=$targetRoot;backup=$backup;files=$files;userDataFiles=$data.Count;userDataUnchanged=$unchanged;at=(Get-Date -Format o)}
$report | ConvertTo-Json -Depth 4 | Out-File -LiteralPath (Join-Path $sourceRoot 'output\local-update-1.0.3.json') -Encoding utf8
Start-Process -FilePath $targetExe -WorkingDirectory $targetRoot -WindowStyle Hidden
$report | ConvertTo-Json -Depth 4
