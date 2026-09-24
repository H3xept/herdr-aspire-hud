# Security policy

## Supported versions

Only the latest release receives security fixes.

## Report a vulnerability

Do not open a public issue for a security problem.

Report it privately through
[GitHub security advisories](https://github.com/H3xept/herdr-aspire-hud/security/advisories/new).
Include the version, your platform, the steps to reproduce, and the impact you
expect.

The maintainer answers in the advisory. When the fix ships, the advisory is
published and credits you, unless you ask to stay anonymous.

## Scope

The plugin runs `aspire` and talks to the local herdr socket with the rights of
your user. It sends signals only to the processes that `aspire ps` reports for
an AppHost. It never passes `--force` to `aspire stop`. A way to make the
plugin signal another process, delete data, or run a command it did not name is
in scope.
