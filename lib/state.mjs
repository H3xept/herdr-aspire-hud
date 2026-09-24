// Durable plugin state: the daemon's pid, its log, its last poll, and the
// shared aspire cache.
//
// Herdr gives a plugin one state directory per user, not per session. Badges
// belong to one session, so the daemon files are namespaced by session key.
// The aspire cache is machine-wide, like the AppHosts it describes.
import {
  appendFileSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { socketPath, stateDir } from './env.mjs';

// ~/.config/herdr/herdr.sock              -> "default"
// ~/.config/herdr/sessions/lab/herdr.sock -> "lab"
export function sessionKey() {
  const name = basename(dirname(socketPath()));
  const key = name === 'herdr' ? 'default' : name;
  return key.replace(/[^A-Za-z0-9._-]/g, '_') || 'default';
}

function sessionFile(name) {
  const dir = join(stateDir(), 'sessions', sessionKey());
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

function writeAtomic(target, text) {
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, target);
}

function readText(target) {
  try { return readFileSync(target, 'utf8'); } catch { return ''; }
}

// --- daemon ----------------------------------------------------------------
//
// The pid file is the lock. A stale one from a crashed daemon or a reboot is
// detected by checking that the process is really alive.

const PID = 'daemon.pid';

export function daemonPid() {
  const pid = Number.parseInt(readText(sessionFile(PID)).trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); } catch { return null; }
  return pid;
}

export function claimDaemon(pid = process.pid) {
  writeAtomic(sessionFile(PID), `${pid}\n`);
}

export function releaseDaemon() {
  if (daemonPid() !== process.pid) return;
  try { unlinkSync(sessionFile(PID)); } catch { /* already gone */ }
}

export function forgetDaemon() {
  try { unlinkSync(sessionFile(PID)); } catch { /* already gone */ }
}

// --- log -------------------------------------------------------------------

const LOG = 'daemon.log';
const LOG_MAX_BYTES = 256 * 1024;

export function logPath() {
  return sessionFile(LOG);
}

/** Start a fresh log when the old one has grown past the cap. */
export function rotateLog() {
  try {
    if (statSync(sessionFile(LOG)).size > LOG_MAX_BYTES) renameSync(sessionFile(LOG), sessionFile(`${LOG}.1`));
  } catch { /* no log yet */ }
}

export function log(line) {
  try { appendFileSync(sessionFile(LOG), `${new Date().toISOString()} ${line}\n`); } catch { /* best effort */ }
}

// --- last poll -------------------------------------------------------------
//
// What the daemon saw last, so `aspire-hud status` can explain the sidebar
// without spawning aspire.

export function recordPoll(record) {
  writeAtomic(sessionFile('last.json'), `${JSON.stringify(record, null, 1)}\n`);
}

export function lastPoll() {
  try { return JSON.parse(readText(sessionFile('last.json'))); } catch { return null; }
}

// --- aspire cache ----------------------------------------------------------
//
// `{ps: {at, apphosts} | null, details: {[appHostPath]: {at, pid, ...}}}`.
// The daemon and every HUD read and write it, so an AppHost is asked about
// once per cache lifetime no matter how many of them are running.

const cacheFile = () => join(stateDir(), 'cache.json');

export function readCache() {
  try {
    const cache = JSON.parse(readText(cacheFile()));
    return { ps: cache.ps ?? null, details: cache.details ?? {} };
  } catch {
    return { ps: null, details: {} };
  }
}

export function writeCache(cache) {
  writeAtomic(cacheFile(), JSON.stringify(cache));
}
