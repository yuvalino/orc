$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
# Modes as in bootstrap.sh. download/probe exit 0 when the server is installed (cmd's && then starts it); probe reports the
# target and exits 1 when it isn't. receive reads the bundle from stdin and never starts the server.
$v='__VERSION__';$mode='__MODE__';$dir="$env:USERPROFILE\.orc\$v"
function frame($s){[Console]::Out.WriteLine($s)}
function fail($r){frame ('{"error":"install-failed","reason":"'+$r+'"}');exit 1}
if(Test-Path "$dir\orc-server.exe"){if($mode -eq 'receive'){frame '{"install":{"phase":"done"}}'};exit 0}
$a=$env:PROCESSOR_ARCHITECTURE;if($env:PROCESSOR_ARCHITEW6432){$a=$env:PROCESSOR_ARCHITEW6432}
if($a -eq 'AMD64'){$t='win32-x64'}elseif($a -eq 'ARM64'){$t='win32-arm64'}else{fail 'unsupported-host'}
$row=@"
__BUNDLES__
"@ -split "`n"|Where-Object{$_ -like "$t *"}
if(-not $row){fail 'unsupported-host'}
$f="$row".Trim() -split ' ';$url=$f[1];$sha=$f[2]
if(-not $sha){fail 'no-bundle'}
if($mode -eq 'probe'){frame ('{"install":{"phase":"needed","target":"'+$t+'"}}');exit 1}
if($mode -eq 'download' -and -not (Get-Command curl.exe -ErrorAction SilentlyContinue)){fail 'no-curl'}
$s="$env:USERPROFILE\.orc\.tmp.$v.$PID"
try{
New-Item -ItemType Directory -Force $s|Out-Null
if($mode -eq 'receive'){
frame '{"install":{"phase":"uploading"}}'
$o=[IO.File]::Create("$s\bundle.tgz");try{[Console]::OpenStandardInput().CopyTo($o)}finally{$o.Close()}
}else{
frame '{"install":{"phase":"downloading"}}'
& curl.exe -fsSL --connect-timeout 15 --max-time 900 --retry 3 $url -o "$s\bundle.tgz";if($LASTEXITCODE){fail 'download'}
}
frame '{"install":{"phase":"verifying"}}'
if((Get-FileHash -Algorithm SHA256 "$s\bundle.tgz").Hash.ToLower() -ne $sha){fail 'sha256'}
frame '{"install":{"phase":"unpacking"}}'
# Windows' own tar: Git can put its GNU tar first on PATH, and that one takes "C:\..." for a remote host
& "$env:SystemRoot\System32\tar.exe" xzf "$s\bundle.tgz" -C $s;if($LASTEXITCODE){fail 'unpacking'}
Remove-Item "$s\bundle.tgz"
if(-not (Test-Path "$dir\orc-server.exe")){Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue;Move-Item $s $dir -ErrorAction SilentlyContinue}
Get-ChildItem $dir -Filter '.tmp.*' -Force -ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
if(-not (Test-Path "$dir\orc-server.exe")){fail 'unpacking'}
}finally{Remove-Item -Recurse -Force $s -ErrorAction SilentlyContinue}
if($mode -eq 'receive'){frame '{"install":{"phase":"done"}}'}
# Installed: succeed even though removing the (already moved) staging dir failed quietly, or cmd's && never starts the server
exit 0
