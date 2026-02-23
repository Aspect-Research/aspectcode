param(
  [switch]$IncludeExtension,
  [switch]$IncludePack,
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipWorkspaceTests
)

$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Message)
  Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Action
  )

  Write-Step $Name
  $start = Get-Date
  try {
    & $Action | Out-Null
    $elapsed = (Get-Date) - $start
    Write-Host "PASS: $Name ($([math]::Round($elapsed.TotalSeconds, 1))s)" -ForegroundColor Green
    return [pscustomobject]@{ Name = $Name; Status = 'PASS'; Seconds = [math]::Round($elapsed.TotalSeconds, 1) }
  } catch {
    $elapsed = (Get-Date) - $start
    Write-Host "FAIL: $Name ($([math]::Round($elapsed.TotalSeconds, 1))s)" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor DarkRed
    return [pscustomobject]@{ Name = $Name; Status = 'FAIL'; Seconds = [math]::Round($elapsed.TotalSeconds, 1) }
  }
}

function Run-Cmd {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [string]$WorkingDirectory
  )

  if ($WorkingDirectory) {
    Push-Location $WorkingDirectory
  }

  try {
    Write-Host "> $Command" -ForegroundColor DarkGray
    & cmd.exe /d /s /c $Command
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code ${LASTEXITCODE}: $Command"
    }
  } finally {
    if ($WorkingDirectory) {
      Pop-Location
    }
  }
}

$repoRoot   = Resolve-Path (Join-Path $PSScriptRoot '..')
$cliBin     = Join-Path $repoRoot 'packages\cli\bin\aspectcode.js'

# -- Sandbox setup for CLI smoke tests --------------------------------
# All CLI commands that generate output run inside a disposable temp
# directory so that kb.md and AGENTS.md never appear at repo root.
$sandboxRoot = Join-Path ([System.IO.Path]::GetTempPath()) "aspectcode-checklist-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$sandboxOut  = Join-Path $sandboxRoot '_out'
$fixtureDir  = Join-Path $repoRoot 'extension\test\fixtures\mini-repo'
Copy-Item -Path $fixtureDir -Destination $sandboxRoot -Recurse -Force
New-Item -Path $sandboxOut -ItemType Directory -Force | Out-Null

Write-Host "Aspect Code test checklist" -ForegroundColor White
Write-Host "Repo:    $repoRoot" -ForegroundColor Gray
Write-Host "Sandbox: $sandboxRoot" -ForegroundColor Gray

$results = New-Object System.Collections.ArrayList

if (-not $SkipInstall) {
  [void]$results.Add((Invoke-Step -Name 'Install dependencies' -Action {
    Run-Cmd -Command 'npm install' -WorkingDirectory $repoRoot
  }))
}

if (-not $SkipBuild) {
  [void]$results.Add((Invoke-Step -Name 'Build all workspaces' -Action {
    Run-Cmd -Command 'npm run build --workspaces' -WorkingDirectory $repoRoot
  }))
}

if (-not $SkipWorkspaceTests) {
  [void]$results.Add((Invoke-Step -Name 'Test core package' -Action {
    Run-Cmd -Command 'npm test' -WorkingDirectory (Join-Path $repoRoot 'packages\core')
  }))

  [void]$results.Add((Invoke-Step -Name 'Test emitters package' -Action {
    Run-Cmd -Command 'npm test' -WorkingDirectory (Join-Path $repoRoot 'packages\emitters')
  }))

  [void]$results.Add((Invoke-Step -Name 'Test CLI package' -Action {
    Run-Cmd -Command 'npm test' -WorkingDirectory (Join-Path $repoRoot 'packages\cli')
  }))
}

[void]$results.Add((Invoke-Step -Name 'CLI smoke: help' -Action {
  Run-Cmd -Command "node `"$cliBin`" --help" -WorkingDirectory $repoRoot
}))

[void]$results.Add((Invoke-Step -Name 'CLI smoke: generate (sandbox)' -Action {
  Run-Cmd -Command "node `"$cliBin`" gen --root `"$sandboxRoot`" --out `"$sandboxOut`" --quiet" -WorkingDirectory $repoRoot
}))

[void]$results.Add((Invoke-Step -Name 'CLI smoke: impact (sandbox)' -Action {
  Run-Cmd -Command "node `"$cliBin`" impact --root `"$sandboxRoot`" --file src/app.ts --quiet" -WorkingDirectory $repoRoot
}))

[void]$results.Add((Invoke-Step -Name 'CLI smoke: deps list (sandbox)' -Action {
  Run-Cmd -Command "node `"$cliBin`" deps list --root `"$sandboxRoot`" --file src/app.ts --quiet" -WorkingDirectory $repoRoot
}))

[void]$results.Add((Invoke-Step -Name 'JSON purity check (sandbox)' -Action {
  $tmpJson = Join-Path $env:TEMP 'aspectcode-smoke.json'
  $tmpErr = Join-Path $env:TEMP 'aspectcode-smoke.err.log'
  if (Test-Path $tmpJson) { Remove-Item $tmpJson -Force }
  if (Test-Path $tmpErr) { Remove-Item $tmpErr -Force }

  $cmd = "node `"$cliBin`" g --root `"$sandboxRoot`" --out `"$sandboxOut`" --json 1> `"$tmpJson`" 2> `"$tmpErr`""
  Run-Cmd -Command $cmd -WorkingDirectory $repoRoot

  $raw = Get-Content $tmpJson -Raw
  $null = $raw | ConvertFrom-Json
  if (-not $raw.TrimStart().StartsWith('{')) {
    throw 'JSON output file does not look like a JSON object.'
  }
}))

[void]$results.Add((Invoke-Step -Name 'Unknown flag warning path (sandbox)' -Action {
  Run-Cmd -Command "node `"$cliBin`" gen --root `"$sandboxRoot`" --out `"$sandboxOut`" --bogus-flag --quiet 2>nul" -WorkingDirectory $repoRoot
}))

[void]$results.Add((Invoke-Step -Name 'No-color path (sandbox)' -Action {
  Run-Cmd -Command "node `"$cliBin`" gen --root `"$sandboxRoot`" --out `"$sandboxOut`" --no-color --quiet" -WorkingDirectory $repoRoot
}))

[void]$results.Add((Invoke-Step -Name 'Verify repo root is clean' -Action {
  $repoKb = Join-Path $repoRoot 'kb.md'
  $repoAgents = Join-Path $repoRoot 'AGENTS.md'
  if (Test-Path $repoKb) { throw 'POLLUTION: kb.md exists at repo root' }
  if (Test-Path $repoAgents) { throw 'POLLUTION: AGENTS.md exists at repo root' }
}))

if ($IncludePack) {
  [void]$results.Add((Invoke-Step -Name 'CLI npm pack dry run' -Action {
    Run-Cmd -Command 'npm pack --dry-run' -WorkingDirectory (Join-Path $repoRoot 'packages\cli')
  }))
}

if ($IncludeExtension) {
  [void]$results.Add((Invoke-Step -Name 'Extension compile' -Action {
    Run-Cmd -Command 'npm run compile' -WorkingDirectory (Join-Path $repoRoot 'extension')
  }))

  Write-Host "`nManual extension host verification:" -ForegroundColor Yellow
  Write-Host '1) Press F5 to launch Extension Development Host' -ForegroundColor Yellow
  Write-Host '2) Run Generate KB and Impact commands in the host window' -ForegroundColor Yellow
  Write-Host '3) Confirm kb.md and instruction files are generated' -ForegroundColor Yellow
}

# -- Sandbox cleanup ---------------------------------------------------
if (Test-Path $sandboxRoot) {
  Remove-Item -Path $sandboxRoot -Recurse -Force
}

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
$results | ForEach-Object {
  if ($_.Status -eq 'PASS') {
    Write-Host "PASS  $($_.Name)" -ForegroundColor Green
  } else {
    Write-Host "FAIL  $($_.Name)" -ForegroundColor Red
  }
}

$failed = @($results | Where-Object { $_.Status -eq 'FAIL' }).Count
if ($failed -gt 0) {
  Write-Host "`n$failed step(s) failed." -ForegroundColor Red
  exit 1
}

Write-Host "`nAll checklist steps passed." -ForegroundColor Green
exit 0
