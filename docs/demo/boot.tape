# Hidden setup, sourced after the last Set. Points the plugin at a fake aspire
# CLI and a fake herdr socket under /tmp/aspire-hud-demo, puts bin/ on PATH and
# sets a bare prompt.
#
# None of that is interesting to watch and all of it has to be identical across
# the tapes, so it lives in docs/demo/env.sh where shellcheck can read it.

Hide
Type "source docs/demo/env.sh"
Enter
Sleep 2s
Show
