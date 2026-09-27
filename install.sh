#!/usr/bin/env bash
# mkt-harness installer. One command:
#   curl -fsSL https://raw.githubusercontent.com/brunopass/mkt-harness/main/install.sh | bash
# Clones (or updates) mkt-harness into ~/mkt-harness, installs dependencies and opens the guided setup.
# Options (env): MKT_DIR=/path  MKT_REPO=<git url>  MKT_NO_SETUP=1
set -euo pipefail

REPO="${MKT_REPO:-https://github.com/brunopass/mkt-harness.git}"
DIR="${MKT_DIR:-$HOME/mkt-harness}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31mmkt-harness:\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || fail "git is required (macOS: xcode-select --install)"

node_ok() { command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'; }
if ! node_ok && [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  bold "Installing Node.js 22 with nvm"
  # shellcheck disable=SC1091
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm install 22 >/dev/null
  nvm use 22 >/dev/null
fi
node_ok || fail "Node.js 22.12 or newer is required: https://nodejs.org (macOS: brew install node@22)"

if [ -d "$DIR/.git" ]; then
  bold "Updating $DIR"
  git -C "$DIR" pull --ff-only --quiet
else
  [ -e "$DIR" ] && fail "$DIR exists and is not a mkt-harness checkout (set MKT_DIR to install elsewhere)"
  bold "Downloading mkt-harness into $DIR"
  git clone --quiet "$REPO" "$DIR"
fi

cd "$DIR"
bold "Installing dependencies"
npm install --silent --no-fund --no-audit

if [ "${MKT_NO_SETUP:-}" = "1" ]; then
  bold "Installed. Start with: $DIR/bin/mkt"
  exit 0
fi
if [ -r /dev/tty ] && [ -t 1 ]; then
  # stdin is this script when piped from curl: give the setup the real terminal
  exec "$DIR/bin/mkt" setup < /dev/tty
fi
bold "Installed. Start with: $DIR/bin/mkt"
