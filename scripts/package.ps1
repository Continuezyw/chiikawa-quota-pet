param([switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$release = Join-Path $workspace 'release'
$application = Join-Path $release 'win-unpacked'
$package = Join-Path $release 'ChiikawaQuotaPet-0.4.0-Windows-x64-Personal'
$archive = Join-Path $release 'ChiikawaQuotaPet-0.4.0-Windows-x64-Personal.zip'
if (-not (Test-Path -LiteralPath (Join-Path $application 'ChiikawaQuotaPet.exe'))) { throw 'Please run npm run build first.' }
if (-not $VerifyOnly) {
if (Test-Path -LiteralPath $package) { throw 'Share staging directory already exists. Choose a new version before packaging again.' }
New-Item -ItemType Directory -Path $package | Out-Null
Get-ChildItem -LiteralPath $application -Force | Where-Object { $_.Name -notin @('user-data', '.local-data', 'artifacts', 'state.json') } | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $package -Recurse
}
Copy-Item -LiteralPath (Join-Path $workspace 'docs\QUICKSTART.txt') -Destination (Join-Path $package 'QUICKSTART.txt')
Copy-Item -LiteralPath (Join-Path $workspace 'docs\THIRD-PARTY-NOTICES.md') -Destination $package
Copy-Item -LiteralPath (Join-Path $workspace 'docs\research-characters.md') -Destination $package
Copy-Item -LiteralPath (Join-Path $workspace 'docs\ept-integration.md') -Destination $package
Copy-Item -LiteralPath (Join-Path $workspace 'docs\custom-api.md') -Destination $package
$unexpected = Get-ChildItem -LiteralPath $package -Recurse -Force | Where-Object { $_.Name -in @('user-data', '.local-data', 'state.json', 'Cookies', 'Local Storage') }
if ($unexpected) { throw 'Personal data detected in share staging directory.' }
if (Test-Path -LiteralPath $archive) { throw 'Archive already exists; refusing to overwrite.' }
Compress-Archive -LiteralPath $package -DestinationPath $archive -CompressionLevel Optimal
}
if (-not (Test-Path -LiteralPath $archive)) { throw 'Archive does not exist.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$reader = [IO.Compression.ZipFile]::OpenRead($archive)
try {
  $entries = @($reader.Entries | ForEach-Object { $_.FullName })
  if (-not ($entries | Where-Object { $_ -match '/ChiikawaQuotaPet\.exe$' })) { throw 'Executable is missing from zip.' }
  if ($entries | Where-Object { $_ -match '(^|/)(user-data|\.local-data|artifacts|state\.json|Cookies|Local Storage|dedicated-browser|deepseek-key\.bin|deepseek-key\.bin\.tmp|custom-api-key\.bin|custom-api-key\.bin\.tmp|ept\.exe|\.ept)(/|$)' }) { throw 'Personal data or EPT installation detected in archive.' }
} finally { $reader.Dispose() }
$hashAlgorithm = [Security.Cryptography.SHA256]::Create()
$stream = [IO.File]::OpenRead($archive)
try { $checksum = [BitConverter]::ToString($hashAlgorithm.ComputeHash($stream)).Replace('-', '') }
finally { $stream.Dispose(); $hashAlgorithm.Dispose() }
[IO.File]::WriteAllText(($archive + '.sha256.txt'), ($checksum + '  ' + [IO.Path]::GetFileName($archive) + [Environment]::NewLine))
Get-Item -LiteralPath $archive | Select-Object FullName, Length
Write-Output ('SHA256: ' + $checksum)
