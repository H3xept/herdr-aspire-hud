# Sourced by every demo tape before recording starts. Keeps shell out of the
# tapes, so the tapes stay a description of the recording and this stays
# lintable.
#
# Everything the HUD reads is fictional and lives under /tmp/aspire-hud-demo:
# a fake aspire CLI (docs/demo/bin/aspire), a fake herdr socket
# (docs/demo/fake-herdr.mjs), and the plugin's state and config directories.
# HOME points there too, so the HUD prints the fixture paths as ~/src/... and
# nothing can reach the real ~/.config/herdr or ~/.local/state/herdr.
#
# shellcheck shell=bash

DEMO=/tmp/aspire-hud-demo
REPO="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

export PS1='$ '
export PROMPT_COMMAND=
export HISTFILE=/dev/null

# A previous run's socket server, if its shell is still open.
if [ -f "$DEMO/fake-herdr.pid" ]; then
  kill "$(cat "$DEMO/fake-herdr.pid")" 2>/dev/null || true
fi
rm -rf "$DEMO"
mkdir -p "$DEMO/home/src/notify/.git" "$DEMO/state" "$DEMO/config"

export HOME="$DEMO/home"
export PATH="$REPO/bin:$PATH"
export ASPIRE_BIN="$REPO/docs/demo/bin/aspire"
export ASPIRE_DEMO_STATE="$DEMO/aspire-state.json"
export HERDR_SOCKET_PATH="$DEMO/herdr.sock"
export HERDR_PLUGIN_STATE_DIR="$DEMO/state"
export HERDR_PLUGIN_CONFIG_DIR="$DEMO/config"
# The recording is about 30 s long. At the default 20 s TTL an automatic
# refresh can land in the middle of the stop; 30 s keeps it after the stop, so
# every re-record shows the same sequence.
export ASPIRE_HUD_CACHE_TTL=30s
# `enter` in the HUD focuses a space through the socket, never through the
# herdr binary, but the open-hud verb would run it. Point it nowhere real.
export HERDR_BIN_PATH=false
unset HERDR_PLUGIN_ID HERDR_PLUGIN_CONTEXT_JSON HERDR_WORKSPACE_ID HERDR_PANE_ID

# The server exits by itself when this shell does.
node "$REPO/docs/demo/fake-herdr.mjs" --socket "$HERDR_SOCKET_PATH" --parent $$ \
  >"$DEMO/fake-herdr.log" 2>&1 &
echo $! >"$DEMO/fake-herdr.pid"
disown 2>/dev/null || true
for _ in $(seq 50); do
  [ -S "$HERDR_SOCKET_PATH" ] && break
  sleep 0.1
done

cd "$REPO" || return 1
clear 2>/dev/null || true
