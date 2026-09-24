# Repository guidance

`herdr-aspire-hud` is a herdr plugin in plain Node ESM. It needs Node >= 20 and
the Aspire CLI, and it has no npm dependencies. `herdr-plugin.toml` declares the
startup hook, the HUD pane and the actions; every entry runs `bin/aspire-hud`
with one verb. `README.md` documents the behavior for users and
`docs/architecture.md` explains the design. Neither redefines what the code
does.

## Module map

|File|Responsibility|
|---|---|
|`bin/aspire-hud`|The CLI. Parses the verb and calls into `lib/`. Holds the `HELP` text. Reads its version from `package.json`.|
|`lib/env.mjs`|The plugin id, the config and state directories, the herdr socket path, `config.env` parsing, and the path to `aspire`. Falls back to the directories herdr would inject, so a verb run from a shell and the same verb run from herdr agree.|
|`lib/aspire.mjs`|The Aspire CLI as data: `aspire ps`, `aspire describe`, `aspire stop`, and the signal fallback of a stop. `describe` never throws; a failure becomes `error` on the result.|
|`lib/collect.mjs`|One poll: AppHosts, spaces, and a resource list per AppHost, through the shared cache. `cacheTtlMs` and `forgetAppHosts` live here.|
|`lib/model.mjs`|Pure rules, no I/O: resource state to level, AppHost to space, levels to badge tokens. Tested against recorded `aspire describe` output.|
|`lib/daemon.mjs`|The badge daemon: the poll loop, token writes with a TTL, SIGUSR1 repaint, start, stop and clear.|
|`lib/hud.mjs`|The HUD popup: rendering, keys, the stop confirmation, and the 1 s tick.|
|`lib/socket.mjs`|The raw herdr socket client. One request per connection, fanned out over parallel connections.|
|`lib/state.mjs`|Files in the plugin state directory: the daemon pid, log and last poll, per session; and `cache.json`, shared by every session.|
|`tests/`|`node:test` suites. They use a fake `aspire` script and a fake herdr socket in a temp directory.|
|`docs/demo/`|The fixtures and vhs tapes that record the README GIFs. Not shipped.|

## Invariants

Never pass `--force` to `aspire stop`. It also deletes persistent volumes, such
as database data. A stop runs `aspire stop --apphost <path>` first. Only when
that fails or hangs for 60 s does it send SIGTERM to the AppHost and its
launching CLI, then SIGKILL after 5 s.

Poll. Do not follow. `aspire ps --follow` never reports a removal on Aspire
13.5, and `aspire describe --follow` holds a ~64 MB process per AppHost. The
daemon and the HUD run one-shot calls on a timer.

Every aspire answer goes through the one shared cache, `cache.json` in the
plugin state directory. An answer is reused while it is younger than
`ASPIRE_HUD_CACHE_TTL` (default 20 s, minimum 2 s). Only a refresh (the
`refresh` verb, the HUD's `r`) skips it. A stop removes the stopped AppHosts
from the cache at once. Do not add a call to `aspire` that bypasses the cache.

The daemon runs `aspire describe` only for AppHosts inside a space. The HUD
describes the other AppHosts too.

Badges carry a TTL of `max(30 s, 3 × cache TTL)` and the daemon rewrites every
badge on each poll. A dead daemon's badges expire by themselves, and a
restarted herdr server gets its badges back on the next poll. Do not add
reconnect logic or cleanup that depends on a clean exit. `daemon stop` clears
the badges at once.

The daemon writes at most one of `$aspire_ok`, `$aspire_warn`, `$aspire_down`
per space. Herdr colors a token by its name, so there is one token per level.

An AppHost belongs to a space when its path is inside the space's worktree
checkout. When checkouts nest, the deepest checkout wins.

`lib/model.mjs` stays free of I/O. Put a new classification or mapping rule
there and test it there.

Keep the product dependency-free: only `node:` built-ins. Tests must not
require `aspire`, `herdr`, Docker or a network.

Keep `package.json` and `herdr-plugin.toml` on the same version. `bin/aspire-hud`
reads `package.json`; `tests/manifest.test.mjs` fails when the manifest
differs. The fallback plugin id in `lib/env.mjs` must equal the manifest `id`,
`h3xept.aspire-hud`; the same test asserts it.

Run `npm run check` and `npm test` after any change to `lib/`, `bin/`,
`herdr-plugin.toml` or version metadata. Never touch the real
`~/.config/herdr` or a real AppHost to verify a change. Use the fixtures in
`docs/demo/`.

## Vocabulary

One term per concept.

|Term|Meaning|
|---|---|
|AppHost|one running Aspire AppHost, identified by its `appHostPath`|
|resource|one entry of an AppHost's `aspire describe` output: a container, a project, an executable. Parameters and connection strings are not counted.|
|space|a herdr space (a workspace); it has a worktree checkout|
|badge|the `◆ healthy/total` text the daemon writes on a space|
|token|the herdr metadata key that carries a badge: `aspire_ok`, `aspire_warn` or `aspire_down`|
|level|the health of a resource or an AppHost: `ok`, `warn`, `down`, or `idle` (not started, not counted)|
|daemon|the background process that polls and writes the badges|
|HUD|the popup pane that lists AppHosts and their resources and can stop them|
|cache|`cache.json`: the last `aspire ps` answer and one `aspire describe` answer per AppHost, each with its fetch time|
|poll|one pass: read `aspire ps` and the spaces, describe what is due, return the result|
|refresh|a poll that skips the cache, then a SIGUSR1 to the daemon|
|stop|end an AppHost with `aspire stop`, with signals as the fallback|
