# Demo recordings

The GIFs in `docs/` are recorded with [VHS](https://github.com/charmbracelet/vhs)
from the tapes in this directory. A recording is offline: it needs no Aspire
install and no network. `hud.tape` needs no herdr either; `badges.tape` runs a
real herdr, as a throwaway server that shares nothing with yours.

## Re-record

```sh
brew install vhs gifsicle        # vhs brings ttyd and ffmpeg
bash docs/demo/record.sh         # every tape
bash docs/demo/record.sh hud     # only docs/hud.gif
bash docs/demo/record.sh badges  # only docs/badges.gif; needs herdr (recorded on 0.9.1)
```

`record.sh` runs each tape with `vhs`, then shrinks the GIF with
`gifsicle -O3 --lossy=40`. Run it from anywhere in the checkout. It drops every
inherited `HERDR_*` variable first, so running it from a herdr pane is safe,
and after `badges` it stops the demo herdr server even when the tape failed.

## Try the HUD by hand

```sh
source docs/demo/env.sh
aspire-hud hud
```

This runs the HUD against the same fictional AppHosts as the recording. Close
the shell to stop the fake herdr socket.

## Try the badges by hand

```sh
bash docs/demo/herdr-demo.sh up
source docs/demo/herdr-env.sh
herdr                                              # attach to the demo server
herdr plugin action invoke h3xept.aspire-hud.start # in its pane
bash docs/demo/herdr-demo.sh down                  # after detaching (prefix+q)
```

Source `herdr-env.sh` in every shell that talks to the demo server; without it
`herdr` reaches your own.

## Where things live

| File | What it does |
| --- | --- |
| `hud.tape` | The HUD recording: browse AppHosts, mark one, stop it, refresh. Writes `docs/hud.gif`. |
| `badges.tape` | The sidebar recording in a real herdr: start the daemon, watch the badges appear, stop `billing` from the HUD and watch its badge go. Writes `docs/badges.gif`. |
| `style.tape` | Terminal size, font, and theme. Every tape sources it first. |
| `boot.tape` | Hidden setup for `hud.tape`. Sources `env.sh`, then starts the visible recording. |
| `env.sh` | Points the plugin at the fakes and at a throwaway directory. Starts the fake herdr socket. |
| `herdr-env.sh` | Points herdr, the plugin and the fake aspire at `/tmp/aspire-hud-herdr`. Sourced by `herdr-demo.sh` and `badges.tape`. |
| `herdr-demo.sh` | `up`: a git checkout per fixture space, a fresh herdr server with `herdr-config.toml`, this checkout linked as the plugin, one space per checkout. `down`: stops the demo daemon and server. |
| `herdr-config.toml` | The demo server's `config.toml`: the README's sidebar rows and keybinding (on `prefix+a`, since vhs cannot send `alt` through to herdr), Tokyo Night, no update checks. |
| `fixture.json` | The fictional herdr spaces and AppHosts, with their resources. |
| `bin/aspire` | A fake Aspire CLI. Answers `ps`, `describe`, and `stop` from `fixture.json`. |
| `fake-herdr.mjs` | A fake herdr socket. Answers `workspace.list`, `workspace.focus`, `workspace.report_metadata`, and `notification.show`. |
| `record.sh` | Records every tape and optimizes the GIFs. |

## Isolation

`env.sh` puts all demo state under `/tmp/aspire-hud-demo` and deletes it at the
start of each run. It sets these variables:

| Variable | Value |
| --- | --- |
| `HOME` | `/tmp/aspire-hud-demo/home`, so the HUD prints paths as `~/src/...` |
| `ASPIRE_BIN` | `docs/demo/bin/aspire` |
| `ASPIRE_DEMO_STATE` | `/tmp/aspire-hud-demo/aspire-state.json`: the demo start time and the stopped AppHosts |
| `ASPIRE_HUD_CACHE_TTL` | `30s`, so no automatic refresh lands during the stop |
| `HERDR_SOCKET_PATH` | `/tmp/aspire-hud-demo/herdr.sock` |
| `HERDR_PLUGIN_STATE_DIR` | `/tmp/aspire-hud-demo/state` |
| `HERDR_PLUGIN_CONFIG_DIR` | `/tmp/aspire-hud-demo/config` |

### The badges recording

`herdr-env.sh` puts the demo herdr under `/tmp/aspire-hud-herdr` (the physical
path, `/private/tmp/...` on macOS, so git and the fake aspire agree on it).
`herdr-demo.sh up` deletes and recreates it. `herdr-env.sh` unsets every
inherited `HERDR_*` variable, then sets:

| Variable | Value | Moves |
| --- | --- | --- |
| `XDG_CONFIG_HOME` | `/tmp/aspire-hud-herdr/xdg/config` | herdr's `config.toml`, logs, `plugins.json` and plugin config directories |
| `XDG_STATE_HOME` | `/tmp/aspire-hud-herdr/xdg/state` | herdr's plugin state directories, where the daemon keeps its pid and `cache.json` |
| `XDG_DATA_HOME`, `XDG_CACHE_HOME` | under `/tmp/aspire-hud-herdr/xdg` | anything else herdr keeps per user |
| `HERDR_SOCKET_PATH` | `/tmp/aspire-hud-herdr/herdr.sock` | the API socket, and the client socket next to it |
| `HOME` | `/tmp/aspire-hud-herdr/home` | the fixture checkouts under `~/src`, and the pane shells' `~/.bash_profile` |
| `ASPIRE_DEMO_STATE` | `/tmp/aspire-hud-herdr/aspire-state.json` | the fake aspire's stopped AppHosts, apart from `hud.tape`'s |

`HOME` alone isolates none of herdr, and `herdr --session <name>` still keeps
its files under the real `~/.config/herdr`, so the recording uses neither. The
plugin's `config.env` in the demo config directory sets `ASPIRE_BIN` to
`docs/demo/bin/aspire` and `ASPIRE_HUD_CACHE_TTL` to `2s`, the minimum, so the
badges follow a stop within two seconds. `herdr-demo.sh` refuses to run unless
the socket and both XDG directories are inside `/tmp/aspire-hud-herdr`.

A recording never reads or writes `~/.config/herdr` or `~/.local/state/herdr`,
never connects to your herdr server, and never starts or stops a real AppHost.

## Change the demo

- To change the AppHosts or their resources, edit `fixture.json`. A resource
  takes `name`, `type`, `state`, and optionally `health`, `exitCode`, `urls`,
  and `at` (seconds after the AppHost came up).
- To change what the recording shows, edit the tape. Anchor each step on text
  the HUD prints with `Wait+Screen`, not on a long `Sleep`.
- After a re-record, extract a few frames and look at them before you commit:

  ```sh
  ffmpeg -i docs/hud.gif -vf "fps=1/2,scale=620:-1,tile=2x4" /tmp/hud-%d.png
  ```
