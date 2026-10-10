# Mission Control installer for the Claude desktop app (Windows).
#
#   irm https://raw.githubusercontent.com/aessamm/mission-mods/main/install/install.ps1 | iex
#
# Adds the Mission Mods marketplace and turns on mission-control@mission-mods in your Claude
# settings file. It merges into what is there, backs the file up before writing, and changes
# nothing when both entries are already set. Works in Windows PowerShell 5.1 and PowerShell 7.
#
# Everything runs inside one script block: under `irm | iex` the code runs in your own
# PowerShell window, so it never calls `exit` (that would close the window) and leaves no
# variables or preferences behind.

& {
  $ErrorActionPreference = 'Stop'

  $MarketName = 'mission-mods'
  $Repo       = 'aessamm/mission-mods'
  $PluginKey  = 'mission-control@mission-mods'
  $MinVersion = '2.1.293'
  $StopTag    = 'MISSION_CONTROL_STOP:'

  function Write-Step($text) { Write-Host "  $text" }
  function Write-Done($text) { Write-Host "  $text" -ForegroundColor Green }
  function Write-Warn($text) { Write-Host "  $text" -ForegroundColor Yellow }
  function Stop-Install($text) { throw ($StopTag + $text) }

  function Get-Child($obj, $name) {
    $p = $obj.PSObject.Properties[$name]
    if ($null -eq $p) { return $null }
    return $p.Value
  }
  function Set-Child($obj, $name, $value) {
    if ($obj.PSObject.Properties[$name]) { $obj.$name = $value }
    else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value }
  }

  try {
    Write-Host ""
    Write-Host "  Mission Control installer" -ForegroundColor Cyan
    Write-Host ""

    # 1. Where the settings file lives (CLAUDE_CONFIG_DIR wins over the default).
    if ($env:CLAUDE_CONFIG_DIR) { $ConfigDir = $env:CLAUDE_CONFIG_DIR }
    else { $ConfigDir = Join-Path $env:USERPROFILE '.claude' }
    $Settings = Join-Path $ConfigDir 'settings.json'
    Write-Step "Settings file: $Settings"

    $Utf8NoBom = New-Object System.Text.UTF8Encoding $false
    if (-not (Test-Path -LiteralPath $Settings)) {
      New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
      [System.IO.File]::WriteAllText($Settings, "{}`n", $Utf8NoBom)
      Write-Step "No settings file yet, so created an empty one."
    }

    # 2. Read and parse. An empty file counts as {}; anything that is not a JSON object stops here.
    $raw = [System.IO.File]::ReadAllText($Settings)
    if ($raw.Trim().Length -eq 0) { $raw = '{}' }
    $invalid = "Your settings file is not valid JSON, so nothing was changed. Fix it (or move it aside) and run this again: $Settings"
    if ($PSVersionTable.PSVersion.Major -ge 6) {
      # PowerShell 7's ConvertFrom-Json accepts comments and trailing commas; check strictly first.
      try { ([System.Text.Json.JsonDocument]::Parse($raw)).Dispose() } catch { Stop-Install $invalid }
      $convert = Get-Command ConvertFrom-Json
      # Keep date-like strings as strings where this PowerShell can (7.5+).
      if ($convert.Parameters.ContainsKey('DateKind')) { $data = $raw | ConvertFrom-Json -DateKind String }
      else { $data = $raw | ConvertFrom-Json }
    } else {
      try { $data = $raw | ConvertFrom-Json } catch { Stop-Install $invalid }
    }
    if ($null -eq $data -or $data -isnot [System.Management.Automation.PSCustomObject]) {
      Stop-Install "Your settings file does not hold a JSON object, so nothing was changed: $Settings"
    }

    function Get-Section($name) {
      $section = Get-Child $data $name
      if ($null -eq $section) {
        $section = New-Object PSObject
        Set-Child $data $name $section
      } elseif ($section -isnot [System.Management.Automation.PSCustomObject]) {
        Stop-Install "In your settings file, `"$name`" is not an object, so nothing was changed: $Settings"
      }
      return $section
    }

    # 3. Merge the two entries; note whether anything actually changes.
    $changed = $false

    $markets = Get-Section 'extraKnownMarketplaces'
    $entry = Get-Child $markets $MarketName
    $src = $null
    if ($entry -is [System.Management.Automation.PSCustomObject]) { $src = Get-Child $entry 'source' }
    $hasMarket = ($src -is [System.Management.Automation.PSCustomObject]) -and ((Get-Child $src 'source') -eq 'github') -and ((Get-Child $src 'repo') -eq $Repo)
    if (-not $hasMarket) {
      $source = New-Object PSObject
      $source | Add-Member -NotePropertyName 'source' -NotePropertyValue 'github'
      $source | Add-Member -NotePropertyName 'repo' -NotePropertyValue $Repo
      $market = New-Object PSObject
      $market | Add-Member -NotePropertyName 'source' -NotePropertyValue $source
      Set-Child $markets $MarketName $market
      $changed = $true
    }

    $plugins = Get-Section 'enabledPlugins'
    if ((Get-Child $plugins $PluginKey) -ne $true) {
      Set-Child $plugins $PluginKey $true
      $changed = $true
    }

    # 4. Write (after a backup), or leave the file alone.
    if ($changed) {
      $backup = "$Settings.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
      Copy-Item -LiteralPath $Settings -Destination $backup -Force
      Write-Step "Backed up your settings to $backup"
      $json = $data | ConvertTo-Json -Depth 100
      [System.IO.File]::WriteAllText($Settings, $json + "`n", $Utf8NoBom)
      Write-Done "Added the Mission Mods marketplace and turned on Mission Control."
    } else {
      Write-Done "Mission Control is already set up in your settings. Nothing changed."
    }

    # 5. Version check, when the CLI is installed.
    if (Get-Command claude -ErrorAction SilentlyContinue) {
      $out = (& claude --version 2>$null | Out-String)
      if ($out -match '(\d+)\.(\d+)\.(\d+)') {
        $have = [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])"
        if ($have -lt [version]$MinVersion) {
          Write-Warn "Claude Code $have is older than $MinVersion, which Mission Control needs. Update Claude Code first."
        } else {
          Write-Step "Claude Code $have found."
        }
      }
    } else {
      Write-Step "The claude command isn't installed. That's fine: just make sure the Claude desktop app is up to date (Claude Code $MinVersion or newer)."
    }

    Write-Host ""
    Write-Host "  Next steps" -ForegroundColor Cyan
    Write-Host "  1. Quit the Claude desktop app completely (also from the system tray) and open it again."
    Write-Host "  2. Start a new session in the Code tab."
    Write-Host "  3. Type /mission to open the panel."
    Write-Host ""
  } catch {
    $msg = "$($_.Exception.Message)"
    if ($msg.StartsWith($StopTag)) { $msg = $msg.Substring($StopTag.Length) }
    else { $msg = "Something went wrong, and your settings were not changed: $msg" }
    Write-Host ""
    Write-Host "  $msg" -ForegroundColor Red
    Write-Host ""
  }
}
