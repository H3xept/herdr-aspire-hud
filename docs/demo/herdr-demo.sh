#!/usr/bin/env bash
# A real, throwaway herdr server for the badges recording.
#
#   bash docs/demo/herdr-demo.sh up     # fresh server with the fixture spaces
#   bash docs/demo/herdr-demo.sh down   # stop its daemon and the server
#
# Everything lives under /tmp/aspire-hud-herdr (see herdr-env.sh). `up` makes a
# git checkout for every space in fixture.json, writes a demo config.toml,
# links this checkout as the plugin, starts `herdr server` headless and opens
# one space per checkout. The plugin reads docs/demo/bin/aspire through its
# config.env, so no Aspire install is needed. The daemon is not started: the
# recording starts it, the way the README's install step does.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo="$(cd "$here/../.." && pwd -P)"
# shellcheck source=docs/demo/herdr-env.sh
source "$here/herdr-env.sh"

PLUGIN=h3xept.aspire-hud

# Refuse to run a herdr command unless it is aimed at the demo directory.
isolated() {
  case "$HERDR_SOCKET_PATH:$XDG_CONFIG_HOME:$XDG_STATE_HOME" in
    "$HERDR_DEMO"/*:"$HERDR_DEMO"/*:"$HERDR_DEMO"/*) ;;
    *) echo "herdr-demo: environment is not isolated, refusing" >&2; exit 1 ;;
  esac
}

server_up() {
  [ -S "$HERDR_SOCKET_PATH" ] || return 1
  local status
  status="$(herdr status server 2>/dev/null)" || return 1
  [[ "$status" == *"status: running"* ]]
}

down() {
  isolated
  if server_up; then
    herdr plugin action invoke "$PLUGIN.stop" >/dev/null 2>&1 || true
    herdr server stop >/dev/null 2>&1 || true
  fi
  # A daemon whose server died first. Only a pid the demo's own state
  # directory names, and only if it is still this plugin's daemon.
  local pidfile pid
  for pidfile in "$XDG_STATE_HOME/herdr/plugins/$PLUGIN"/sessions/*/daemon.pid; do
    [ -f "$pidfile" ] || continue
    pid="$(cat "$pidfile")"
    if ps -o command= -p "$pid" 2>/dev/null | grep -q 'aspire-hud daemon'; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  for _ in $(seq 50); do
    [ -S "$HERDR_SOCKET_PATH" ] || break
    sleep 0.1
  done
}

git_() {
  git -c user.name=demo -c user.email=demo@example.invalid -c init.defaultBranch=main "$@"
}

# One "label<TAB>checkout<TAB>main checkout of the same repo" line per space.
spaces() {
  node -e '
    const f = require(process.argv[1]);
    const home = (p) => p.replace(/^~(?=\/)/, process.env.HOME);
    for (const s of f.spaces) {
      const main = f.spaces.find((o) => o.repo === s.repo && !o.linked);
      console.log([s.label, home(s.checkout), s.linked ? home(main.checkout) : ""].join("\t"));
    }' "$here/fixture.json"
}

up() {
  down
  rm -rf "$HERDR_DEMO"
  # notify has no space; its checkout gives the HUD row a name, as in env.sh.
  mkdir -p "$HOME/src/notify/.git" "$XDG_CONFIG_HOME/herdr" "$XDG_STATE_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"

  # Pane shells are login shells on macOS; give them the bare prompt too.
  cat >"$HOME/.bash_profile" <<'EOF'
export PS1='$ ' PROMPT_COMMAND= HISTFILE=/dev/null BASH_SILENCE_DEPRECATION_WARNING=1
EOF

  local label checkout main
  while IFS=$'\t' read -r label checkout main; do
    if [ -z "$main" ]; then
      mkdir -p "$checkout"
      git_ -C "$checkout" init -q
      git_ -C "$checkout" commit -q --allow-empty -m init
    fi
  done < <(spaces)
  while IFS=$'\t' read -r label checkout main; do
    [ -n "$main" ] && git_ -C "$main" worktree add -q -b "$label" "$checkout"
  done < <(spaces)

  cp "$here/herdr-config.toml" "$XDG_CONFIG_HOME/herdr/config.toml"

  trap 'echo "herdr-demo: up failed" >&2; down' ERR
  nohup herdr server >"$HERDR_DEMO/server.log" 2>&1 &
  disown 2>/dev/null || true
  for _ in $(seq 100); do
    server_up && break
    sleep 0.1
  done
  server_up || { echo "herdr-demo: server did not start; see $HERDR_DEMO/server.log" >&2; down; exit 1; }

  # Linked after the server is up: startup hooks run when a server starts, not
  # on link, so the daemon waits for the recording to start it.
  herdr plugin link "$repo" >/dev/null
  cat >"$(herdr plugin config-dir "$PLUGIN")/config.env" <<EOF
ASPIRE_BIN=$here/bin/aspire
ASPIRE_HUD_CACHE_TTL=2s
EOF

  # `worktree open`, not `workspace create`: only a space opened on a checkout
  # carries the worktree record the plugin maps AppHosts with. A linked
  # worktree opens from its main checkout. The first space in fixture.json is
  # the one the recording starts on.
  local focus=--focus
  while IFS=$'\t' read -r label checkout main; do
    herdr worktree open --cwd "${main:-$checkout}" --path "$checkout" --label "$label" "$focus" >/dev/null
    focus=--no-focus
  done < <(spaces)
  trap - ERR
}

isolated
case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: herdr-demo.sh up|down" >&2; exit 2 ;;
esac
