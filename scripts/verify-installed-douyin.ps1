param([Parameter(Mandatory=$true)][string]$TargetRoot)
$ErrorActionPreference='Stop'
$listener=Get-NetTCPConnection -LocalPort 17893 -State Listen
$engine=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listener.OwningProcess)
if(!$engine.ExecutablePath.StartsWith($TargetRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Another app owns the download engine port'}
$match=[regex]::Match($engine.CommandLine,'--token(?:=|\s+)"?([^\s"]+)')
if(!$match.Success){throw 'Local session unavailable'}
$sessionHeaders=@{'X-Easy-Download-Session'=$match.Groups[1].Value}
$pair=Invoke-RestMethod -Uri 'http://127.0.0.1:17893/v1/pairing' -Headers $sessionHeaders
$bridgeHeaders=@{'X-Easy-Download-Bridge'=$pair.bridgeToken}
$log=Join-Path $TargetRoot 'resources\app\user-data\roaming\douyin-diagnostic.log'
# Public sample IDs recovered from this installation's own diagnostic log.
$ids=@('7702667586101611802','7699923227975355690','7699923227975355690')
foreach($id in $ids){
  $start=[DateTimeOffset]::UtcNow
  $body=@{url=('https://www.douyin.com/video/'+$id);mode='direct'}|ConvertTo-Json -Compress
  $accepted=Invoke-RestMethod -Uri 'http://127.0.0.1:17894/v1/browser/submit' -Method Post -Headers $bridgeHeaders -ContentType 'application/json' -Body $body
  if(!$accepted.ok){throw 'Browser entry did not accept the sample'}
  Write-Output ('START '+$id)
  $completed=$false
  $deadline=[DateTime]::UtcNow.AddSeconds(180)
  while([DateTime]::UtcNow -lt $deadline){
    if(Test-Path -LiteralPath $log){
      $events=Get-Content -LiteralPath $log | ForEach-Object {try{$_|ConvertFrom-Json}catch{}}
      $result=$events|Where-Object {$_.kind -eq 'download-status' -and $_.videoId -eq $id -and [DateTimeOffset]::Parse($_.at) -ge $start -and $_.status -in @('completed','failed')}|Select-Object -Last 1
      if($result){
        if($result.status -eq 'failed'){throw ('Installed sample failed: '+$result.error)}
        $completed=$true
        $result|Select-Object videoId,status,codec,hasAudio,hasVideo|ConvertTo-Json -Compress|Write-Output
        break
      }
    }
    Start-Sleep -Milliseconds 500
  }
  if(!$completed){throw ('Installed sample verification timed out: '+$id)}
}
Write-Output 'PASS installed folder, both samples and repeat submission'
