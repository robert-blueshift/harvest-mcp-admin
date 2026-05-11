#!/usr/bin/env bash
set -euo pipefail

ADMIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIME_DIR_DEFAULT="$ADMIN_DIR/../harvest-mcp-time"
TIME_DIR="$TIME_DIR_DEFAULT"
CLONE_TIME=false
ADMIN_ONLY=false
ADD_ALIASES=false
SET_ENV=false
ZSHRC="${HOME}/.zshrc"
INTERACTIVE=false

usage() {
  cat <<USAGE
Usage: scripts/install-global.sh [options]

Options:
  --clone-time        Clone harvest-mcp-time if it's missing
  --admin-only        Skip harvest-mcp-time linking
  --time-dir <path>   Path to harvest-mcp-time repo (default: $TIME_DIR_DEFAULT)
  --add-aliases       Add shell aliases (harvest-admin, harvest-time) to ~/.zshrc
  --set-env           Prompt for HARVEST_ACCESS_TOKEN/ACCOUNT_ID and append to ~/.zshrc if missing
  --interactive       Guided prompts (env vars, open ~/.zshrc, copy source command)
  -h, --help          Show this help

Examples:
  scripts/install-global.sh
  scripts/install-global.sh --clone-time
  scripts/install-global.sh --time-dir /path/to/harvest-mcp-time
  scripts/install-global.sh --admin-only
  scripts/install-global.sh --add-aliases
  scripts/install-global.sh --set-env
  scripts/install-global.sh --interactive
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clone-time)
      CLONE_TIME=true
      shift
      ;;
    --admin-only)
      ADMIN_ONLY=true
      shift
      ;;
    --time-dir)
      TIME_DIR="$2"
      shift 2
      ;;
    --add-aliases)
      ADD_ALIASES=true
      shift
      ;;
    --set-env)
      SET_ENV=true
      shift
      ;;
    --interactive)
      INTERACTIVE=true
      SET_ENV=true
      ADD_ALIASES=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$ADMIN_ONLY" != "true" ]]; then
  if [[ ! -d "$TIME_DIR" ]]; then
    if [[ "$CLONE_TIME" == "true" ]]; then
      echo "Cloning harvest-mcp-time into $TIME_DIR"
      git clone git@github.com:robert-blueshift/harvest-mcp-time.git "$TIME_DIR"
    else
      echo "harvest-mcp-time not found at $TIME_DIR" >&2
      echo "Set HARVEST_MCP_TIME_DIR or pass --clone-time to install it." >&2
    fi
  fi

  if [[ -d "$TIME_DIR" ]]; then
    echo "Linking harvest-mcp-time..."
    (cd "$TIME_DIR" && npm install && npm link)
  fi
fi

echo "Linking harvest-mcp-admin..."
(cd "$ADMIN_DIR" && npm install && npm link)

if [[ "$SET_ENV" == "true" ]]; then
  touch "$ZSHRC"
  if command -v rg >/dev/null 2>&1; then
    RG_CMD="rg -q"
  else
    RG_CMD="grep -q"
  fi

  if ! $RG_CMD "HARVEST_ACCESS_TOKEN" "$ZSHRC" >/dev/null 2>&1 && [[ -z "${HARVEST_ACCESS_TOKEN:-}" ]]; then
    read -r -s -p "Enter HARVEST_ACCESS_TOKEN: " TOKEN
    echo
    if [[ -n "$TOKEN" ]]; then
      echo "export HARVEST_ACCESS_TOKEN=\"$TOKEN\"" >> "$ZSHRC"
    fi
  fi

  if ! $RG_CMD "HARVEST_ACCOUNT_ID" "$ZSHRC" >/dev/null 2>&1 && [[ -z "${HARVEST_ACCOUNT_ID:-}" ]]; then
    read -r -p "Enter HARVEST_ACCOUNT_ID: " ACCOUNT_ID
    if [[ -n "$ACCOUNT_ID" ]]; then
      echo "export HARVEST_ACCOUNT_ID=\"$ACCOUNT_ID\"" >> "$ZSHRC"
    fi
  fi

  echo "Env vars added to $ZSHRC (if they were missing)."
  if [[ "$INTERACTIVE" == "true" ]]; then
    read -r -p "Open $ZSHRC now? (y/N): " OPEN_RC
    if [[ "$OPEN_RC" =~ ^[Yy]$ ]]; then
      if command -v open >/dev/null 2>&1; then
        open "$ZSHRC"
      elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$ZSHRC"
      else
        echo "No open/xdg-open found. Please open $ZSHRC manually."
      fi
    fi
    if command -v pbcopy >/dev/null 2>&1; then
      echo "source $ZSHRC" | pbcopy
      echo "Copied 'source $ZSHRC' to clipboard."
    fi
    read -r -p "Press Enter to continue..." _
  fi
  echo "Run: source $ZSHRC"
fi

echo "Done. Commands available: harvest, harvest-admin"
if [[ "$ADMIN_ONLY" != "true" ]]; then
  echo "If harvest-time was linked, you can use: harvest time ..."
fi

if [[ "$ADD_ALIASES" == "true" ]]; then
  touch "$ZSHRC"
  if ! $RG_CMD "alias harvest-admin=" "$ZSHRC"; then
    echo "alias harvest-admin='harvest admin'" >> "$ZSHRC"
  fi
  if ! $RG_CMD "alias harvest-time=" "$ZSHRC"; then
    echo "alias harvest-time='harvest time'" >> "$ZSHRC"
  fi
  echo "Aliases added to $ZSHRC."
fi
