# Demo recordings

The GIFs in `docs/` are recorded with [VHS](https://github.com/charmbracelet/vhs)
from the tapes in this directory. A recording is offline: it needs no Aspire
install, no herdr server, and no network.

## Re-record

```sh
brew install vhs gifsicle        # vhs brings ttyd and ffmpeg
bash docs/demo/record.sh         # every tape
bash docs/demo/record.sh hud     # only docs/hud.gif
```

`record.sh` runs each tape with `vhs`, then shrinks the GIF with
`gifsicle -O3 --lossy=40`. Run it from anywhere in the checkout.

## Try the HUD by hand

```sh
source docs/demo/env.sh
aspire-hud hud
```

This runs the HUD against the same fictional AppHosts as the recording. Close
the shell to stop the fake herdr socket.

## Where things live

| File | What it does |
| --- | --- |
| `hud.tape` | The HUD recording: browse AppHosts, mark one, stop it, refresh. Writes `docs/hud.gif`. |
| `style.tape` | Terminal size, font, and theme. Every tape sources it first. |
| `boot.tape` | Hidden setup. Sources `env.sh`, then starts the visible recording. |
| `env.sh` | Points the plugin at the fakes and at a throwaway directory. Starts the fake herdr socket. |
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

A recording never reads or writes `~/.config/herdr` or `~/.local/state/herdr`,
and never starts or stops a real AppHost.

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
