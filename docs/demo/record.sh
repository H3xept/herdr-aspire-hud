#!/usr/bin/env bash
# Re-record every demo GIF in docs/ from the tapes in this directory.
#
#   bash docs/demo/record.sh          # all of them
#   bash docs/demo/record.sh hud      # just docs/hud.gif
#   bash docs/demo/record.sh badges   # just docs/badges.gif
#
# Needs vhs (which brings ttyd and ffmpeg), gifsicle, and node, none of which
# the plugin itself depends on beyond node. The hud tape runs against a fake
# aspire CLI and a fake herdr socket under /tmp/aspire-hud-demo. The badges
# tape also needs herdr: it runs a throwaway herdr server under
# /tmp/aspire-hud-herdr (see herdr-demo.sh), never the user's. No re-record
# needs an Aspire install or a network.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

for bin in vhs gifsicle node; do
  command -v "$bin" >/dev/null || {
    echo "record.sh needs $bin: brew install vhs gifsicle node" >&2
    exit 1
  }
done

tapes=("$@")
if [ "${#tapes[@]}" -eq 0 ]; then
  tapes=(hud badges)
fi

# Run from a herdr pane, the shell carries that server's socket and ids. No
# tape may inherit them.
while IFS= read -r var; do
  unset "$var"
done < <(compgen -e | grep '^HERDR_' || true)

for name in "${tapes[@]}"; do
  [ "$name" = badges ] || continue
  command -v herdr >/dev/null || {
    echo "record.sh badges needs herdr: https://herdr.dev" >&2
    exit 1
  }
  # The tape stops its herdr server itself; this catches a tape that failed
  # before it got there.
  trap 'bash docs/demo/herdr-demo.sh down' EXIT
done

for name in "${tapes[@]}"; do
  tape="docs/demo/$name.tape"
  gif="docs/$name.gif"
  [ -f "$tape" ] || { echo "no such tape: $tape" >&2; exit 1; }

  echo "recording $tape"
  vhs "$tape"

  # vhs writes a 256-colour GIF a frame at a time. A terminal recording is
  # almost all repeated pixels, so -O3 with a light lossy budget typically
  # halves the file with no visible change at README scale.
  before=$(wc -c <"$gif")
  gifsicle -O3 --lossy=40 --batch "$gif"
  after=$(wc -c <"$gif")
  printf '%s  %sK -> %sK\n' "$gif" "$((before / 1024))" "$((after / 1024))"
done
