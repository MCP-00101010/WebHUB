$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifestPath = Join-Path $root 'manifest.json'
$manifest = Get-Content $manifestPath | ConvertFrom-Json

$name = ($manifest.name -replace '[^A-Za-z0-9._-]+', '-').Trim('-').ToLower()
$version = $manifest.version

$repoRoot = Split-Path -Parent $root
$stage = Join-Path $repoRoot ('.build\\amo-extension-package-' + [guid]::NewGuid().ToString('N'))
$outDir = Join-Path $repoRoot 'dist'
$baseOutFile = Join-Path $outDir ("{0}-{1}-amo.xpi" -f $name, $version)
$baseZipOutFile = Join-Path $outDir ("{0}-{1}-amo.zip" -f $name, $version)

function Resolve-WritableOutputPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PreferredPath
  )

  if (!(Test-Path $PreferredPath)) {
    return $PreferredPath
  }

  try {
    Remove-Item -Force $PreferredPath
    return $PreferredPath
  } catch {
    $dir = Split-Path -Parent $PreferredPath
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($PreferredPath)
    $ext = [System.IO.Path]::GetExtension($PreferredPath)
    $suffix = Get-Date -Format 'yyyyMMdd-HHmmss'
    return Join-Path $dir ("{0}-{1}{2}" -f $stem, $suffix, $ext)
  }
}

$outFile = Resolve-WritableOutputPath -PreferredPath $baseOutFile
$zipOutFile = Resolve-WritableOutputPath -PreferredPath $baseZipOutFile

New-Item -ItemType Directory -Force -Path $stage | Out-Null
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'icons') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'popup') | Out-Null

Copy-Item (Join-Path $root 'manifest.json') $stage
Copy-Item (Join-Path $root 'background.js') $stage
Copy-Item (Join-Path $root 'content.js') $stage
Copy-Item (Join-Path $root 'icons\\*') (Join-Path $stage 'icons')
Copy-Item (Join-Path $root 'popup\\*') (Join-Path $stage 'popup')

[System.IO.Compression.ZipFile] | Out-Null

function New-NormalizedZipArchive {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDir,
    [Parameter(Mandatory = $true)]
    [string]$DestinationPath
  )

  $sourceRoot = (Resolve-Path $SourceDir).Path
  $parentDir = Split-Path -Parent $DestinationPath
  if (!(Test-Path $parentDir)) {
    New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
  }

  $zip = [System.IO.Compression.ZipFile]::Open($DestinationPath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    $files = Get-ChildItem -Path $sourceRoot -Recurse -File
    foreach ($file in $files) {
      $relativePath = $file.FullName.Substring($sourceRoot.Length + 1).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relativePath, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally {
    $zip.Dispose()
  }
}

New-NormalizedZipArchive -SourceDir $stage -DestinationPath $outFile
New-NormalizedZipArchive -SourceDir $stage -DestinationPath $zipOutFile
try { Remove-Item -Recurse -Force $stage } catch {}

Write-Output $outFile
