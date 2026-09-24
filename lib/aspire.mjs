// The Aspire CLI, as data.
//
// `aspire ps --follow` looks like the obvious feed, but on 13.5 it emits one
// AppHost object per line with no removal marker, so it cannot say when an
// AppHost goes away. `aspire describe --follow` costs a ~64 MB process per
// AppHost for as long as it runs. One-shot calls on a timer are cheaper and
// always tell the whole truth.
import { execFile } from 'node:child_process';
import { aspireBin } from './env.mjs';

function run(args, timeoutMs, { json = true } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      aspireBin(),
      [...args, ...(json ? ['--format', 'Json'] : []), '--nologo', '--non-interactive'],
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || stdout || '').trim().split('\n').pop();
          reject(new Error(err.killed ? `aspire ${args[0]}: timed out` : `aspire ${args[0]}: ${detail || err.message}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

// The CLI may print a notice before the document, so parse from the first
// bracket rather than trusting stdout to be pure JSON.
function parseJson(text, what) {
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error(`${what}: no JSON in output`);
  return JSON.parse(text.slice(start));
}

/**
 * Running AppHosts.
 * @returns {Promise<{appHostPath: string, appHostPid: number, cliPid: number,
 *   status: string, sdkVersion: string, dashboardUrl: string}[]>}
 */
export async function listAppHosts() {
  const list = parseJson(await run(['ps'], 15_000), 'aspire ps');
  return Array.isArray(list) ? list.filter((a) => a?.appHostPath) : [];
}

// Only what the badge and the HUD read. The full document carries every
// environment variable of every resource, which is noise in state files.
function slim(resource) {
  return {
    name: resource.name,
    displayName: resource.displayName,
    resourceType: resource.resourceType,
    state: resource.state,
    healthStatus: resource.healthStatus ?? null,
    exitCode: resource.exitCode ?? null,
    creationTimestamp: resource.creationTimestamp ?? null,
    startTimestamp: resource.startTimestamp ?? null,
    urls: (resource.urls ?? []).map((u) => ({ name: u.name, url: u.url })),
  };
}

/**
 * The resources of one AppHost. Never throws: an AppHost that does not answer
 * is reported through `error`, because a hung AppHost is exactly the kind of
 * state the HUD exists to show.
 * @returns {Promise<{at: number, pid: number, resources?: object[], error?: string}>}
 */
export async function describe(apphost, { timeoutMs = 10_000 } = {}) {
  const at = Date.now();
  try {
    const doc = parseJson(await run(['describe', '--apphost', apphost.appHostPath], timeoutMs), 'aspire describe');
    return { at, pid: apphost.appHostPid, resources: (doc.resources ?? []).map(slim) };
  } catch (err) {
    return { at, pid: apphost.appHostPid, error: String(err.message ?? err) };
  }
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stop one AppHost. `aspire stop` first: it shuts resources down in order and
 * removes session containers. When that fails or hangs (a wedged AppHost is a
 * common reason to want it gone), fall back to signals: SIGTERM to the AppHost
 * and the CLI process that launched it, SIGKILL for whatever is left after
 * `graceMs`. Never passes `--force`, which also deletes persistent volumes.
 *
 * @param {{appHostPath: string, appHostPid: number, cliPid?: number}} apphost
 * @returns {Promise<{how: 'stopped'|'killed'|'failed', error?: string}>}
 */
export async function stopAppHost(apphost, { timeoutMs = 60_000, graceMs = 5_000 } = {}) {
  let error;
  try {
    await run(['stop', '--apphost', apphost.appHostPath], timeoutMs, { json: false });
    return { how: 'stopped' };
  } catch (err) {
    error = String(err.message ?? err);
  }

  const pids = [apphost.appHostPid, apphost.cliPid].filter(alive);
  // The stop reported failure but the processes are gone: it worked.
  if (pids.length === 0) return { how: 'stopped' };

  for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* raced with its exit */ } }
  for (let waited = 0; waited < graceMs && pids.some(alive); waited += 100) await sleep(100);
  for (const pid of pids.filter(alive)) { try { process.kill(pid, 'SIGKILL'); } catch { /* raced */ } }
  await sleep(100);
  return pids.some(alive) ? { how: 'failed', error } : { how: 'killed', error };
}

/**
 * Stop several AppHosts, four at a time. `onResult` fires as each finishes, so
 * a UI can update rows before the slowest stop returns.
 * @returns {Promise<Map<string, {how: string, error?: string}>>} by appHostPath
 */
export async function stopAppHosts(apphosts, { onResult = () => {} } = {}) {
  const results = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, apphosts.length) }, async () => {
    for (let i = next++; i < apphosts.length; i = next++) {
      const result = await stopAppHost(apphosts[i]);
      results.set(apphosts[i].appHostPath, result);
      onResult(apphosts[i], result);
    }
  }));
  return results;
}
