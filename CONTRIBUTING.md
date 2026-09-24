# Contributing to herdr-aspire-hud

Thanks for taking a look. This is a small Node plugin with no dependencies and
a few strong rules. The goal is to keep all of them.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## The rules that shape every review

**The plugin never passes `--force` to `aspire stop`.** `--force` also deletes
persistent volumes, such as database data. A stop runs `aspire stop --apphost
<path>`, and only when that fails or hangs does it signal the processes. A pull
request that adds `--force`, on any path, will be declined.

**The plugin polls. It does not follow.** On Aspire 13.5, `aspire ps --follow`
emits one AppHost per line and never reports a removal, and
`aspire describe --follow` holds a ~64 MB process per AppHost. One-shot calls on
a timer are cheaper and always tell the whole truth. Do not replace the poll
with a `--follow` stream unless Aspire fixes both problems, and say which
Aspire version fixed them.

**Every aspire answer goes through the one shared cache.** The daemon and every
open HUD read `cache.json` in the plugin state directory. Together they ask
aspire at most once per cache TTL. A new call to `aspire` that skips the cache
multiplies the load by the number of open HUDs.

**No runtime dependencies.** The plugin needs Node >= 20 and the Aspire CLI.
"No install step" is a feature. A new npm dependency needs a real argument, and
the answer is usually no.

**Tests run offline.** No test may need `aspire`, `herdr`, Docker, or a network.
The suite uses a fake `aspire` shell script and a fake herdr socket in a temp
directory. A test that needs a real AppHost is a test nobody can run, including
CI.

## Before you write code

Open an issue first for anything beyond an obvious fix. The answer is sometimes
"that is a configuration key" or "that belongs in herdr", and both are better
than a patch.

Good first contributions:

- A resource state that the badge classifies wrong. Attach the
  `aspire describe --format Json` output for the resource.
- A newer Aspire version that changes the JSON shape of `aspire ps` or
  `aspire describe`.
- Platform breakage. Development happens on macOS, so Linux gets less
  real-world use than it deserves.

## Development setup

There is no build step and no dependency install. You need Node >= 20.

```sh
git clone git@github.com:H3xept/herdr-aspire-hud.git
cd herdr-aspire-hud
npm test
bin/aspire-hud help
```

Run it as a herdr plugin from your checkout:

```sh
herdr plugin link "$PWD"
herdr plugin action invoke h3xept.aspire-hud.start   # startup hooks do not run on link
```

After you change `lib/daemon.mjs` or `lib/collect.mjs`, restart the daemon with
`bin/aspire-hud daemon stop` and `bin/aspire-hud daemon start`. The HUD loads
the code again each time it opens.

## Run it without Aspire or herdr

`docs/demo/` holds the fixtures the README recording uses: a fake `aspire` CLI,
a fake herdr socket, and an environment file that points the plugin at both.
Everything they write lives under a temp directory, so they never touch your
real herdr configuration, your herdr state, or a real AppHost.

Use them to exercise the HUD, the daemon and the stop flow on any machine. See
`docs/demo/README.md` for the exact commands.

## Checks

```sh
npm run check   # node --check on bin/aspire-hud and every lib/*.mjs
npm test        # node --test tests/*.test.mjs
```

CI runs both on Node 20 and 22, on Linux and macOS.

Run `npm test` after any change to `lib/`, `bin/aspire-hud`,
`herdr-plugin.toml`, or version metadata.

## The GIFs in the README

`docs/*.gif` are build artifacts. Their source is the tapes in `docs/demo/`,
which are [vhs](https://github.com/charmbracelet/vhs) scripts, so a recording
can be made again rather than being a one-off screen capture. Re-record with:

```sh
brew install vhs gifsicle   # vhs brings ttyd and ffmpeg
bash docs/demo/record.sh
```

A recording uses only the demo fixtures. **It never shows a real AppHost, a
real path, or a real dashboard token.** Keep it that way: a GIF is the most
public artifact in the repo.

## Pull requests

- One concern per pull request.
- Say what you ran and what you saw. "Stopped two marked AppHosts in the demo,
  both rows went, the badges cleared on the next poll" is the useful kind of
  description.
- New verb, key, or configuration key? Update the `HELP` text in
  `bin/aspire-hud` and the README together.
- Keep `package.json` and `herdr-plugin.toml` on one version. A test asserts
  it.
- Add to `CHANGELOG.md` under an `Unreleased` heading.

## Code conventions

- Plain Node ESM. Only `node:` built-ins.
- Comments explain *why*. The *what* is readable from the code.
- `lib/model.mjs` stays pure: no I/O, so every rule is testable against
  recorded `aspire describe` output. Put a new rule there, and test it there.
- One term per concept. See the vocabulary table in [AGENTS.md](AGENTS.md).
- Failure is data. An AppHost that does not answer `aspire describe` shows
  `◆ ?`. It does not stop the poll for the other AppHosts.
- Badges are written with a TTL and rewritten on every poll. Do not add
  reconnect or cleanup logic that depends on the daemon exiting cleanly.

## Releasing

Maintainer only. Bump the version in `package.json` and `herdr-plugin.toml`,
update `CHANGELOG.md`, tag the commit `vX.Y.Z`, and push the tag.
