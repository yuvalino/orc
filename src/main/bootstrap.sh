#!/bin/sh
# The remote command: install ~/.orc/<version>/ if missing, then become orc-server. Shipped base64-encoded (see remote.ts),
# so it runs under `sh` whatever the login shell is. The real stdout becomes fd 3 (frames only); everything else goes to stderr.
# remote.ts fills in the version, the bundle table (lines of "<target> <url> <sha256>") and the mode before encoding:
#   download: the regular edition, which fetches the bundle from its GitHub release;
#   probe:    the offline edition's connect: reports the host's target when there is no install (Orc then sends the bundle);
#   receive:  the offline edition's install: the bundle arrives on stdin, nothing is fetched, and no server is started.
exec 3>&1 1>&2
v=__VERSION__
mode=__MODE__
dir="$HOME/.orc/$v"
frame() { printf '%s\n' "$1" >&3; }
fail() { frame "{\"error\":\"install-failed\",\"reason\":\"$1\"}"; exit 1; }
if [ ! -x "$dir/orc-server" ]; then
  case "$(uname -sm)" in
    "Darwin arm64") t=darwin-arm64 ;; "Darwin x86_64") t=darwin-x64 ;;
    "Linux x86_64") t=linux-x64 ;; "Linux aarch64") t=linux-arm64 ;;
    MINGW*|MSYS*|CYGWIN*) fail windows-shell ;; # a Windows host whose login shell is Git's bash: the client retries the Windows way
    *) fail unsupported-host ;;
  esac
  if [ "${t%%-*}" = linux ]; then
    ls /lib/ld-musl-* >/dev/null 2>&1 && fail unsupported-host
    glibc=$(getconf GNU_LIBC_VERSION 2>/dev/null | cut -d' ' -f2)
    [ -n "$glibc" ] && [ "$(printf '%s\n2.28\n' "$glibc" | sort -V | head -1)" != 2.28 ] && fail unsupported-host
  fi
  set -- $(printf '%s\n' "__BUNDLES__" | grep "^$t ") # target url sha256
  [ -n "$3" ] || fail no-bundle # no digest: this build never published that target
  if [ "$mode" = probe ]; then frame "{\"install\":{\"phase\":\"needed\",\"target\":\"$t\"}}"; exit 0; fi
  [ "$mode" = download ] && { command -v curl >/dev/null || fail no-curl; }
  staging="$HOME/.orc/.tmp.$v.$$"
  trap 'rm -rf "$staging"' EXIT
  trap 'exit 1' HUP INT TERM PIPE
  mkdir -p "$staging" || fail download
  if [ "$mode" = receive ]; then
    frame '{"install":{"phase":"uploading"}}'
    cat > "$staging/bundle.tgz" || fail upload
  else
    frame '{"install":{"phase":"downloading"}}'
    curl -fsSL --connect-timeout 15 --max-time 900 --retry 3 "$2" -o "$staging/bundle.tgz" || fail download
  fi
  frame '{"install":{"phase":"verifying"}}'
  if command -v sha256sum >/dev/null; then sum=$(sha256sum "$staging/bundle.tgz" | cut -d' ' -f1); else sum=$(shasum -a 256 "$staging/bundle.tgz" | cut -d' ' -f1); fi
  [ "$sum" = "$3" ] || fail sha256
  frame '{"install":{"phase":"unpacking"}}'
  tar xzf "$staging/bundle.tgz" -C "$staging" && rm -f "$staging/bundle.tgz" || fail unpacking
  [ -x "$dir/orc-server" ] || rm -rf "$dir" # a broken leftover, never a working install
  mv "$staging" "$dir" 2>/dev/null || true # lands inside an existing dir when another client won the race
  rm -rf "$dir"/.tmp.*
  [ -x "$dir/orc-server" ] || fail unpacking
fi
if [ "$mode" = receive ]; then frame '{"install":{"phase":"done"}}'; exit 0; fi
exec "$dir/orc-server" --stdio 1>&3 3>&-
