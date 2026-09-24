// Pure rules: how a resource's state becomes a level, how AppHosts map onto
// herdr spaces, and which sidebar tokens a space gets. No I/O here, so the
// rules are testable against recorded `aspire describe` output.
import { sep } from 'node:path';

/** Metadata tokens this plugin owns. One per level, because herdr colors a token per name. */
export const TOKENS = ['aspire_ok', 'aspire_warn', 'aspire_down'];

// Parameters and connection strings are configuration, not processes: they
// report "Running" forever and would pad every count.
const CONFIG_TYPES = new Set(['Parameter', 'ConnectionString']);

export const LEVEL_ORDER = { down: 0, warn: 1, ok: 2, idle: 3 };

/** Resources that describe something that runs. */
export function isProcess(resource) {
  return !CONFIG_TYPES.has(resource.resourceType);
}

/**
 * ok   running and not reported unhealthy, or finished with exit code 0
 *      (a migrator that ran and exited is the resource working as designed)
 * warn on its way up or down, or running but reported unhealthy/degraded
 * down failed to start, exited nonzero or without a code, or the container
 *      runtime itself is unhealthy
 * idle never started: explicit-start resources waiting for a human
 * @returns {'ok'|'warn'|'down'|'idle'}
 */
export function classify(resource) {
  switch (resource.state) {
    case 'NotStarted':
      return 'idle';
    case 'FailedToStart':
    case 'RuntimeUnhealthy':
      return 'down';
    case 'Exited':
    case 'Finished':
      return resource.exitCode === 0 ? 'ok' : 'down';
    case 'Running': {
      const health = resource.healthStatus;
      return health == null || health === 'Healthy' ? 'ok' : 'warn';
    }
    default:
      // Starting, Waiting, Building, Stopping, Unknown, and any state a newer
      // Aspire adds: not settled, so not ok.
      return 'warn';
  }
}

/** Count process resources by level. `total` leaves idle resources out. */
export function summarize(resources) {
  const counts = { ok: 0, warn: 0, down: 0, idle: 0 };
  for (const resource of resources) {
    if (isProcess(resource)) counts[classify(resource)] += 1;
  }
  return { ...counts, total: counts.ok + counts.warn + counts.down };
}

/**
 * The level of an AppHost from its describe result.
 * @param {{resources?: object[], error?: string} | undefined} detail
 * @returns {'ok'|'warn'|'down'|'unknown'}
 */
export function levelOf(detail) {
  if (!detail || detail.error || !detail.resources) return 'unknown';
  const s = summarize(detail.resources);
  if (s.down > 0) return 'down';
  if (s.warn > 0) return 'warn';
  return 'ok';
}

/** "◆ 6/8", or "◆ ?" while an AppHost has not answered a describe. */
export function badgeText(details) {
  let ok = 0;
  let total = 0;
  let known = false;
  for (const detail of details) {
    if (!detail?.resources) continue;
    known = true;
    const s = summarize(detail.resources);
    ok += s.ok;
    total += s.total;
  }
  return known ? `◆ ${ok}/${total}` : '◆ ?';
}

/**
 * The full token set for one space: exactly one token carries text, the
 * others are null so a level change clears the previous color.
 * @param {object[]} details describe results of every AppHost in the space
 */
export function tokensFor(details) {
  const levels = details.map(levelOf);
  let token = 'aspire_ok';
  if (levels.includes('down')) token = 'aspire_down';
  else if (levels.includes('warn') || levels.includes('unknown')) token = 'aspire_warn';
  const tokens = Object.fromEntries(TOKENS.map((name) => [name, null]));
  tokens[token] = badgeText(details);
  return tokens;
}

/** Every token of this plugin, cleared. */
export function clearedTokens() {
  return Object.fromEntries(TOKENS.map((name) => [name, null]));
}

/**
 * Map each AppHost to the spaces whose worktree contains it. When worktrees
 * nest (a checkout inside another checkout), the deepest one wins. Several
 * spaces on the same checkout all get the AppHost.
 *
 * @param {{appHostPath: string}[]} apphosts
 * @param {{workspace_id: string, worktree?: {checkout_path?: string}}[]} spaces
 * @returns {Map<string, string[]>} appHostPath -> workspace ids, sidebar order
 */
export function mapToSpaces(apphosts, spaces) {
  const out = new Map();
  for (const apphost of apphosts) {
    let best = -1;
    let ids = [];
    for (const space of spaces) {
      const root = space.worktree?.checkout_path;
      if (!root) continue;
      const prefix = root.endsWith(sep) ? root : root + sep;
      if (!apphost.appHostPath.startsWith(prefix)) continue;
      if (root.length > best) { best = root.length; ids = [space.workspace_id]; }
      else if (root.length === best) ids.push(space.workspace_id);
    }
    out.set(apphost.appHostPath, ids);
  }
  return out;
}

/** 45s, 12m, 3h12m, 2d4h. */
export function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d${h % 24}h` : `${d}d`;
}

/** When the AppHost came up: its earliest resource creation. */
export function startedAt(detail) {
  let earliest = null;
  for (const resource of detail?.resources ?? []) {
    const t = Date.parse(resource.creationTimestamp ?? '');
    if (Number.isFinite(t) && (earliest === null || t < earliest)) earliest = t;
  }
  return earliest;
}

/** Process resources, worst first, then by name. */
export function sortResources(resources) {
  return resources
    .filter(isProcess)
    .map((resource) => ({ resource, level: classify(resource) }))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]
      || String(a.resource.displayName ?? a.resource.name).localeCompare(String(b.resource.displayName ?? b.resource.name)));
}

/** Dashboard origin without the login token, for display. */
export function dashboardOrigin(url) {
  try { return new URL(url).origin; } catch { return url ?? ''; }
}
