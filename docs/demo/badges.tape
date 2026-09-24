# The sidebar badges, in a real herdr: start the daemon, watch every space with
# a running AppHost get its badge, then stop the failing AppHost from the HUD
# and watch its badge go.
#
# docs/demo/herdr-demo.sh runs a throwaway herdr server under
# /tmp/aspire-hud-herdr with the fixture spaces, the README's sidebar rows and
# this checkout linked as the plugin. The plugin reads docs/demo/bin/aspire, so
# the recording needs no Aspire install and no network, and never reaches the
# user's own herdr server.

Source docs/demo/style.tape

# A whole herdr window rather than a popup: wide enough for the sidebar next
# to a HUD popup (90% x 80% of the pane area) that fits its columns, tall
# enough for the stop confirmation.
Set Width 1440
Set Height 600

Output docs/badges.gif

Hide
Type "source docs/demo/herdr-env.sh && bash docs/demo/herdr-demo.sh up && clear"
Enter
Sleep 4s
Type "herdr"
Enter
Wait+Screen@15s /dotfiles/
Sleep 1s
Show

Sleep 1s
# The README's install step. The daemon polls the fake aspire and paints a
# badge on each space whose checkout holds a running AppHost.
Type "herdr plugin action invoke h3xept.aspire-hud.start >/dev/null"
Sleep 500ms
Enter
Wait+Screen@10s /2\/4/
Sleep 3s

# The keybinding opens the HUD on the focused space's AppHost; the popup
# covers the pane, not the sidebar. Down to billing, the failing one, and stop
# it.
Ctrl+B
Sleep 300ms
Type "a"
Wait+Screen@10s /healthy/
Sleep 1.5s
Type "j"
Sleep 800ms
Type "j"
Sleep 1.2s
Type "x"
Wait+Screen@5s /y\/n/
Sleep 1s
Type "y"
Wait+Screen@15s /stopped 1/
Sleep 1.5s
Type "q"
# The daemon's next poll, within the 2 s cache TTL, has already cleared
# billing's red badge.
Sleep 3s

Hide
# Detach, then stop the demo daemon and server. record.sh runs `down` again
# in case the tape failed before this point.
Ctrl+B
Type "q"
Sleep 1s
Type "bash docs/demo/herdr-demo.sh down"
Enter
Sleep 3s
