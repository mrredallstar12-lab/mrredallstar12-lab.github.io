[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("SaveFromEnvironment", "Verify", "RunServer", "AssertNoPlaintext")]
  [string]$Action,

  [string]$SecretPath = "C:\OFA\staging\secrets\ofa-staging-secrets.json",
  [string]$BackendPath = "C:\OFA\staging\repo\backend"
)

$ErrorActionPreference = "Stop"

$RequiredSecretNames = @(
  "OFA_SESSION_PEPPER",
  "OFA_IDENTITY_PEPPER",
  "OFA_FIELD_ENCRYPTION_KEY_B64",
  "OFA_FIELD_ENCRYPTION_KEY_ID"
)

function Protect-SecretsDirectory {
  param([string]$DirectoryPath)

  New-Item -ItemType Directory -Force $DirectoryPath | Out-Null
  $currentUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $grants = @(
    "*$currentUserSid`:(OI)(CI)F",
    "*S-1-5-32-544`:(OI)(CI)F",
    "*S-1-5-18`:(OI)(CI)F"
  )

  & icacls $DirectoryPath /inheritance:r /grant:r $grants | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to lock ACL on $DirectoryPath"
  }
}

function ConvertTo-DpapiCiphertext {
  param([string]$Value)

  $secure = ConvertTo-SecureString -String $Value -AsPlainText -Force
  ConvertFrom-SecureString -SecureString $secure
}

function ConvertFrom-DpapiCiphertext {
  param([string]$Ciphertext)

  $secure = ConvertTo-SecureString -String $Ciphertext
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Read-SecretStore {
  if (!(Test-Path -LiteralPath $SecretPath)) {
    throw "Secret store not found: $SecretPath"
  }
  Get-Content -LiteralPath $SecretPath -Raw | ConvertFrom-Json
}

function Get-SecretEnvironmentMap {
  $store = Read-SecretStore
  $secretMap = @{}
  foreach ($name in $RequiredSecretNames) {
    $entry = $store.secrets.$name
    if (!$entry) {
      throw "Secret store is missing $name"
    }
    $secretMap[$name] = ConvertFrom-DpapiCiphertext $entry
  }
  $secretMap
}

function Test-RequiredEnvironment {
  foreach ($name in $RequiredSecretNames) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, "Process"))) {
      throw "Required process environment variable is missing: $name"
    }
  }
}

switch ($Action) {
  "SaveFromEnvironment" {
    Test-RequiredEnvironment
    $directory = Split-Path -Parent $SecretPath
    Protect-SecretsDirectory $directory

    $secretMap = [ordered]@{}
    foreach ($name in $RequiredSecretNames) {
      $secretMap[$name] = ConvertTo-DpapiCiphertext ([Environment]::GetEnvironmentVariable($name, "Process"))
    }

    $store = [ordered]@{
      format = "ofa-windows-dpapi-currentuser-v1"
      scope = "CurrentUser"
      createdAt = (Get-Date).ToUniversalTime().ToString("o")
      createdBy = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
      secrets = $secretMap
    }

    $json = $store | ConvertTo-Json -Depth 4
    Set-Content -LiteralPath $SecretPath -Value $json -Encoding UTF8
    Write-Host "Saved encrypted staging secrets to $SecretPath"
  }

  "Verify" {
    $secretMap = Get-SecretEnvironmentMap
    foreach ($name in $RequiredSecretNames) {
      if ([string]::IsNullOrWhiteSpace($secretMap[$name])) {
        throw "Secret store produced an empty value for $name"
      }
    }
    Write-Host "Required OFA staging secrets loaded: true"
  }

  "RunServer" {
    $secretMap = Get-SecretEnvironmentMap
    foreach ($name in $RequiredSecretNames) {
      if ([string]::IsNullOrWhiteSpace($secretMap[$name])) {
        throw "Secret store produced an empty value for $name"
      }
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = "npm.cmd"
    $startInfo.Arguments = "run dev:server"
    $startInfo.WorkingDirectory = $BackendPath
    $startInfo.UseShellExecute = $false
    foreach ($name in $RequiredSecretNames) {
      $startInfo.EnvironmentVariables[$name] = $secretMap[$name]
    }
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $process.WaitForExit()
    exit $process.ExitCode
  }

  "AssertNoPlaintext" {
    Test-RequiredEnvironment
    $raw = Get-Content -LiteralPath $SecretPath -Raw
    foreach ($name in $RequiredSecretNames) {
      $value = [Environment]::GetEnvironmentVariable($name, "Process")
      if (![string]::IsNullOrEmpty($value) -and $raw.Contains($value)) {
        throw "Plaintext value for $name was found in $SecretPath"
      }
    }
    Write-Host "Encrypted secret store plaintext check passed."
  }
}
