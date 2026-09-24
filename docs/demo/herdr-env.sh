# Sourced by herdr-demo.sh and by the badges tape. Points herdr, the plugin
# and the fake aspire at a throwaway directory, so a real herdr 0.9 server can
# run for the recording without touching the user's own.
#
# herdr keeps its config, logs and plugin registry under $XDG_CONFIG_HOME/herdr
# and plugin state under $XDG_STATE_HOME/herdr; HERDR_SOCKET_PATH moves the API
# socket and, next to it, the client socket. HOME alone isolates none of that,
# and `herdr --session` still lives under the real ~/.config/herdr. Every
# HERDR_* variable inherited from a herdr pane (this may run inside one) is
# dropped first, so nothing can reach the user's server.
#
# shellcheck shell=bash

# The physical path: git reports checkouts with /private/tmp on macOS, and the
# fake aspire builds AppHost paths from HOME, so both must spell it the same.
HERDR_DEMO="$(cd /tmp && pwd -P)/aspire-hud-herdr"

while IFS= read -r name; do
  unset "$name"
done < <(compgen -e | grep '^HERDR_')

export HOME="$HERDR_DEMO/home"
export XDG_CONFIG_HOME="$HERDR_DEMO/xdg/config"
export XDG_STATE_HOME="$HERDR_DEMO/xdg/state"
export XDG_DATA_HOME="$HERDR_DEMO/xdg/data"
export XDG_CACHE_HOME="$HERDR_DEMO/xdg/cache"
export HERDR_SOCKET_PATH="$HERDR_DEMO/herdr.sock"
export ASPIRE_DEMO_STATE="$HERDR_DEMO/aspire-state.json"
export BASH_SILENCE_DEPRECATION_WARNING=1
export PS1='$ '
export PROMPT_COMMAND=
export HISTFILE=/dev/null
