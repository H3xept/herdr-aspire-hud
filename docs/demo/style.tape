# Look only: Require and Set, never a Type. Sourced first by every tape.
#
# vhs applies Set to the terminal it is about to start, so every Set has to come
# before the first keystroke. A tape that overrides the size therefore sources
# this, then its own Set lines, and only then sources boot.tape.

Require bash
Require git
Require node

Set Shell bash
Set FontSize 15
# In real use the HUD is a popup of 90% x 80% of the herdr window. 1240 x 520
# gives it about 130 columns and 26 rows, which is that popup on a laptop
# screen: every endpoint fits and the largest AppHost's resources fit too.
Set Width 1240
Set Height 520
Set Padding 22
# Tokyo Night, from folke/tokyonight.nvim. The theme vhs bundles under that
# name draws ANSI green as teal, which the HUD's cyan endpoints sit right next
# to; this one keeps green green, so ok, warn and down read at a glance.
Set Theme { "name": "TokyoNight", "black": "#15161e", "red": "#f7768e", "green": "#9ece6a", "yellow": "#e0af68", "blue": "#7aa2f7", "magenta": "#bb9af7", "cyan": "#7dcfff", "white": "#a9b1d6", "brightBlack": "#414868", "brightRed": "#f7768e", "brightGreen": "#9ece6a", "brightYellow": "#e0af68", "brightBlue": "#7aa2f7", "brightMagenta": "#bb9af7", "brightCyan": "#7dcfff", "brightWhite": "#c0caf5", "background": "#1a1b26", "foreground": "#c0caf5", "selection": "#33467c", "cursor": "#c0caf5" }
Set TypingSpeed 40ms
Set Framerate 24
