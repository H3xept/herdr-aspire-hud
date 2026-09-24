# Changelog

All notable changes appear in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-09-25

First public release. The plugin id is `h3xept.aspire-hud`.

### Added

- Sidebar badges. A daemon writes `◆ healthy/total` on every space whose
  worktree holds a running AppHost, as one of three tokens: `$aspire_ok`
  (green), `$aspire_warn` (yellow) or `$aspire_down` (red). An AppHost that does
  not answer `aspire describe` shows `◆ ?`.
- Resource levels. `ok`, `warn`, `down`, and `idle` for explicit-start
  resources that never ran. A one-shot that exited 0 is `ok`. Parameters and
  connection strings are not counted.
- Space mapping. An AppHost belongs to a space when its path is inside the
  space's worktree checkout; the deepest checkout wins.
- The HUD, a herdr popup. It lists every running AppHost, including AppHosts
  with no open space, and expands the selected one to its resources: state,
  health, and endpoints. It opens on the AppHost of the space it was called
  from. The header shows the age of the data and the time to the next refresh.
- HUD keys: `j`/`k` to select, `J`/`K` to scroll resources, `enter` to focus
  the AppHost's space, `o` to open the dashboard, `r` to refresh, `space` to
  mark, `x` to stop the marked or selected AppHosts, `X` to stop every AppHost,
  `q`/`esc` to close.
- Stopping AppHosts. `x` and `X` ask for `y` first. A stop runs
  `aspire stop --apphost <path>`; when that fails or hangs for 60 s, the plugin
  sends SIGTERM to the AppHost and its launching CLI, then SIGKILL after 5 s.
  The plugin never passes `--force`, which also deletes persistent volumes.
- One shared cache of aspire answers for the daemon and every open HUD. An
  answer is reused for `ASPIRE_HUD_CACHE_TTL` (default 20 s). A stop removes
  the stopped AppHosts from the cache at once.
- Badges carry a TTL of `max(30 s, 3 × cache TTL)` and the daemon rewrites them
  on every poll, so a dead daemon's badges expire and a restarted herdr server
  gets its badges back without reconnect logic.
- `bin/aspire-hud` verbs: `hud`, `open-hud`, `stop-apphost [path…]`,
  `refresh`, `daemon start|stop|run`, `status`, `clear`, `version`, `help`.
- `herdr-plugin.toml`: a startup hook that starts the daemon, the `hud` popup
  pane, and the actions `open`, `refresh`, `stop-apphost`, `start` and `stop`.
- Configuration in the plugin's `config.env`: `ASPIRE_HUD_CACHE_TTL` and
  `ASPIRE_BIN`. Environment variables of the same name override the file.
- A `node:test` suite that runs fully offline: no `aspire`, no `herdr`, no
  Docker and no network.

[0.1.0]: https://github.com/H3xept/herdr-aspire-hud/releases/tag/v0.1.0
