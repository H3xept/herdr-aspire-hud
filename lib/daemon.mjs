// The badge daemon.
//
// Every poll it lists running AppHosts, maps each onto the herdr spaces whose
// worktree holds it, and writes one `$aspire_*` token per space. Tokens are
// written with a TTL and rewritten every poll, so they survive nothing they
// should not: a dead daemon's badges expire, and a restarted herdr server,
// which holds no plugin tokens, is repainted on the next poll without any
// reconnect logic.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cacheTtlMs, poll } from './collect.mjs';
import { PLUGIN_ID } from './env.mjs';
import { clearedTokens, levelOf, tokensFor } from './model.mjs';
import { listSpaces, send } from './socket.mjs';
import {
  claimDaemon, daemonPid, forgetDaemon, log, lastPoll, recordPoll, releaseDaemon, rotateLog,
} from './state.mjs';

// Herdr scopes tokens per source, so this plugin can only ever clear its own.
const SOURCE = PLUGIN_ID;

function report(workspaceId, tokens, ttlMs) {
  const params = { workspace_id: workspaceId, source: SOURCE, tokens };
  if (ttlMs) params.ttl_ms = ttlMs;
  return { method: 'workspace.report_metadata', params };
}

/** Group AppHost details by the space that shows them. */
function bySpace(apphosts) {
  const out = new Map();
  for (const apphost of apphosts) {
    for (const id of apphost.spaces) {
      if (!out.has(id)) out.set(id, []);
      out.get(id).push(apphost.detail);
    }
  }
  return out;
}

/** Run the loop in the foreground until SIGTERM/SIGINT. */
export async function run() {
  const existing = daemonPid();
  if (existing && existing !== process.pid) throw new Error(`daemon already running (pid ${existing})`);
  claimDaemon();
  rotateLog();

  const periodMs = cacheTtlMs();
  // Long enough to ride out one slow poll, short enough that a killed daemon's
  // badges are gone soon after.
  const ttlMs = Math.max(30_000, periodMs * 3);

  let painted = new Set();
  let lastLevels = new Map();
  let lastError = '';
  let timer = null;
  let running = null;
  let stopping = false;

  const tick = async () => {
    try {
      const snap = await poll({ ttlMs: periodMs, mappedOnly: true });
      // A stop that arrived mid-poll must not be followed by a repaint.
      if (stopping) return;
      const grouped = bySpace(snap.apphosts);
      const requests = [...grouped].map(([id, details]) => report(id, tokensFor(details), ttlMs));
      for (const id of painted) if (!grouped.has(id)) requests.push(report(id, clearedTokens()));
      const responses = await send(requests);
      const failed = responses.find((r) => r?.error);
      if (failed) log(`token write failed: ${failed.error.code}: ${failed.error.message}`);
      painted = new Set(grouped.keys());

      // Log transitions only; a steady state writes nothing. AppHosts outside
      // every space are not described, so they have no level to log.
      const levels = new Map(snap.apphosts.filter((a) => a.spaces.length).map((a) => [a.appHostPath, levelOf(a.detail)]));
      for (const [path, level] of levels) {
        if (lastLevels.get(path) !== level) log(`${path}: ${lastLevels.get(path) ?? 'new'} -> ${level}`);
      }
      for (const path of lastLevels.keys()) if (!levels.has(path)) log(`${path}: gone`);
      lastLevels = levels;
      if (lastError) { log('recovered'); lastError = ''; }

      const labels = new Map(snap.spaces.map((s) => [s.workspace_id, s.label]));
      recordPoll({
        at: snap.at,
        pid: process.pid,
        apphosts: snap.apphosts.map((a) => ({
          appHostPath: a.appHostPath,
          appHostPid: a.appHostPid,
          spaces: a.spaces.map((id) => labels.get(id) ?? id),
          level: a.spaces.length ? levelOf(a.detail) : 'unwatched',
          badge: a.spaces.length ? Object.values(tokensFor([a.detail])).find(Boolean) : null,
          error: a.detail?.error ?? null,
        })),
      });
    } catch (err) {
      const message = String(err.message ?? err);
      if (message !== lastError) log(`poll failed: ${message}`);
      lastError = message;
    }
  };

  let again = false; // a refresh signal arrived while a tick ran
  const loop = () => {
    running = tick().finally(() => {
      running = null;
      if (stopping) return;
      timer = setTimeout(loop, again ? 0 : periodMs);
      again = false;
    });
    return running;
  };

  // `aspire-hud refresh` and the HUD's `r` refill the cache, then send
  // SIGUSR1 so the badges follow at once instead of at the next period.
  process.on('SIGUSR1', () => {
    if (stopping) return;
    if (running) { again = true; return; }
    clearTimeout(timer);
    loop();
  });

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    await running;
    // Clear rather than wait for the TTL: `daemon stop` should look stopped.
    if (painted.size) await send([...painted].map((id) => report(id, clearedTokens()))).catch(() => {});
    log('stopped');
    releaseDaemon();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('exit', releaseDaemon);

  log(`up: pid ${process.pid}, refresh every ${periodMs}ms, token ttl ${ttlMs}ms`);
  await loop();
  return new Promise(() => {});
}

/** Start a detached daemon unless one is already running. */
export function start() {
  const existing = daemonPid();
  if (existing) return { started: false, pid: existing };
  const cli = fileURLToPath(new URL('../bin/aspire-hud', import.meta.url));
  const child = spawn(process.execPath, [cli, 'daemon', 'run'], { detached: true, stdio: 'ignore' });
  child.unref();
  return { started: true, pid: child.pid };
}

/** Stop the running daemon; it clears its own badges on the way out. */
export async function stop() {
  const pid = daemonPid();
  if (!pid) { forgetDaemon(); return null; }
  try { process.kill(pid, 'SIGTERM'); } catch { return pid; }
  for (let i = 0; i < 50 && daemonPid() === pid; i += 1) await new Promise((r) => setTimeout(r, 100));
  return pid;
}

/** Ask the running daemon to repaint from the cache now. False if none runs. */
export function nudge() {
  const pid = daemonPid();
  if (!pid) return false;
  try { process.kill(pid, 'SIGUSR1'); return true; } catch { return false; }
}

/** Clear this plugin's tokens from every space, daemon or not. */
export async function clearAll() {
  const spaces = await listSpaces();
  await send(spaces.map((s) => report(s.workspace_id, clearedTokens())));
  return spaces.length;
}

export { lastPoll };
