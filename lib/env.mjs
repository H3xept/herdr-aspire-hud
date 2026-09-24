// Plugin directories, configuration, the herdr socket, and the aspire binary.
//
// Everything the plugin needs about its own installation arrives in the
// environment herdr injects. The fallbacks name the same directories herdr
// would, so `bin/aspire-hud` run from a plain shell and the same verb run from
// a keybinding agree about the daemon's pid file.
import { accessSync, constants, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export const PLUGIN_ID = process.env.HERDR_PLUGIN_ID || 'h3xept.aspire-hud';

const HERDR_HOME = join(homedir(), '.config', 'herdr');

export function configDir() {
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR || join(HERDR_HOME, 'plugins', 'config', PLUGIN_ID);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function stateDir() {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR
    || join(homedir(), '.local', 'state', 'herdr', 'plugins', PLUGIN_ID);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function socketPath() {
  return process.env.HERDR_SOCKET_PATH || join(HERDR_HOME, 'herdr.sock');
}

export const herdrBin = () => process.env.HERDR_BIN_PATH || 'herdr';

export function pluginContext() {
  try { return JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || '{}'); } catch { return {}; }
}

const DEFAULTS = {
  // How long an aspire answer (`aspire ps`, `aspire describe`) is reused. The
  // daemon and the HUD refresh on this period; the refresh command skips it.
  // Each describe is a ~0.3s native process per AppHost.
  ASPIRE_HUD_CACHE_TTL: '20s',
  // Explicit path to the aspire CLI; empty means PATH, then ~/.aspire/bin.
  ASPIRE_BIN: '',
};

// config.env is KEY=value, one per line, # comments. Environment variables of
// the same name win, so a one-off run can override a setting.
export function config() {
  const out = { ...DEFAULTS };
  let text = '';
  try { text = readFileSync(join(configDir(), 'config.env'), 'utf8'); } catch { /* no file */ }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  for (const key of Object.keys(DEFAULTS)) {
    if (process.env[key]) out[key] = process.env[key];
  }
  return out;
}

/** "90", "90s", "45m", "6h" -> milliseconds. Junk input falls back. */
export function durationMs(text, fallbackMs) {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(String(text ?? '').trim());
  if (!m) return fallbackMs;
  const scale = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[m[2] ?? 's'];
  return Math.round(Number(m[1]) * scale);
}

function executable(path) {
  try { accessSync(path, constants.X_OK); return true; } catch { return false; }
}

/**
 * The aspire CLI. Herdr starts plugin commands from its server's environment,
 * which is often not a login shell, so ~/.aspire/bin (where the installer
 * puts it) may be missing from PATH.
 */
export function aspireBin(cfg = config()) {
  if (cfg.ASPIRE_BIN) return cfg.ASPIRE_BIN;
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (dir && executable(join(dir, 'aspire'))) return join(dir, 'aspire');
  }
  const installed = join(homedir(), '.aspire', 'bin', 'aspire');
  return executable(installed) ? installed : 'aspire';
}
