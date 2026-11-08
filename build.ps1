<#
.SYNOPSIS
  Builds the single-file release of the AR-08 Mechanical Spider simulator.

.DESCRIPTION
  Inlines src/style.css, vendor/three.min.js and src/app.js into
  src/index.template.html and writes the result to index.html at the
  repository root. The build has no external runtime dependencies.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\build.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Read-Utf8([string]$Path) {
  return [IO.File]::ReadAllText($Path, $utf8)
}

function Replace-Once([string]$Text, [string]$Needle, [string]$Replacement, [string]$Label) {
  $count = ([regex]::Matches($Text, [regex]::Escape($Needle))).Count
  if ($count -ne 1) {
    throw "Expected exactly one occurrence of $Label, found $count."
  }
  return $Text.Replace($Needle, $Replacement)
}

$templatePath = Join-Path $root 'src\index.template.html'
$stylePath    = Join-Path $root 'src\style.css'
$appPath      = Join-Path $root 'src\app.js'
$threePath    = Join-Path $root 'vendor\three.min.js'
$outputPath   = Join-Path $root 'index.html'

foreach ($path in @($templatePath, $stylePath, $appPath, $threePath)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing build input: $path"
  }
}

$template = Read-Utf8 $templatePath
$style    = Read-Utf8 $stylePath
$app      = Read-Utf8 $appPath
$three    = Read-Utf8 $threePath

$html = Replace-Once $template '<link rel="stylesheet" href="style.css">' "<style>`n$style`n</style>" 'stylesheet link'
$html = Replace-Once $html '<script src="three.min.js"></script>' "<script>`n$three`n" 'Three.js script tag'
$html = Replace-Once $html '<script src="app.js"></script>' "$app`n</script>" 'application script tag'

foreach ($forbidden in @('src="app.js"', 'src="three.min.js"', 'href="style.css"')) {
  if ($html.Contains($forbidden)) {
    throw "Build output still contains local dependency reference: $forbidden"
  }
}

[IO.File]::WriteAllText($outputPath, $html, $utf8)

$size = (Get-Item -LiteralPath $outputPath).Length
$hash = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash
Write-Host ("Built index.html ({0} bytes)" -f $size)
Write-Host "SHA-256: $hash"
