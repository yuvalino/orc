$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$v='__VERSION__';$dir="$env:USERPROFILE\.orc\$v"
function frame($s){[Console]::Out.WriteLine($s)}
function fail($r){frame ('{"error":"install-failed","reason":"'+$r+'"}');exit 1}
if(Test-Path "$dir\orc-server.exe"){exit 0}
$a=$env:PROCESSOR_ARCHITECTURE;if($env:PROCESSOR_ARCHITEW6432){$a=$env:PROCESSOR_ARCHITEW6432}
if($a -eq 'AMD64'){$t='win32-x64'}elseif($a -eq 'ARM64'){$t='win32-arm64'}else{fail 'unsupported-host'}
$row=@"
__BUNDLES__
"@ -split "`n"|Where-Object{$_ -like "$t *"}
if(-not $row){fail 'unsupported-host'}
$f="$row".Trim() -split ' ';$url=$f[1];$sha=$f[2]
if(-not (Get-Command curl.exe -ErrorAction SilentlyContinue)){fail 'no-curl'}
$s="$env:USERPROFILE\.orc\.tmp.$v.$PID"
try{
New-Item -ItemType Directory -Force $s|Out-Null
frame '{"install":{"phase":"downloading"}}'
& curl.exe -fsSL $url -o "$s\bundle.tgz";if($LASTEXITCODE){fail 'download'}
frame '{"install":{"phase":"verifying"}}'
if((Get-FileHash -Algorithm SHA256 "$s\bundle.tgz").Hash.ToLower() -ne $sha){fail 'sha256'}
frame '{"install":{"phase":"unpacking"}}'
& tar.exe xzf "$s\bundle.tgz" -C $s;if($LASTEXITCODE){fail 'unpacking'}
Remove-Item "$s\bundle.tgz"
if(-not (Test-Path "$dir\orc-server.exe")){Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue;Move-Item $s $dir -ErrorAction SilentlyContinue}
if(-not (Test-Path "$dir\orc-server.exe")){fail 'unpacking'}
}finally{Remove-Item -Recurse -Force $s -ErrorAction SilentlyContinue}
