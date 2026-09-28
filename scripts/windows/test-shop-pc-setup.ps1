# Tests the shop PC setup without Windows: builds the one-file launcher with a fake key, checks it
# parses as Windows PowerShell 5.1 would accept, then runs it under stand-ins for Windows-only
# commands (services, installers, registry, firewall, local accounts, native tools).
#   pwsh scripts/windows/test-shop-pc-setup.ps1
# Covers a fresh PC, a second run (nothing reinstalled or duplicated) and the fallbacks (Windows
# Update unavailable, a mistyped Tailscale key). It cannot prove Windows itself accepts every
# parameter; that needs one real run on the shop PC.
param([string]$Child, [string]$Launcher, [string]$Work)
$ErrorActionPreference = 'Stop'

if (-not $Child) {
  $repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
  $temp = Join-Path ([IO.Path]::GetTempPath()) "cw-shop-setup-test-$PID"
  New-Item -ItemType Directory -Force -Path $temp | Out-Null
  $failures = New-Object System.Collections.Generic.List[string]
  function Assert([bool]$Condition, [string]$Message) {
    if ($Condition) { Write-Host "  ok   $Message" -ForegroundColor Green }
    else { Write-Host "  FAIL $Message" -ForegroundColor Red; $failures.Add($Message) }
  }
  try {
    $pub = Join-Path $temp 'test.pub'
    Set-Content -Path $pub -Value 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKeyOnlyTestKeyOnlyTestKeyOnlyTestKey test@example'
    $env:CW_TAILSCALE_AUTHKEY = 'tskey-auth-kMock1CNTRL-mocksecret'
    & node (Join-Path $repo 'scripts/windows/build-shop-pc-setup.mjs') --out (Join-Path $temp 'out') --ssh-key $pub | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The generator failed.' }
    $launcherPath = Join-Path $temp 'out/counterwell-shop-setup.cmd'

    Write-Host 'Syntax'
    foreach ($file in (Join-Path $repo 'scripts/windows/shop-pc-setup.ps1'), $launcherPath) {
      $tokens = $null; $errors = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errors)
      $ps7 = $ast.FindAll({ param($n)
          $n -is [System.Management.Automation.Language.TernaryExpressionAst] -or
          $n -is [System.Management.Automation.Language.PipelineChainAst] -or
          ($n -is [System.Management.Automation.Language.BinaryExpressionAst] -and $n.Operator -eq 'QuestionQuestion') -or
          ($n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Operator -eq 'QuestionQuestionEquals') }, $true)
      $name = Split-Path $file -Leaf
      Assert ($errors.Count -eq 0) "$name parses"
      Assert ($ps7.Count -eq 0) "$name uses no PowerShell 7-only syntax"
      Assert (-not ([IO.File]::ReadAllText($file) -match '[^\x00-\x7F]')) "$name is plain ASCII"
    }
    $raw = [IO.File]::ReadAllText($launcherPath)
    Assert ($raw -notmatch "[^\r]`n") 'launcher uses Windows line endings throughout'

    function Invoke-Scenario([string]$Name, [string]$WorkDir) {
      $output = & ([Environment]::ProcessPath) -NoProfile -File $PSCommandPath -Child $Name -Launcher $launcherPath -Work $WorkDir 2>&1 | Out-String
      $calls = ''
      if (Test-Path (Join-Path $WorkDir 'calls.log')) { $calls = Get-Content -Raw (Join-Path $WorkDir 'calls.log') }
      return @{ Output = $output; Calls = $calls }
    }
    $pc = Join-Path $temp 'pc'
    $sshd = Join-Path $pc 'ProgramData/ssh/sshd_config'
    $keys = Join-Path $pc 'ProgramData/ssh/administrators_authorized_keys'

    Write-Host 'Fresh PC'
    $run = Invoke-Scenario 'fresh' $pc
    Assert ($run.Output -match 'All done') 'finishes'
    Assert ($run.Calls -match 'TS_UNATTENDEDMODE=always') 'installs Tailscale to run unattended'
    Assert ($run.Calls -match 'tailscale up --authkey=tskey-auth-REDACTED --unattended --hostname=counterwell-shop --reset') 'joins the tailnet with the key and hostname'
    Assert ($run.Calls -match 'New-LocalUser cwsupport' -and $run.Calls -match 'Add-LocalGroupMember S-1-5-32-544 cwsupport') 'creates the support administrator'
    Assert ((Get-Content $sshd -Raw) -match '(?m)^PasswordAuthentication no') 'turns SSH password sign-in off'
    Assert ((Get-Content $keys) -contains 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKeyOnlyTestKeyOnlyTestKeyOnlyTestKey test@example') 'authorises the owner key'
    Assert ($run.Calls -match 'icacls\.exe \S+administrators_authorized_keys /inheritance:r') 'locks the key file to administrators'
    Assert ($run.Calls -match 'Firewall OpenSSH-Server-In-TCP from 100\.64\.0\.0/10,fd7a:115c:a1e0::/48') 'limits SSH to Tailscale addresses'
    Assert ($run.Calls -match 'Firewall RDP .* from 100\.64\.0\.0/10') 'limits Remote Desktop to Tailscale addresses'
    Assert ($run.Calls -match 'node-v24\.21\.0-x64\.msi') 'picks the newest LTS Node.js, not the current release'
    Assert (Test-Path (Join-Path $pc 'ProgramData/CounterwellRemote/shop-pc-report.txt')) 'saves the report'
    Assert ($run.Output -notmatch 'tskey-auth-kMock') 'never prints the auth key'

    Write-Host 'Second run on the same PC'
    Remove-Item (Join-Path $pc 'calls.log')
    $run = Invoke-Scenario 'fresh' $pc
    Assert ($run.Output -match 'All done') 'finishes'
    Assert ($run.Calls -notmatch 'Download |Start-Process|tailscale up|New-LocalUser') 'installs, joins and creates nothing again'
    Assert (([regex]::Matches((Get-Content $sshd -Raw), 'Counterwell: sign in')).Count -eq 1) 'does not repeat the SSH settings'
    Assert (@(Get-Content $keys).Count -eq 1) 'does not repeat the key'

    Write-Host 'Fallbacks'
    $run = Invoke-Scenario 'fallbacks' (Join-Path $temp 'pc2')
    Assert ($run.Output -match 'All done') 'finishes'
    Assert ($run.Calls -match 'Asked: .*Paste the Tailscale key') 'asks for the key when the saved one is refused'
    Assert ($run.Calls -match 'OpenSSH-Win64-v[\d.]+\.msi' -and $run.Calls -match 'ADDLOCAL=Server') 'installs OpenSSH from Microsoft when Windows Update fails'
  } finally {
    Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
  }
  if ($failures.Count) { Write-Host "$($failures.Count) failed" -ForegroundColor Red; exit 1 }
  Write-Host 'All shop PC setup checks passed.' -ForegroundColor Green
  exit 0
}

# Child: one run of the launcher under stand-ins.
Add-Type -TypeDefinition 'namespace Microsoft.PowerShell.Commands { public class MemberExistsException : System.Exception { public MemberExistsException() : base("already a member") {} } }' -ErrorAction SilentlyContinue

$env:ProgramData = Join-Path $Work 'ProgramData'
$env:ProgramFiles = Join-Path $Work 'ProgramFiles'
$env:SystemRoot = Join-Path $Work 'Windows'
$env:COMPUTERNAME = 'SHOP-PC'
$env:PROCESSOR_ARCHITECTURE = 'AMD64'
$mockLog = Join-Path $Work 'calls.log'
$bin = Join-Path $Work 'bin'
New-Item -ItemType Directory -Force -Path $bin, (Join-Path $env:ProgramData 'ssh'), $env:ProgramFiles | Out-Null
$env:PATH = "${bin}:$env:PATH"
function Write-Fake([string]$Path, [string]$Body) {
  New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
  Set-Content -Path $Path -Value "#!/bin/sh`n$Body"
  chmod +x $Path
}
foreach ($tool in 'icacls.exe', 'powercfg.exe') { Write-Fake (Join-Path $bin $tool) "echo `"$tool `$*`" >> '$mockLog'" }
$tailscaleBody = @"
echo "tailscale `$*" | sed -E 's/tskey-auth-[A-Za-z0-9-]+/tskey-auth-REDACTED/' >> '$mockLog'
case "`$1" in
  status) if [ -f '$Work/joined' ]; then echo '{"BackendState":"Running"}'; else echo '{"BackendState":"NeedsLogin"}'; fi ;;
  up) case "`$*" in *bad-key*) echo 'invalid key' >&2; exit 1 ;; esac; touch '$Work/joined' ;;
  ip) echo 100.101.102.103 ;;
esac
"@

$mockState = Join-Path $Work 'state.json'
function Get-State { if (Test-Path $mockState) { Get-Content $mockState -Raw | ConvertFrom-Json -AsHashtable } else { @{ services = @{}; users = @(); admins = @() } } }
function Save-State($s) { $s | ConvertTo-Json -Depth 5 | Set-Content $mockState }
function Add-Call([string]$Text) { Add-Content -Path $mockLog -Value $Text }

function Get-Service { param([string]$Name, $ErrorAction) $s = Get-State; if ($s.services.ContainsKey($Name)) { [pscustomobject]@{ Name = $Name; Status = $s.services[$Name] } } }
function Set-Service { param($Name, $StartupType) Add-Call "Set-Service $Name $StartupType" }
function Start-Service { param($Name) $s = Get-State; $s.services[$Name] = 'Running'; Save-State $s; Add-Call "Start-Service $Name" }
function Restart-Service { param($Name) Add-Call "Restart-Service $Name" }
function Start-Process {
  param($FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru, $Verb)
  $text = "$FilePath $($ArgumentList -join ' ')"
  Add-Call "Start-Process $text"
  $s = Get-State
  if ($text -match 'tailscale\.msi') { Write-Fake (Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe') $tailscaleBody; $s.services['Tailscale'] = 'Stopped' }
  if ($text -match 'openssh\.msi') { $s.services['sshd'] = 'Stopped' }
  if ($text -match 'git-setup') { Write-Fake (Join-Path $env:ProgramFiles 'Git/cmd/git.exe') 'exit 0' }
  if ($text -match 'node\.msi') { Write-Fake (Join-Path $env:ProgramFiles 'nodejs/node.exe') 'echo v24.21.0' }
  Save-State $s
  [pscustomobject]@{ ExitCode = 0 }
}
function Invoke-WebRequest {
  param($Uri, $OutFile, [switch]$UseBasicParsing, $TimeoutSec)
  Add-Call "Download $Uri"
  if ($OutFile) { Set-Content -Path $OutFile -Value 'binary' } else { throw 'no answer' }
}
function Invoke-RestMethod {
  param($Uri, [switch]$UseBasicParsing, $Headers)
  Add-Call "Api $Uri"
  if ($Uri -match 'nodejs') {
    return @([pscustomobject]@{ version = 'v25.1.0'; lts = $false; files = @('win-x64-msi') },
      [pscustomobject]@{ version = 'v24.21.0'; lts = 'Krypton'; files = @('win-x64-msi', 'win-arm64-msi') })
  }
  $names = @('OpenSSH-Win64-v10.0.0.0.msi', 'OpenSSH-ARM64-v10.0.0.0.msi', 'Git-2.55.0.5-64-bit.exe', 'PortableGit-2.55.0.5-64-bit.7z.exe')
  [pscustomobject]@{ assets = @($names | ForEach-Object { [pscustomobject]@{ name = $_; browser_download_url = "https://example.test/$_" } }) }
}
function Get-AuthenticodeSignature { param($FilePath) [pscustomobject]@{ Status = 'Valid'; SignerCertificate = [pscustomobject]@{ Subject = 'CN=Mock Publisher' } } }
function Get-LocalUser { param($Name, $ErrorAction) if ((Get-State).users -contains $Name) { [pscustomobject]@{ Name = $Name } } }
function New-LocalUser { param($Name, $Password, $FullName, $Description, [switch]$PasswordNeverExpires, [switch]$AccountNeverExpires) $s = Get-State; $s.users += $Name; Save-State $s; Add-Call "New-LocalUser $Name" }
function Add-LocalGroupMember {
  param($SID, $Member, $ErrorAction)
  $s = Get-State
  if ($s.admins -contains $Member) { throw (New-Object Microsoft.PowerShell.Commands.MemberExistsException) }
  $s.admins += $Member; Save-State $s; Add-Call "Add-LocalGroupMember $SID $Member"
}
function Get-WindowsCapability { param([switch]$Online, $Name) [pscustomobject]@{ Name = 'OpenSSH.Server~~~~0.0.1.0'; State = 'NotPresent' } }
function Add-WindowsCapability {
  param([switch]$Online, $Name)
  if ($Child -eq 'fallbacks') { throw 'Windows Update is not reachable' }
  $s = Get-State; $s.services['sshd'] = 'Stopped'; Save-State $s; Add-Call "Add-WindowsCapability $Name"
}
function Get-NetFirewallPortFilter { param($Protocol) [pscustomobject]@{ LocalPort = '22'; Rule = 'OpenSSH-Server-In-TCP' } }
function Get-NetFirewallRule {
  param([Parameter(ValueFromPipeline = $true)]$InputObject, $Group)
  process {
    if ($Group) { [pscustomobject]@{ Name = "RDP $Group"; Direction = 'Inbound'; Action = 'Allow' } }
    elseif ($InputObject) { [pscustomobject]@{ Name = $InputObject.Rule; Direction = 'Inbound'; Action = 'Allow' } }
  }
}
function Set-NetFirewallRule { param($InputObject, $RemoteAddress, $Enabled) Add-Call "Firewall $($InputObject.Name) from $($RemoteAddress -join ',') enabled=$Enabled" }
function New-NetFirewallRule { param($Name, $DisplayName, $Direction, $Protocol, $LocalPort, $Action, $RemoteAddress) Add-Call "New firewall rule $Name" }
function Get-ItemProperty { param($Path, $Name, $ErrorAction) if ("$Path" -match 'CurrentVersion$') { [pscustomobject]@{ EditionID = 'Professional' } } else { @() } }
function Set-ItemProperty { param($Path, $Name, $Value) Add-Call "Registry $Path $Name=$Value" }
function New-ItemProperty { param($Path, $Name, $PropertyType, $Value, [switch]$Force) Add-Call "Registry $Path $Name=$Value" }
function New-Item {
  param($Path, $ItemType, [switch]$Force)
  if ("$Path" -like 'HKLM:*') { Add-Call "Registry key $Path"; return }
  Microsoft.PowerShell.Management\New-Item -Path $Path -ItemType $ItemType -Force:$Force
}
function Read-Host { param($Prompt) Add-Call "Asked: $Prompt"; 'tskey-auth-kTyped1CNTRL-typedsecret' }

$text = Get-Content -Raw -Path $Launcher
# The mock is not running on Windows, so the administrator check cannot run.
$text = $text.Replace('New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())', '$null')
$text = $text.Replace('$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)', '$true')
$key = "TailscaleAuthKey = 'tskey-auth-kMock1CNTRL-mocksecret'"
if ($Child -eq 'fallbacks') { $key = "TailscaleAuthKey = 'tskey-auth-kbad-key1CNTRL-bad-key'" }
$text = [regex]::Replace($text, "TailscaleAuthKey = '[^']*'", $key)
Invoke-Expression $text
