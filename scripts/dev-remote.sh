#!/bin/sh
# Push a locally built orc-server bundle to a host for development: scripts/dev-remote.sh <host> [target]
# The app installs released bundles itself on first connect; this puts an unreleased build into ~/.orc/<version>/ instead.
set -e
host=$1
[ -n "$host" ] || { echo "usage: scripts/dev-remote.sh <host> [darwin-arm64|darwin-x64|linux-x64|linux-arm64]" >&2; exit 2; }
target=${2:-$(ssh "$host" 'uname -sm' | awk '{os=tolower($1); a=$2; if (a=="x86_64") a="x64"; else if (a=="aarch64"||a=="arm64") a="arm64"; print os"-"a}')}
version=$(node -p "require('./package.json').version")
node scripts/build-server.mjs "$target"
ssh "$host" "mkdir -p ~/.orc/$version"
scp "out/server/$target/orc-server" "out/server/$target/claude" "$host:~/.orc/$version/"
echo "installed ~/.orc/$version on $host ($target)"
