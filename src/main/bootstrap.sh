#!/bin/sh
# The remote command: install ~/.orc/<version>/ if missing, then become orc-server. Shipped base64-encoded (see remote.ts),
# so it runs under `sh` whatever the login shell is. The real stdout becomes fd 3 (frames only); everything else goes to stderr.
# remote.ts fills in the version and the bundle table (lines of "<target> <url> <sha256>") before encoding.
exec 3>&1 1>&2
v=__VERSION__
dir="$HOME/.orc/$v"
frame() { printf '%s\n' "$1" >&3; }
fail() { frame "{\"error\":\"install-failed\",\"reason\":\"$1\"}"; exit 1; }
if [ ! -x "$dir/orc-server" ]; then
  case "$(uname -sm)" in
    "Darwin arm64") t=darwin-arm64 ;; "Darwin x86_64") t=darwin-x64 ;;
    "Linux x86_64") t=linux-x64 ;; "Linux aarch64") t=linux-arm64 ;;
    *) fail unsupported-host ;;
  esac
  if [ "${t%%-*}" = linux ]; then
    ls /lib/ld-musl-* >/dev/null 2>&1 && fail unsupported-host
    glibc=$(getconf GNU_LIBC_VERSION 2>/dev/null | cut -d' ' -f2)
    [ -n "$glibc" ] && [ "$(printf '%s\n2.28\n' "$glibc" | sort -V | head -1)" != 2.28 ] && fail unsupported-host
  fi
  set -- $(printf '%s\n' "__BUNDLES__" | grep "^$t ") # target url sha256
  [ -n "$2" ] || fail unsupported-host
  command -v curl >/dev/null || fail no-curl
  staging="$HOME/.orc/.tmp.$v.$$"
  trap 'rm -rf "$staging"' EXIT
  trap 'exit 1' HUP INT TERM PIPE
  mkdir -p "$staging" || fail download
  frame '{"install":{"phase":"downloading"}}'
  curl -fsSL "$2" -o "$staging/bundle.tgz" || fail download
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
exec "$dir/orc-server" --stdio 1>&3 3>&-
