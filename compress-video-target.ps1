param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [string]$OutputPath = "",
  [double]$TargetSizeMB = 10.0,
  [int]$AudioBitrateKbps = 96,
  [int]$MaxWidth = 1280
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

Require-Command "ffmpeg"
Require-Command "ffprobe"

if (-not (Test-Path -LiteralPath $InputPath)) {
  throw "Input file not found: $InputPath"
}

$inFull = (Resolve-Path -LiteralPath $InputPath).Path

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $dir = Split-Path -LiteralPath $inFull -Parent
  $base = [System.IO.Path]::GetFileNameWithoutExtension($inFull)
  $ext = [System.IO.Path]::GetExtension($inFull)
  $OutputPath = Join-Path $dir "$base.compressed$ext"
}

$outFull = [System.IO.Path]::GetFullPath($OutputPath)
$passLog = Join-Path ([System.IO.Path]::GetTempPath()) ("ffmpeg-pass-" + [guid]::NewGuid().ToString("N"))

$durationRaw = & ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 -- "$inFull"
if ($LASTEXITCODE -ne 0) {
  throw "ffprobe failed to read duration."
}

[double]$durationSec = 0
if (-not [double]::TryParse(($durationRaw | Select-Object -First 1), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$durationSec)) {
  throw "Could not parse duration from ffprobe output: $durationRaw"
}
if ($durationSec -le 0) {
  throw "Invalid video duration: $durationSec"
}

[double]$targetBits = $TargetSizeMB * 1024 * 1024 * 8
[double]$audioBitsPerSec = $AudioBitrateKbps * 1000
[double]$videoBitsPerSec = ($targetBits / $durationSec) - $audioBitsPerSec

if ($videoBitsPerSec -lt 150000) {
  $videoBitsPerSec = 150000
}

$videoKbps = [int][Math]::Floor($videoBitsPerSec / 1000)
$maxrateKbps = [int][Math]::Floor($videoKbps * 1.25)
$bufsizeKbps = [int][Math]::Floor($videoKbps * 2.0)

$vf = "scale='if(gt(iw,$MaxWidth),$MaxWidth,iw)':-2"

Write-Host "Input:        $inFull"
Write-Host "Output:       $outFull"
Write-Host "Duration:     $([Math]::Round($durationSec,2)) sec"
Write-Host "Target size:  $TargetSizeMB MB"
Write-Host "Audio bitrate:$AudioBitrateKbps kbps"
Write-Host "Video bitrate:$videoKbps kbps"

try {
  & ffmpeg -y -i "$inFull" `
    -vf "$vf" `
    -c:v libx264 -preset medium -b:v "${videoKbps}k" -maxrate "${maxrateKbps}k" -bufsize "${bufsizeKbps}k" `
    -pass 1 -passlogfile "$passLog" -an -f mp4 NUL
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg pass 1 failed." }

  & ffmpeg -y -i "$inFull" `
    -vf "$vf" `
    -c:v libx264 -preset medium -b:v "${videoKbps}k" -maxrate "${maxrateKbps}k" -bufsize "${bufsizeKbps}k" `
    -pass 2 -passlogfile "$passLog" `
    -c:a aac -b:a "${AudioBitrateKbps}k" `
    -movflags +faststart `
    "$outFull"
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg pass 2 failed." }
}
finally {
  Remove-Item -LiteralPath "$passLog*" -ErrorAction SilentlyContinue
}

$inSize = (Get-Item -LiteralPath $inFull).Length
$outSize = (Get-Item -LiteralPath $outFull).Length
$outMB = [Math]::Round($outSize / 1MB, 2)
$ratio = if ($inSize -gt 0) { [Math]::Round(($outSize / $inSize) * 100, 2) } else { 0 }

Write-Host "Done. Output size: $outMB MB ($ratio% of original)"
