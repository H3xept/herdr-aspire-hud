// One poll: running AppHosts, herdr spaces, and a resource list per AppHost.
//
// Aspire answers come from the shared cache (state.mjs) while they are younger
// than the cache TTL, so the daemon and any open HUD together ask aspire at
// most once per TTL. `fresh` bypasses the cache; that is the refresh command.
// Herdr spaces are always read live: one socket call, and they change often.
import { describe, listAppHosts } from './aspire.mjs';
import { config, durationMs } from './env.mjs';
import { mapToSpaces } from './model.mjs';
import { listSpaces } from './socket.mjs';
import { readCache, writeCache } from './state.mjs';

const DESCRIBE_CONCURRENCY = 4;

/** How long an aspire answer stays good, and so the auto-refresh period. */
export function cacheTtlMs(cfg = config()) {
  return Math.max(2_000, durationMs(cfg.ASPIRE_HUD_CACHE_TTL, 20_000));
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) await fn(items[i]);
  }));
}

/**
 * @typedef {object} AppHostView
 * @property {string} appHostPath
 * @property {number} appHostPid
 * @property {number} cliPid the `aspire` process that launched the AppHost
 * @property {string} dashboardUrl
 * @property {string} sdkVersion
 * @property {string[]} spaces workspace ids whose worktree holds this AppHost
 * @property {{at: number, pid: number, resources?: object[], error?: string}} [detail]
 */

/**
 * @param {object} [opts]
 * @param {number} [opts.ttlMs] answers older than this are fetched again
 * @param {boolean} [opts.fresh] ignore the cache and ask aspire about everything
 * @param {boolean} [opts.mappedOnly] skip describes for AppHosts outside every space
 * @returns {Promise<{at: number, spaces: object[], apphosts: AppHostView[]}>}
 *   `at` is when the oldest answer shown was fetched.
 */
export async function poll({ ttlMs = cacheTtlMs(), fresh = false, mappedOnly = false } = {}) {
  const cache = readCache();
  const now = Date.now();
  const stale = (at) => fresh || !(now - at < ttlMs);

  const [ps, spaces] = await Promise.all([
    cache.ps && !stale(cache.ps.at)
      ? cache.ps
      : listAppHosts().then((apphosts) => ({ at: Date.now(), apphosts })),
    listSpaces(),
  ]);
  const { apphosts } = ps;
  const bySpace = mapToSpaces(apphosts, spaces);

  const fetched = {};
  const due = apphosts.filter((a) => {
    if (mappedOnly && bySpace.get(a.appHostPath).length === 0) return false;
    const cached = cache.details[a.appHostPath];
    return !cached || cached.pid !== a.appHostPid || stale(cached.at);
  });
  await pool(due, DESCRIBE_CONCURRENCY, async (a) => {
    fetched[a.appHostPath] = await describe(a);
  });

  const details = {};
  for (const a of apphosts) {
    const detail = fetched[a.appHostPath] ?? cache.details[a.appHostPath];
    if (detail) details[a.appHostPath] = detail;
  }
  if (ps !== cache.ps || due.length) writeCache({ ps, details });

  const shown = apphosts.map((a) => details[a.appHostPath]?.at).filter((at) => at != null);
  return {
    at: Math.min(ps.at, ...shown),
    spaces,
    apphosts: apphosts.map((a) => ({
      appHostPath: a.appHostPath,
      appHostPid: a.appHostPid,
      cliPid: a.cliPid,
      dashboardUrl: a.dashboardUrl,
      sdkVersion: a.sdkVersion,
      spaces: bySpace.get(a.appHostPath),
      detail: details[a.appHostPath],
    })),
  };
}

/** Drop stopped AppHosts from the cache, so no reader shows them for a TTL. */
export function forgetAppHosts(paths) {
  const gone = new Set(paths);
  const cache = readCache();
  if (cache.ps) cache.ps.apphosts = cache.ps.apphosts.filter((a) => !gone.has(a.appHostPath));
  for (const path of gone) delete cache.details[path];
  writeCache(cache);
}
