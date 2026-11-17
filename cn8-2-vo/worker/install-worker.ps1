param(
  [ValidateSet('install', 'start', 'stop', 'restart', 'status', 'uninstall')]
  [string]$Action = 'status'
)

$TaskName = 'CN82OfficeWorker'
$WorkerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Split-Path -Parent $WorkerDir
$WorkerScript = Join-Path $WorkerDir 'cn82-worker.mjs'
$ConfigFile = Join-Path $WorkerDir 'worker.local.json'
$LogDir = Join-Path $AppRoot '.office-data\worker'
$OutLog = Join-Path $LogDir 'worker.out.log'
$ErrLog = Join-Path $LogDir 'worker.err.log'

$NodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $NodePath) {
  Write-Error 'Không tìm thấy node.exe trong PATH. Hãy cài Node.js LTS trước.'
  exit 1
}

switch ($Action) {
  'install' {
    if (-not (Test-Path $ConfigFile)) {
      Write-Error "Chưa có $ConfigFile. Hãy sao chép worker.local.example.json thành worker.local.json trước."
      exit 1
    }
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $CmdArgs = "/c `"$NodePath`" `"$WorkerScript`" >> `"$OutLog`" 2>> `"$ErrLog`""
    $TaskAction = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $CmdArgs -WorkingDirectory $AppRoot
    $TriggerStartup = New-ScheduledTaskTrigger -AtLogOn
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 365)
    Register-ScheduledTask -TaskName $TaskName -Action $TaskAction -Trigger $TriggerStartup -Settings $Settings -Description 'CN8-2 Office Windows Background Worker Bridge' -Force | Out-Null
    Write-Host "Đã cài đặt tác vụ nền '$TaskName'. Chạy: .\install-worker.ps1 -Action start"
  }
  'start' {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Đã khởi động '$TaskName' chạy nền (không cần giữ cửa sổ terminal)."
  }
  'stop' {
    Stop-ScheduledTask -TaskName $TaskName
    Write-Host "Đã dừng '$TaskName'."
  }
  'restart' {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Đã khởi động lại '$TaskName'."
  }
  'status' {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) {
      Write-Host "Tác vụ '$TaskName' chưa được cài đặt."
    } else {
      $info = Get-ScheduledTaskInfo -TaskName $TaskName
      [PSCustomObject]@{
        TaskName = $TaskName
        State = $task.State
        LastRunTime = $info.LastRunTime
        LastTaskResult = $info.LastTaskResult
      } | Format-List
    }
  }
  'uninstall' {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Đã gỡ bỏ '$TaskName'."
  }
}
