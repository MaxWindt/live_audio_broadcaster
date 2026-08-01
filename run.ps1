# Downloads (clones) the latest tagged release of live_audio_broadcaster,
# builds it with Go if it hasn't been built yet, then runs it.
#
# Safe to re-run: if the latest tag is already cloned/built, it just runs
# the cached binary. If a newer tag has been released, it clones/builds that
# one instead.
$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/MaxWindt/live_audio_broadcaster.git"
$CacheDir = if ($env:LIVE_AUDIO_BROADCASTER_HOME) { $env:LIVE_AUDIO_BROADCASTER_HOME } else { Join-Path $env:LOCALAPPDATA "live_audio_broadcaster" }
$SrcDir = Join-Path $CacheDir "src"
$BinDir = Join-Path $CacheDir "bin"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "git is required but not installed (https://git-scm.com/download/win)"
    exit 1
}
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Error "go is required but not installed (https://go.dev/dl/)"
    exit 1
}

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

Write-Host "Checking for latest tag..."
$tagLines = git ls-remote --tags --refs $RepoUrl
$tags = $tagLines | ForEach-Object { ($_ -split "refs/tags/")[1] } | Where-Object { $_ }
$latestTag = $tags | Sort-Object { [version]($_ -replace '^v', '') } | Select-Object -Last 1

if (-not $latestTag) {
    Write-Error "could not determine latest tag from $RepoUrl"
    exit 1
}

Write-Host "Latest tag: $latestTag"

if (Test-Path (Join-Path $SrcDir ".git")) {
    git -C $SrcDir fetch --quiet --tags $RepoUrl
} else {
    Write-Host "Cloning repository (first run)..."
    git clone --quiet $RepoUrl $SrcDir
}

git -C $SrcDir checkout --quiet $latestTag

$binPath = Join-Path $BinDir "live_audio_broadcaster-$latestTag.exe"

if (-not (Test-Path $binPath)) {
    Write-Host "Building $latestTag (first run for this version)..."
    Push-Location $SrcDir
    try {
        go build -o $binPath .
    } finally {
        Pop-Location
    }
} else {
    Write-Host "Already built, skipping build step."
}

Write-Host "Starting live_audio_broadcaster $latestTag..."
& $binPath
