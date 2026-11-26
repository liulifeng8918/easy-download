param([Parameter(Mandatory=$true)][string]$TargetDirectory,[Parameter(Mandatory=$true)][string]$BackupRoot)
$ErrorActionPreference='Stop'
$sourceRoot=Split-Path $PSScriptRoot -Parent
$targetRoot=(Resolve-Path -LiteralPath $TargetDirectory).Path
$appRoot=Join-Path $targetRoot 'resources\app'
$exeName=([string][char]0x6613)+([char]0x4E0B)+([char]0x8F7D)+'.exe'
$targetExe=Join-Path $targetRoot $exeName
if(!(Test-Path -LiteralPath $targetExe)){throw 'Missing target app'}
if((Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).name -ne 'easy-download'){throw 'Unexpected target'}
$engine=Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'easy_download_sidecar.exe' -and $_.ExecutablePath -eq (Join-Path $appRoot 'runtime\easy_download_sidecar.exe')} | Select-Object -First 1
if($engine){
 $match=[regex]::Match($engine.CommandLine,'--token(?:=|\s+)"?([^"\s]+)')
 if(!$match.Success){throw 'Session not identified'}
 $state=Invoke-RestMethod 'http://127.0.0.1:17893/v1/downloads' -Headers @{'x-easy-download-session'=$match.Groups[1].Value}
 if(@($state.tasks | Where-Object {$_.status -in @('running','queued','verifying')}).Count){throw 'Active downloads; update stopped'}
}
$files=@('python/download_engine.py','runtime/easy_download_sidecar.exe','bin/yt-dlp-youtube.exe')
$data=@(Get-ChildItem -LiteralPath (Join-Path $appRoot 'user-data\local\EasyDownload') -File | ForEach-Object {[pscustomobject]@{Path=$_.FullName;Hash=(Get-FileHash -LiteralPath $_.FullName).Hash}})
$oldEngineHash=(Get-FileHash -LiteralPath (Join-Path $appRoot 'bin\yt-dlp.exe')).Hash
$backup=Join-Path $BackupRoot ('EasyDownload-before-youtube-20261127-'+(Get-Date -Format 'HHmmss'))
New-Item -ItemType Directory -Path $backup | Out-Null
foreach($relative in $files){
 $from=Join-Path $appRoot $relative
 if(Test-Path -LiteralPath $from){$to=Join-Path $backup $relative;New-Item -ItemType Directory -Path (Split-Path $to) -Force | Out-Null;Copy-Item -LiteralPath $from -Destination $to}
}
$windows=@(Get-Process | Where-Object {$_.Path -eq $targetExe -and $_.MainWindowHandle -ne 0})
foreach($window in $windows){if(!$window.CloseMainWindow() -or !$window.WaitForExit(15000)){throw 'App still running; update stopped'}}
foreach($relative in $files){
 $from=Join-Path $sourceRoot $relative;$to=Join-Path $appRoot $relative
 Copy-Item -LiteralPath $from -Destination $to
 if((Get-FileHash -LiteralPath $from).Hash -ne (Get-FileHash -LiteralPath $to).Hash){throw 'Resource verification failed'}
}
if(@($data | Where-Object {(Get-FileHash -LiteralPath $_.Path).Hash -ne $_.Hash}).Count){throw 'User data unexpectedly changed'}
if((Get-FileHash -LiteralPath (Join-Path $appRoot 'bin\yt-dlp.exe')).Hash -ne $oldEngineHash){throw 'Generic engine unexpectedly changed'}
[pscustomobject]@{target=$targetRoot;backup=$backup;files=$files;userDataUnchanged=$true;genericEngineUnchanged=$true} | ConvertTo-Json | Out-File (Join-Path $sourceRoot 'output\youtube-fix-20261127\local-update.json') -Encoding utf8
Start-Process -FilePath $targetExe -WorkingDirectory $targetRoot -WindowStyle Hidden
Write-Output 'Local update applied; original engine and saved user data preserved'
