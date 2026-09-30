# Installs the Counterwell shop gateway on the shop PC and keeps it running.
# Run by scripts/windows/install-gateway.mjs over SSH (Tailscale), which copies the settings as a
# file this script deletes after reading, so they never pass through anyone at the shop. Safe to
# run again: it updates the code, rewrites the settings and restarts the gateway.
#
#   CW_API_URL        the shop server, https://...
#   CW_BUSINESS_ID    the shop's ID on the server
#   CW_GATEWAY_TOKEN  shared with the server for health reports
#   CW_VERIFY_KEY     public key that checks phones' offline permissions (it cannot create them)
#   CW_PRINTER_HOST   receipt printer address on the shop Wi-Fi (optional; add it later)
#   CW_REPO_REF       git commit or branch to install (default main)

param([string]$SettingsFile)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# The runner copies the settings as a JSON file next to this script; read them, then delete it.
if ($SettingsFile) {
  $given = Get-Content -Raw -Path $SettingsFile | ConvertFrom-Json
  Remove-Item -Force $SettingsFile
  foreach ($p in $given.PSObject.Properties) { [Environment]::SetEnvironmentVariable($p.Name, [string]$p.Value) }
}
$Root = Join-Path $env:ProgramData 'Counterwell\gateway'
$App = Join-Path $Root 'app'
$Logs = Join-Path $Root 'logs'
$TaskName = 'Counterwell Gateway'
$Port = 4101

function Write-Step([string]$Text) { Write-Host "== $Text" }
function Need([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if (-not $value) { throw "$Name is required" }
  return $value
}
function Invoke-Checked([string]$File, [string[]]$Arguments, [string]$Where) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    Push-Location $Where
    & $File @Arguments 2>&1 | ForEach-Object { "   $_" }
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
    $ErrorActionPreference = $previous
  }
  if ($code -ne 0) { throw "$File $($Arguments -join ' ') failed with code $code" }
}

$apiUrl = Need 'CW_API_URL'
$businessId = Need 'CW_BUSINESS_ID'
$gatewayToken = Need 'CW_GATEWAY_TOKEN'
$verifyKey = Need 'CW_VERIFY_KEY'
$printer = [Environment]::GetEnvironmentVariable('CW_PRINTER_HOST')
$ref = [Environment]::GetEnvironmentVariable('CW_REPO_REF')
if (-not $ref) { $ref = 'main' }
if ($apiUrl -notmatch '^https://') { throw 'CW_API_URL must be an https:// address' }

$git = Join-Path $env:ProgramFiles 'Git\cmd\git.exe'
$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$npm = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
foreach ($tool in $git, $node, $npm) {
  if (-not (Test-Path $tool)) { throw "$tool is missing: run the shop PC setup first (it installs Git and Node.js)." }
}

Write-Step '1. Code'
New-Item -ItemType Directory -Force -Path $Root, $Logs | Out-Null
if (-not (Test-Path (Join-Path $App '.git'))) {
  Invoke-Checked $git @('clone', '--quiet', 'https://github.com/harshit0605/voice_reciepts.git', $App) $Root
}
Invoke-Checked $git @('fetch', '--quiet', 'origin', $ref) $App
Invoke-Checked $git @('reset', '--quiet', '--hard', 'FETCH_HEAD') $App
$commit = (& $git -C $App rev-parse --short HEAD).Trim()
Write-Host "   At commit $commit"

Write-Step '2. Gateway dependencies'
Invoke-Checked $npm @('install', '--omit=dev', '--no-audit', '--no-fund', '-w', '@counterwell/gateway', '-w', '@counterwell/core') $App
Invoke-Checked $npm @('install', '--global', '--no-audit', '--no-fund', 'tsx@4') $App
$tsx = Join-Path $env:APPDATA 'npm\tsx.cmd'
if (-not (Test-Path $tsx)) { $tsx = (Get-Command tsx.cmd -ErrorAction Stop).Source }

Write-Step '3. Settings'
$envFile = Join-Path $App '.env'
$lines = @(
  "BETTER_AUTH_URL=$apiUrl",
  "BUSINESS_ID=$businessId",
  "GATEWAY_TOKEN=$gatewayToken",
  "OFFLINE_VERIFY_KEY=$verifyKey",
  "GATEWAY_PORT=$Port",
  "GATEWAY_DATA_DIR=$(Join-Path $Root 'data')",
  "PRINTER_HOST=$printer",
  'TRUSTED_ORIGINS=counterwell://'
)
[IO.File]::WriteAllLines($envFile, $lines)
# Only administrators and the system can read the settings.
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($who in 'SYSTEM', 'Administrators') {
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($who, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
Set-Acl -Path $Root -AclObject $acl
Write-Host "   Wrote $envFile (administrators only)"

Write-Step '4. Start with Windows and restart if it stops'
$runner = Join-Path $Root 'run-gateway.cmd'
@(
  '@echo off',
  "cd /d `"$(Join-Path $App 'apps\gateway')`"",
  ':loop',
  "echo %date% %time% starting >> `"$(Join-Path $Logs 'gateway.log')`"",
  "call `"$tsx`" --env-file=..\..\.env src\index.ts >> `"$(Join-Path $Logs 'gateway.log')`" 2>&1",
  'timeout /t 10 /nobreak > nul',
  'goto loop'
) | Set-Content -Path $runner -Encoding ASCII
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*apps*gateway*src*index.ts*' -or $_.CommandLine -like '*src\index.ts*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$runner`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "   Task '$TaskName' registered and started"

Write-Step '5. Let phones on the shop Wi-Fi reach it'
$rule = Get-NetFirewallRule -DisplayName 'Counterwell Gateway' -ErrorAction SilentlyContinue
if (-not $rule) {
  New-NetFirewallRule -DisplayName 'Counterwell Gateway' -Direction Inbound -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet -Action Allow -Profile Any | Out-Null
}
Write-Host "   Port $Port open to the local network only"

Write-Step '6. Check'
$healthy = $false
for ($i = 0; $i -lt 30 -and -not $healthy; $i++) {
  Start-Sleep -Seconds 3
  try {
    $health = Invoke-RestMethod -UseBasicParsing -TimeoutSec 3 -Uri "http://localhost:$Port/health"
    $healthy = $health.ok -eq $true
  } catch { }
}
if (-not $healthy) {
  Get-Content (Join-Path $Logs 'gateway.log') -Tail 20 -ErrorAction SilentlyContinue
  throw 'The gateway did not answer on port 4101; the log is above.'
}
Write-Host "   Gateway answers. Printer configured: $($health.printerConfigured)"
$addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -notlike '100.*' } |
  Select-Object -ExpandProperty IPAddress
foreach ($address in $addresses) { Write-Host "   In the app, Administration > Local gateway URL: http://$($address):$Port" }
