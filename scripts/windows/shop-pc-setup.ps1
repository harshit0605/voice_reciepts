# Counterwell shop PC setup: lets the owner reach this PC remotely over Tailscale,
# so the shop gateway and receipt printer can be installed and tested from outside the shop.
#
# Nothing here is hidden. Everything it changes is listed below and logged in
# C:\ProgramData\CounterwellRemote. It is safe to run again; each step skips what is already done.
#
#  1. Installs Tailscale and joins the owner's private network (runs unattended, starts with Windows).
#  2. Creates a local administrator account for remote support (default "cwsupport").
#  3. Installs the Windows OpenSSH server. Only the owner's SSH key can sign in, and only over Tailscale.
#  4. Enables Remote Desktop over Tailscale on Windows Pro (Windows Home cannot host it).
#  5. Keeps the PC awake while plugged in.
#  6. Installs Git and Node.js LTS, which the shop gateway needs.
#  7. Saves a report of this PC: Windows version, network, printers, installed software.
#
# Settings come from the generated setup file (scripts/windows/build-shop-pc-setup.mjs), or from
# environment variables when this file is run directly in an administrator PowerShell:
#   $env:CW_TAILSCALE_AUTHKEY = 'tskey-auth-...'
#   $env:CW_SSH_PUBLIC_KEY    = 'ssh-ed25519 AAAA... owner@laptop'
#   powershell -ExecutionPolicy Bypass -File shop-pc-setup.ps1

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $Settings) { $Settings = @{} }
function Get-Setting([string]$Name, [string]$EnvName, $Default) {
  if ($Settings.ContainsKey($Name) -and $Settings[$Name]) { return $Settings[$Name] }
  $fromEnv = [Environment]::GetEnvironmentVariable($EnvName)
  if ($fromEnv) { return $fromEnv }
  return $Default
}

$Root = Join-Path $env:ProgramData 'CounterwellRemote'
$Downloads = Join-Path $Root 'downloads'
$TailnetV4 = '100.64.0.0/10'
$TailnetV6 = 'fd7a:115c:a1e0::/48'

function Write-Step([string]$Text) { Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Done([string]$Text) { Write-Host "   $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "   $Text" -ForegroundColor Yellow }

# Native programs report failure through exit codes; Windows PowerShell 5.1 would otherwise
# turn any line they print on stderr into a terminating error.
function Invoke-Native([string]$File, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $File @Arguments 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  return [pscustomobject]@{ Code = $code; Output = ($output -join "`n") }
}

function Get-SignedDownload([string]$Url, [string]$Name) {
  New-Item -ItemType Directory -Force -Path $Downloads | Out-Null
  $path = Join-Path $Downloads $Name
  Write-Host "   Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $path -UseBasicParsing
  $signature = Get-AuthenticodeSignature -FilePath $path
  if ($signature.Status -ne 'Valid') {
    Remove-Item -Force $path
    throw "$Name is not validly signed ($($signature.Status)); not installing it."
  }
  Write-Done "Signed by $($signature.SignerCertificate.Subject)"
  return $path
}

function Install-Msi([string]$Path, [string[]]$Properties) {
  $arguments = @('/i', "`"$Path`"", '/quiet', '/norestart') + $Properties
  $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
    throw "Installer $Path failed with code $($process.ExitCode)."
  }
}

function Get-GitHubAsset([string]$Repository, [string]$Pattern) {
  $release = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repository/releases/latest" -Headers @{ 'User-Agent' = 'counterwell-shop-setup' }
  $asset = $release.assets | Where-Object { $_.name -match $Pattern } | Select-Object -First 1
  if (-not $asset) { throw "No download matching $Pattern in the latest $Repository release." }
  return $asset
}

# Only Administrators and SYSTEM may read these (SIDs work on every Windows language).
function Protect-File([string]$Path, [switch]$Folder) {
  $rights = '(F)'
  if ($Folder) { $rights = '(OI)(CI)(F)' }
  $result = Invoke-Native 'icacls.exe' @($Path, '/inheritance:r', '/grant:r', "*S-1-5-32-544:$rights", "*S-1-5-18:$rights")
  if ($result.Code -ne 0) { throw "Could not restrict access to ${Path}: $($result.Output)" }
}

function Limit-ToTailnet($Rules) {
  foreach ($rule in $Rules) {
    Set-NetFirewallRule -InputObject $rule -RemoteAddress @($TailnetV4, $TailnetV6) -Enabled True
  }
}

function New-SupportPassword {
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'.ToCharArray()
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  # The fixed tail guarantees every character class Windows password rules may ask for.
  return (-join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })) + '#7aZ'
}

function Install-Tailscale([string]$AuthKey, [string]$Hostname) {
  Write-Step '1. Tailscale'
  $exe = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
  if (Test-Path $exe) {
    Write-Done 'Already installed.'
  } else {
    $arch = 'amd64'
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
    $msi = Get-SignedDownload "https://pkgs.tailscale.com/stable/tailscale-setup-latest-$arch.msi" 'tailscale.msi'
    Install-Msi $msi @('TS_UNATTENDEDMODE=always', 'TS_NOLAUNCH=true')
    Write-Done 'Installed.'
  }
  $service = Get-Service -Name 'Tailscale' -ErrorAction SilentlyContinue
  if (-not $service) { throw 'The Tailscale service is missing after installation.' }
  Set-Service -Name 'Tailscale' -StartupType Automatic
  if ($service.Status -ne 'Running') { Start-Service -Name 'Tailscale' }

  $state = ''
  for ($i = 0; $i -lt 30; $i++) {
    $status = Invoke-Native $exe @('status', '--json')
    if ($status.Code -eq 0 -or $status.Output -match 'BackendState') {
      try { $state = ($status.Output | ConvertFrom-Json).BackendState } catch { $state = '' }
      if ($state) { break }
    }
    Start-Sleep -Seconds 2
  }
  if ($state -eq 'Running') {
    Write-Done 'Already connected to a Tailscale network.'
  } else {
    $key = $AuthKey
    for ($attempt = 1; $attempt -le 2; $attempt++) {
      if (-not $key) {
        $key = Read-Host '   Paste the Tailscale key from the email (it starts with tskey-auth-)'
      }
      $join = Invoke-Native $exe @('up', "--authkey=$key", '--unattended', "--hostname=$Hostname", '--reset', '--timeout=90s')
      if ($join.Code -eq 0) { break }
      Write-Note "Tailscale could not join: $($join.Output)"
      $key = ''
      if ($attempt -eq 2) { throw 'Tailscale did not join the network. Check the key with the owner and run this again.' }
    }
    Write-Done 'Joined the owner''s Tailscale network.'
  }
  $ip = (Invoke-Native $exe @('ip', '-4')).Output.Trim()
  Write-Done "Tailscale address: $ip"
  return $ip
}

function New-SupportAccount([string]$UserName) {
  Write-Step "2. Remote support account ($UserName)"
  $passwordFile = Join-Path $Root 'support-account-password.txt'
  if (Get-LocalUser -Name $UserName -ErrorAction SilentlyContinue) {
    Write-Done 'Already exists.'
  } else {
    $password = New-SupportPassword
    New-LocalUser -Name $UserName -Password (ConvertTo-SecureString $password -AsPlainText -Force) `
      -FullName 'Counterwell remote support' -Description 'Remote support for the Counterwell shop gateway' `
      -PasswordNeverExpires -AccountNeverExpires | Out-Null
    # Readable only by administrators: the owner reads it over SSH if Remote Desktop needs it.
    Set-Content -Path $passwordFile -Value $password -Encoding ASCII
    Protect-File $passwordFile
    Write-Done "Created. Its password is saved for the owner in $passwordFile (administrators only)."
  }
  try {
    Add-LocalGroupMember -SID 'S-1-5-32-544' -Member $UserName -ErrorAction Stop
    Write-Done 'Added to Administrators.'
  } catch [Microsoft.PowerShell.Commands.MemberExistsException] {
    Write-Done 'Already an administrator.'
  }
}

function Install-OpenSsh([string]$PublicKey) {
  Write-Step '3. SSH server (owner''s key only, Tailscale only)'
  if (-not (Get-Service -Name 'sshd' -ErrorAction SilentlyContinue)) {
    try {
      $capability = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' | Select-Object -First 1
      if ($capability -and $capability.State -ne 'Installed') {
        Write-Host '   Adding the OpenSSH server from Windows Update (this can take a few minutes)...'
        Add-WindowsCapability -Online -Name $capability.Name | Out-Null
      }
    } catch {
      Write-Note "Windows could not add OpenSSH ($($_.Exception.Message)). Downloading Microsoft's installer instead."
    }
    if (-not (Get-Service -Name 'sshd' -ErrorAction SilentlyContinue)) {
      $pattern = '^OpenSSH-Win64-v[\d.]+\.msi$'
      if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $pattern = '^OpenSSH-ARM64-v[\d.]+\.msi$' }
      $asset = Get-GitHubAsset 'PowerShell/Win32-OpenSSH' $pattern
      $msi = Get-SignedDownload $asset.browser_download_url 'openssh.msi'
      Install-Msi $msi @('ADDLOCAL=Server')
    }
  }
  $service = Get-Service -Name 'sshd' -ErrorAction SilentlyContinue
  if (-not $service) { throw 'The OpenSSH server could not be installed.' }
  Set-Service -Name 'sshd' -StartupType Automatic
  # The first start creates the host keys and the default configuration.
  if ($service.Status -ne 'Running') { Start-Service -Name 'sshd' }

  $sshDir = Join-Path $env:ProgramData 'ssh'
  $config = Join-Path $sshDir 'sshd_config'
  $marker = '# Counterwell: sign in with the owner''s key only'
  $current = ''
  if (Test-Path $config) { $current = [IO.File]::ReadAllText($config) }
  if ($current -notmatch [regex]::Escape($marker)) {
    # sshd uses the first value it reads, so these lines go before the defaults.
    $header = "$marker`r`nPasswordAuthentication no`r`nPubkeyAuthentication yes`r`n`r`n"
    [IO.File]::WriteAllText($config, $header + $current, (New-Object Text.ASCIIEncoding))
  }
  # Administrators' keys live here, not in the user's profile.
  $keys = Join-Path $sshDir 'administrators_authorized_keys'
  $existing = @()
  if (Test-Path $keys) { $existing = Get-Content -Path $keys }
  if ($existing -notcontains $PublicKey) {
    Add-Content -Path $keys -Value $PublicKey -Encoding ASCII
  }
  Protect-File $keys

  New-Item -Path 'HKLM:\SOFTWARE\OpenSSH' -Force | Out-Null
  New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name 'DefaultShell' -PropertyType String -Force `
    -Value (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') | Out-Null
  Restart-Service -Name 'sshd'

  $rules = @(Get-NetFirewallPortFilter -Protocol TCP | Where-Object { $_.LocalPort -eq '22' } |
    Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' })
  if ($rules.Count -eq 0) {
    New-NetFirewallRule -Name 'Counterwell-SSH-Tailscale' -DisplayName 'Counterwell SSH (Tailscale only)' `
      -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow -RemoteAddress @($TailnetV4, $TailnetV6) | Out-Null
  } else {
    Limit-ToTailnet $rules
  }
  Write-Done 'Running. Password sign-in is off; SSH answers only on the Tailscale network.'
}

function Enable-RemoteDesktop {
  Write-Step '4. Remote Desktop (Tailscale only)'
  $edition = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').EditionID
  if ($edition -notmatch 'Professional|Enterprise|Education|Server') {
    Write-Note "Skipped: Windows $edition cannot host Remote Desktop. SSH still works."
    return
  }
  Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name 'fDenyTSConnections' -Value 0
  Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -Name 'UserAuthentication' -Value 1
  # '@FirewallAPI.dll,-28752' is the Remote Desktop rule group on every Windows language.
  Limit-ToTailnet (Get-NetFirewallRule -Group '@FirewallAPI.dll,-28752')
  Write-Done 'Enabled. Note: a Remote Desktop sign-in takes over the screen from whoever is using this PC.'
}

function Set-StayAwake {
  Write-Step '5. Stay awake while plugged in'
  Invoke-Native 'powercfg.exe' @('/change', 'standby-timeout-ac', '0') | Out-Null
  Invoke-Native 'powercfg.exe' @('/change', 'hibernate-timeout-ac', '0') | Out-Null
  Write-Done 'Sleep and hibernate are off on mains power. The screen can still turn off.'
}

function Install-GatewayTools {
  Write-Step '6. Git and Node.js (for the shop gateway)'
  $x64 = $env:PROCESSOR_ARCHITECTURE -ne 'ARM64'
  $gitExe = Join-Path $env:ProgramFiles 'Git\cmd\git.exe'
  if (Test-Path $gitExe) {
    Write-Done 'Git already installed.'
  } else {
    $pattern = '^Git-[\d.]+-64-bit\.exe$'
    if (-not $x64) { $pattern = '^Git-[\d.]+-arm64\.exe$' }
    $asset = Get-GitHubAsset 'git-for-windows/git' $pattern
    $installer = Get-SignedDownload $asset.browser_download_url 'git-setup.exe'
    $process = Start-Process -FilePath $installer -ArgumentList @('/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/SUPPRESSMSGBOXES') -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Git installer failed with code $($process.ExitCode)." }
    Write-Done 'Git installed.'
  }

  $minimum = [version]'22.13.0'
  $nodeExe = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  $installed = $null
  if (Test-Path $nodeExe) {
    $installed = [version]((Invoke-Native $nodeExe @('--version')).Output.Trim().TrimStart('v'))
  }
  if ($installed -and $installed -ge $minimum) {
    Write-Done "Node.js $installed already installed."
  } else {
    $file = 'win-x64-msi'
    $suffix = 'x64'
    if (-not $x64) { $file = 'win-arm64-msi'; $suffix = 'arm64' }
    $release = Invoke-RestMethod -UseBasicParsing -Uri 'https://nodejs.org/dist/index.json' |
      Where-Object { $_.lts -and $_.files -contains $file -and [version]($_.version.TrimStart('v')) -ge $minimum } |
      Select-Object -First 1
    if (-not $release) { throw 'Could not find a Node.js LTS installer.' }
    $version = $release.version
    $msi = Get-SignedDownload "https://nodejs.org/dist/$version/node-$version-$suffix.msi" 'node.msi'
    Install-Msi $msi @()
    Write-Done "Node.js $version installed."
  }
}

function Save-Report([string]$TailscaleIp, [string]$UserName) {
  Write-Step '7. Report for the owner'
  $lines = New-Object System.Collections.Generic.List[string]
  function Add-Section([string]$Title, [scriptblock]$Body) {
    $lines.Add('')
    $lines.Add("## $Title")
    try {
      $text = & $Body | Out-String -Width 200
      $lines.Add($text.TrimEnd())
    } catch {
      $lines.Add("(could not read: $($_.Exception.Message))")
    }
  }
  $lines.Add("Counterwell shop PC report, $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
  $lines.Add("Computer: $env:COMPUTERNAME   Tailscale: $TailscaleIp   SSH: ssh $UserName@$TailscaleIp")
  Add-Section 'Windows' {
    Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, OSArchitecture, LastBootUpTime | Format-List
    Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model, @{ n = 'MemoryGB'; e = { [math]::Round($_.TotalPhysicalMemory / 1GB, 1) } } | Format-List
    Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{ n = 'FreeGB'; e = { [math]::Round($_.Free / 1GB, 1) } }, @{ n = 'UsedGB'; e = { [math]::Round($_.Used / 1GB, 1) } } | Format-Table -AutoSize
  }
  Add-Section 'Network' {
    Get-NetIPConfiguration | Where-Object { $_.IPv4Address } |
      Select-Object InterfaceAlias, @{ n = 'IPv4'; e = { ($_.IPv4Address.IPAddress) -join ', ' } }, @{ n = 'Gateway'; e = { ($_.IPv4DefaultGateway.NextHop) -join ', ' } } |
      Format-Table -AutoSize
  }
  Add-Section 'Printers' {
    Get-Printer | Select-Object Name, DriverName, PortName, Shared, PrinterStatus | Format-Table -AutoSize
    Get-PrinterPort | Select-Object Name, Description, PrinterHostAddress | Format-Table -AutoSize
    Get-PnpDevice -PresentOnly | Where-Object { $_.Class -eq 'Printer' -or $_.FriendlyName -match 'print|POS|TM-|thermal|receipt' } |
      Select-Object Class, FriendlyName, Status | Format-Table -AutoSize
  }
  Add-Section 'Network printers answering Epson ePOS (what the gateway uses)' {
    $hosts = Get-PrinterPort | Where-Object { $_.PrinterHostAddress } | Select-Object -ExpandProperty PrinterHostAddress -Unique
    if (-not $hosts) { 'No network printer ports.' }
    foreach ($address in $hosts) {
      try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 -Uri "http://$address/cgi-bin/epos/service.cgi?devid=local_printer"
        "$address answered HTTP $($response.StatusCode)"
      } catch {
        $code = $null
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        if ($code) { "$address answered HTTP $code" } else { "$address did not answer ($($_.Exception.Message))" }
      }
    }
  }
  Add-Section 'Installed software' {
    $paths = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
    Get-ItemProperty -Path $paths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } |
      Sort-Object DisplayName -Unique | Select-Object DisplayName, DisplayVersion, Publisher | Format-Table -AutoSize
  }
  $report = Join-Path $Root 'shop-pc-report.txt'
  [IO.File]::WriteAllLines($report, $lines)
  Write-Done "Saved $report"
}

function Invoke-ShopSetup {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this as Administrator: right-click the file and choose "Run as administrator".'
  }
  $authKey = Get-Setting 'TailscaleAuthKey' 'CW_TAILSCALE_AUTHKEY' ''
  $publicKey = (Get-Setting 'SshPublicKey' 'CW_SSH_PUBLIC_KEY' '').Trim()
  $hostname = Get-Setting 'Hostname' 'CW_HOSTNAME' 'counterwell-shop'
  $userName = Get-Setting 'SupportUser' 'CW_SUPPORT_USER' 'cwsupport'
  $gatewayTools = (Get-Setting 'InstallGatewayTools' 'CW_INSTALL_GATEWAY_TOOLS' 'yes') -ne 'no'
  if ($publicKey -notmatch '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+/=]+( .*)?$') {
    throw 'The owner''s SSH public key is missing or not valid.'
  }

  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  Protect-File $Root -Folder
  $log = Join-Path $Root ("setup-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  Start-Transcript -Path $log | Out-Null
  try {
    Write-Host 'Counterwell shop PC setup. This takes 5 to 15 minutes; keep this window open.' -ForegroundColor Cyan
    $ip = Install-Tailscale $authKey $hostname
    New-SupportAccount $userName
    Install-OpenSsh $publicKey
    Enable-RemoteDesktop
    Set-StayAwake
    if ($gatewayTools) { Install-GatewayTools } else { Write-Note 'Skipped Git and Node.js.' }
    Save-Report $ip $userName
    Remove-Item -Recurse -Force $Downloads -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host 'All done. Please tell the owner:' -ForegroundColor Green
    Write-Host "   This PC is on Tailscale as '$hostname' at $ip" -ForegroundColor Green
    Write-Host '   Keep this PC switched on and connected to the internet.' -ForegroundColor Green
    Write-Host '   You can delete the setup file now.' -ForegroundColor Green
  } finally {
    Stop-Transcript | Out-Null
  }
}

try {
  Invoke-ShopSetup
} catch {
  Write-Host ''
  Write-Host "Setup stopped: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Send the owner a photo of this window, or the log in $Root." -ForegroundColor Red
}
