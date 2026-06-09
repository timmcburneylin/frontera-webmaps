param(
  [string]$Source = "data/burn-probability.png",
  [string]$Output = "tiles/burn-probability",
  [int]$MinZoom = 5,
  [int]$MaxZoom = 10,
  [int]$TileSize = 256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$bounds = @{
  South = 47.68780370640384
  West = -139.0523932936093
  North = 61.3704441896773
  East = -110.4227492482696
}

function Get-NormalizedX([double]$lon) {
  return ($lon + 180.0) / 360.0
}

function Get-NormalizedY([double]$lat) {
  $rad = $lat * [Math]::PI / 180.0
  return (1.0 - [Math]::Log([Math]::Tan($rad) + (1.0 / [Math]::Cos($rad))) / [Math]::PI) / 2.0
}

$sourcePath = Resolve-Path $Source
$sourceImage = [System.Drawing.Bitmap]::FromFile($sourcePath)
$sourceWidth = [double]$sourceImage.Width
$sourceHeight = [double]$sourceImage.Height

$westX = Get-NormalizedX $bounds.West
$eastX = Get-NormalizedX $bounds.East
$northY = Get-NormalizedY $bounds.North
$southY = Get-NormalizedY $bounds.South
$boundsWidth = $eastX - $westX
$boundsHeight = $southY - $northY

New-Item -ItemType Directory -Force -Path $Output | Out-Null

try {
  for ($z = $MinZoom; $z -le $MaxZoom; $z++) {
    $scale = [Math]::Pow(2, $z)
    $minX = [Math]::Floor($westX * $scale)
    $maxX = [Math]::Floor($eastX * $scale)
    $minY = [Math]::Floor($northY * $scale)
    $maxY = [Math]::Floor($southY * $scale)
    $tileCount = (($maxX - $minX + 1) * ($maxY - $minY + 1))
    $written = 0

    Write-Host "Generating z$z ($tileCount candidate tiles)"

    for ($x = $minX; $x -le $maxX; $x++) {
      $xDir = Join-Path (Join-Path $Output $z) $x
      New-Item -ItemType Directory -Force -Path $xDir | Out-Null

      for ($y = $minY; $y -le $maxY; $y++) {
        $tileWestX = $x / $scale
        $tileEastX = ($x + 1) / $scale
        $tileNorthY = $y / $scale
        $tileSouthY = ($y + 1) / $scale

        $srcX = (($tileWestX - $westX) / $boundsWidth) * $sourceWidth
        $srcY = (($tileNorthY - $northY) / $boundsHeight) * $sourceHeight
        $srcW = (($tileEastX - $tileWestX) / $boundsWidth) * $sourceWidth
        $srcH = (($tileSouthY - $tileNorthY) / $boundsHeight) * $sourceHeight

        $tile = New-Object System.Drawing.Bitmap $TileSize, $TileSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [System.Drawing.Graphics]::FromImage($tile)
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighSpeed
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor

        $destRect = New-Object System.Drawing.RectangleF 0, 0, $TileSize, $TileSize
        $srcRect = New-Object System.Drawing.RectangleF ([float]$srcX), ([float]$srcY), ([float]$srcW), ([float]$srcH)
        $graphics.DrawImage($sourceImage, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
        $graphics.Dispose()

        $tilePath = Join-Path $xDir "$y.png"
        $tile.Save($tilePath, [System.Drawing.Imaging.ImageFormat]::Png)
        $tile.Dispose()
        $written++
      }
    }

    Write-Host "Wrote $written z$z tiles"
  }
}
finally {
  $sourceImage.Dispose()
}
