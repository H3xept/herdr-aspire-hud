# The HUD: every running AppHost, the selected one expanded to its resources,
# and a stop.
#
# Recorded against docs/demo/bin/aspire and docs/demo/fake-herdr.mjs, so the
# recording needs neither Aspire nor a herdr server. In real use the HUD opens
# in a herdr popup; here it runs in the terminal itself, which draws the same.

Source docs/demo/style.tape

Output docs/hud.gif

Source docs/demo/boot.tape

Type "aspire-hud hud"
Sleep 500ms
Enter
# The header counts AppHosts by level once the first poll lands.
Wait+Screen@15s /healthy/
Sleep 3s

# Down the list: a worktree still coming up, then an AppHost with a failure.
Type "j"
Sleep 3.5s
Type "j"
Sleep 3.5s

# Mark the failing AppHost. Space marks and moves the cursor on, here to an
# AppHost in a checkout with no open space; k comes back to the marked one.
Space
Sleep 2.5s
Type "k"
Sleep 1.5s

# Stop the marked AppHost. The row says "stopping…", then leaves the list.
Type "x"
Wait+Screen@5s /y\/n/
Sleep 2s
Type "y"
Wait+Screen@15s /stopped 1/
Sleep 3s

# Skip the cache: ask aspire about everything now.
Type "r"
Wait+Screen@15s /refreshed/
Sleep 3s
Type "q"
Sleep 1s
