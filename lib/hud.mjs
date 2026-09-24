// The HUD popup: every running AppHost on top, the selected one expanded to
// its resources below.
//
// Data comes from the shared aspire cache, so the popup opens at once when
// the daemon polled recently, and refreshes itself when the cache expires.
// `r` skips the cache. It opens on the AppHost of the space it was invoked from.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { stopAppHosts } from './aspire.mjs';
import { cacheTtlMs, forgetAppHosts, poll } from './collect.mjs';
import { nudge } from './daemon.mjs';
import { pluginContext } from './env.mjs';
import {
  dashboardOrigin, formatDuration, levelOf, sortResources, startedAt, summarize,
} from './model.mjs';
import { call } from './socket.mjs';

// The HUD ticks every second: that redraws the data's age, re-reads herdr
// spaces, and picks up whatever the daemon or another HUD wrote to the cache.
// Aspire itself is only asked once the cache is older than its TTL.
const TICK_MS = 1_000;

const ESC = '\x1b';
const sgr = (...codes) => `${ESC}[${codes.join(';')}m`;
const RESET = sgr(0);
const BOLD = sgr(1);
const DIM = sgr(2);
const RED = sgr(31);
const GREEN = sgr(32);
const YELLOW = sgr(33);
const CYAN = sgr(36);

const LEVEL_STYLE = {
  ok: { glyph: '●', color: GREEN },
  warn: { glyph: '◐', color: YELLOW },
  down: { glyph: '✕', color: RED },
  idle: { glyph: '○', color: DIM },
  unknown: { glyph: '?', color: YELLOW },
};

const width = (text) => [...String(text)].length;

function fit(text, cols) {
  const s = String(text ?? '');
  if (cols <= 0) return '';
  const chars = [...s];
  if (chars.length > cols) return `${chars.slice(0, Math.max(0, cols - 1)).join('')}…`;
  return s + ' '.repeat(cols - chars.length);
}

// Joins as many parts as fit in `cols`, always keeping the last one. Used for
// lines that must stay readable in a narrow popup instead of ending in "…".
function fitParts(parts, cols, sep = ' · ') {
  const tail = parts[parts.length - 1];
  const kept = [];
  let used = width(tail);
  for (const part of parts.slice(0, -1)) {
    if (used + width(part) + width(sep) > cols) break;
    kept.push(part);
    used += width(part) + width(sep);
  }
  return [...kept, tail].join(sep);
}

// "stop com1743? y/n", or "stop 13 AppHosts: com1743, com-1771, +11 more? y/n"
// with as many names as fit. The "? y/n" is never cut off.
export function confirmText(names, cols) {
  if (names.length === 1) return `stop ${fit(names[0], cols - 10).trimEnd()}? y/n`;
  const head = `stop ${names.length} AppHosts`;
  const text = (n) => {
    if (n === 0) return `${head}? y/n`;
    const rest = names.length - n;
    return `${head}: ${[...names.slice(0, n), ...(rest ? [`+${rest} more`] : [])].join(', ')}? y/n`;
  };
  let shown = 0;
  while (shown < names.length && width(text(shown + 1)) <= cols) shown += 1;
  return text(shown);
}

const tilde = (path) => (path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path);

function stateText(resource) {
  if ((resource.state === 'Exited' || resource.state === 'Finished') && resource.exitCode != null) {
    return `${resource.state} (${resource.exitCode})`;
  }
  return resource.state ?? 'Unknown';
}

function openUrl(url) {
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch { return false; }
}

// The popup's own process gets no HERDR_PANE_ID; the space it was opened from
// arrives in the plugin context. Its exact shape has varied, so accept both.
function invokingSpace() {
  const ctx = pluginContext();
  return ctx.workspace_id ?? ctx.workspace?.workspace_id ?? process.env.HERDR_WORKSPACE_ID ?? null;
}

export async function runHud() {
  const out = process.stdout;
  const ttlMs = cacheTtlMs();
  const home = invokingSpace();

  /** @type {{at: number, spaces: object[], apphosts: object[]} | null} */
  let snap = null;
  let rows = []; // apphost views in display order
  let selected = null; // appHostPath
  let listTop = 0;
  let resourceTop = 0;
  let pollError = '';
  let status = '';
  let polling = false;
  let timer = null;
  const marked = new Set(); // appHostPaths picked with space for a batch stop
  const stopping = new Set(); // appHostPaths with a stop in flight
  /** @type {{targets: object[]} | null} a stop waiting for y/n */
  let confirm = null;
  let canScroll = false; // the selected AppHost has more resources than rows

  const spaceById = () => new Map((snap?.spaces ?? []).map((s, i) => [s.workspace_id, { ...s, index: i }]));

  function order(apphosts) {
    const spaces = spaceById();
    const rank = (a) => (a.spaces.length ? Math.min(...a.spaces.map((id) => spaces.get(id)?.index ?? 1e9)) : 1e9);
    return [...apphosts].sort((a, b) => rank(a) - rank(b) || a.appHostPath.localeCompare(b.appHostPath));
  }

  function pickInitial() {
    const focused = snap.spaces.find((s) => s.focused)?.workspace_id;
    for (const id of [home, focused]) {
      const hit = id && rows.find((a) => a.spaces.includes(id));
      if (hit) return hit.appHostPath;
    }
    return rows[0]?.appHostPath ?? null;
  }

  // An AppHost outside every space still lives in some checkout; its nearest
  // ancestor holding `.git` (a directory, or a file in a linked worktree)
  // names it better than a bare "(no space)".
  const roots = new Map();
  function checkoutOf(apphost) {
    const fromSpace = spaceById().get(apphost.spaces[0])?.worktree?.checkout_path;
    if (fromSpace) return fromSpace;
    if (!roots.has(apphost.appHostPath)) {
      let dir = dirname(apphost.appHostPath);
      while (dir !== dirname(dir) && !existsSync(join(dir, '.git'))) dir = dirname(dir);
      roots.set(apphost.appHostPath, dir === dirname(dir) ? null : dir);
    }
    return roots.get(apphost.appHostPath);
  }

  function label(apphost) {
    const spaces = spaceById();
    const names = apphost.spaces.map((id) => spaces.get(id)?.label ?? id);
    if (names.length) return names.join(', ');
    const root = checkoutOf(apphost);
    return root ? `${basename(root)} (no space)` : '(no space)';
  }

  function relativePath(apphost) {
    const root = checkoutOf(apphost);
    return root ? apphost.appHostPath.slice(root.length + 1) : tilde(apphost.appHostPath);
  }

  async function refresh({ fresh = false } = {}) {
    if (polling) return;
    polling = true;
    try {
      snap = await poll({ ttlMs, fresh });
      const prevAt = rows.findIndex((a) => a.appHostPath === selected);
      rows = order(snap.apphosts);
      const live = new Set(rows.map((a) => a.appHostPath));
      for (const path of marked) if (!live.has(path)) marked.delete(path);
      if (!selected || !live.has(selected)) {
        const first = !selected;
        // A stopped AppHost leaves the list; its neighbour takes the cursor,
        // so stopping several in a row does not jump back to the top.
        selected = !first && prevAt >= 0 && rows.length
          ? rows[Math.min(prevAt, rows.length - 1)].appHostPath
          : pickInitial();
        resourceTop = 0;
      }
      pollError = '';
    } catch (err) {
      pollError = String(err.message ?? err);
    } finally {
      polling = false;
    }
    render();
  }

  async function forceRefresh() {
    if (polling) { status = `${DIM}already refreshing…${RESET}`; return; }
    status = `${DIM}refreshing…${RESET}`;
    render();
    await refresh({ fresh: true });
    if (!pollError) status = `${GREEN}refreshed${RESET}`;
    nudge();
    render();
  }

  function render() {
    const cols = Math.max(60, out.columns || 100);
    const height = Math.max(16, out.rows || 30);
    const inner = cols - 2;
    canScroll = false;
    const rule = ` ${DIM}${'─'.repeat(inner)}${RESET}`;
    const lines = [];

    // --- header -------------------------------------------------------------
    // herdr's popup border already carries the name, so this line is status:
    // counts by level on the left, the time of the last poll on the right.
    const levels = rows.map((a) => levelOf(a.detail));
    const count = (l) => levels.filter((x) => x === l).length;
    const summary = [
      [`${rows.length} AppHost${rows.length === 1 ? '' : 's'}`, BOLD],
      ...['ok', 'warn', 'down'].filter((l) => count(l)).map((l) => {
        const { glyph, color } = LEVEL_STYLE[l];
        return [`${glyph} ${count(l)} ${{ ok: 'healthy', warn: 'degraded', down: 'down' }[l]}`, color];
      }),
    ];
    const left = summary.map(([text, tone]) => `${tone}${text}${RESET}`).join('   ');
    const leftPlain = summary.map(([text]) => text).join('   ');
    // Whole seconds, so "updated 9s ago · next in 11s" always adds up to the TTL.
    const age = snap ? Math.max(0, Math.floor((Date.now() - snap.at) / 1000) * 1000) : 0;
    const right = !snap ? 'loading…'
      : polling ? 'refreshing…'
        : `updated ${formatDuration(age)} ago · next in ${formatDuration(Math.max(0, ttlMs - age))}`;
    lines.push(` ${left}${' '.repeat(Math.max(1, inner - width(leftPlain) - width(right)))}${DIM}${right}${RESET}`);
    lines.push(rule);

    if (!snap) {
      lines.push(pollError ? ` ${RED}${fit(pollError, inner)}${RESET}` : ` ${DIM}asking aspire…${RESET}`);
      out.write(`${ESC}[H${ESC}[2J${lines.join('\r\n')}`);
      return;
    }

    // --- apphost list -------------------------------------------------------
    const footerRows = status || confirm ? 3 : 2;
    const listRows = Math.max(1, Math.min(rows.length, Math.floor((height - 10) / 3)));
    const at = rows.findIndex((a) => a.appHostPath === selected);
    if (at < listTop) listTop = at;
    if (at >= listTop + listRows) listTop = at - listRows + 1;
    listTop = Math.max(0, Math.min(listTop, rows.length - listRows));

    if (rows.length === 0) lines.push(` ${DIM}no running AppHosts — start one with \`aspire start\`${RESET}`);
    for (let i = 0; i < listRows && rows.length; i += 1) {
      const apphost = rows[listTop + i];
      if (!apphost) { lines.push(''); continue; }
      const level = levelOf(apphost.detail);
      const style = LEVEL_STYLE[level];
      const s = apphost.detail?.resources ? summarize(apphost.detail.resources) : null;
      const badge = fit(s ? `${s.ok}/${s.total}` : '?', 6);
      const up = startedAt(apphost.detail);
      const meta = stopping.has(apphost.appHostPath)
        ? 'stopping…'
        : `pid ${apphost.appHostPid}${up ? ` · up ${formatDuration(Date.now() - up)}` : ''}`;
      const nameCols = Math.min(32, Math.max(12, Math.floor(inner * 0.3)));
      const pathCols = Math.max(0, inner - 4 - 7 - nameCols - 1 - width(meta) - 1);
      const cursor = apphost.appHostPath === selected;
      const name = fit(label(apphost), nameCols);
      const metaTone = stopping.has(apphost.appHostPath) ? YELLOW : DIM;
      const body = `${style.color}${style.glyph}${RESET} ${badge} ${cursor ? BOLD : ''}${name}${RESET} ${DIM}${fit(relativePath(apphost), pathCols)}${RESET} ${metaTone}${meta}${RESET}`;
      const mark = marked.has(apphost.appHostPath) ? `${YELLOW}✓${RESET}` : ' ';
      lines.push(` ${cursor ? `${CYAN}▸${RESET}` : ' '}${mark}${body}`);
    }
    lines.push(rule);

    // --- selected apphost ---------------------------------------------------
    const current = rows[at];
    if (current) {
      const root = checkoutOf(current);
      lines.push(` ${BOLD}${fit(label(current), Math.min(inner, width(label(current))))}${RESET}${DIM} · ${fit(tilde(root ?? current.appHostPath), Math.max(0, inner - width(label(current)) - 3))}${RESET}`);
      const detail = current.detail;
      const up = startedAt(detail);
      const facts = [
        `dashboard ${dashboardOrigin(current.dashboardUrl)}`,
        `sdk ${current.sdkVersion}`,
        up ? `up ${formatDuration(Date.now() - up)}` : '',
        detail ? `described ${formatDuration(Date.now() - detail.at)} ago` : '',
      ].filter(Boolean).join(' · ');
      lines.push(` ${DIM}${fit(facts, inner)}${RESET}`);
      if (detail?.error) lines.push(` ${RED}${fit(detail.error, inner)}${RESET}`);

      const resources = sortResources(detail?.resources ?? []);
      const nameW = Math.min(28, Math.max(8, ...resources.map((r) => width(r.resource.displayName ?? r.resource.name)))) + 1;
      const typeW = 11;
      const stateW = 14;
      const healthW = 10;
      const urlW = Math.max(0, inner - 2 - nameW - typeW - stateW - healthW);
      lines.push(` ${DIM}  ${fit('RESOURCE', nameW)}${fit('TYPE', typeW)}${fit('STATE', stateW)}${fit('HEALTH', healthW)}${fit('ENDPOINTS', urlW)}${RESET}`);

      const resourceRows = Math.max(1, height - lines.length - footerRows - 1);
      resourceTop = Math.max(0, Math.min(resourceTop, Math.max(0, resources.length - resourceRows)));
      for (let i = 0; i < resourceRows; i += 1) {
        const entry = resources[resourceTop + i];
        if (!entry) { lines.push(''); continue; }
        const { resource, level } = entry;
        const style = LEVEL_STYLE[level];
        const tone = level === 'idle' ? DIM : '';
        const urls = resource.urls.map((u) => u.url).join(' ');
        const health = resource.state === 'Running' ? (resource.healthStatus ?? '—') : '';
        const healthTone = health && health !== 'Healthy' && health !== '—' ? YELLOW : DIM;
        lines.push(` ${style.color}${style.glyph}${RESET} ${tone}${fit(resource.displayName ?? resource.name, nameW)}${RESET}`
          + `${DIM}${fit(String(resource.resourceType ?? '').toLowerCase(), typeW)}${RESET}`
          + `${level === 'down' ? RED : tone}${fit(stateText(resource), stateW)}${RESET}`
          + `${healthTone}${fit(health, healthW)}${RESET}`
          + `${CYAN}${fit(urls, urlW)}${RESET}`);
      }
      const hiddenBelow = resources.length - resourceTop - resourceRows;
      canScroll = resourceTop > 0 || hiddenBelow > 0;
      if (canScroll) {
        lines[lines.length - 1] = ` ${DIM}${fit(`  … ${resourceTop} above · ${Math.max(0, hiddenBelow)} below (J/K scroll)`, inner)}${RESET}`;
      }
    }

    // --- footer -------------------------------------------------------------
    lines.push(rule);
    lines.push(` ${DIM}${fit(fitParts([
      'j/k move',
      ...(canScroll ? ['J/K scroll'] : []),
      'space mark',
      `x stop ${marked.size ? `${marked.size} marked` : 'selected'}`,
      'X stop all',
      'enter go to space',
      'o dashboard',
      'r refresh',
      'q quit',
    ], inner), inner)}${RESET}`);
    if (confirm) {
      lines.push(` ${BOLD}${YELLOW}${fit(confirmText(confirm.targets.map(label), inner), inner)}${RESET}`);
    } else if (pollError) lines.push(` ${RED}${fit(pollError, inner)}${RESET}`);
    else if (status) lines.push(` ${fit(status, inner)}`);

    out.write(`${ESC}[H${ESC}[2J${lines.slice(0, height).join('\r\n')}`);
  }

  out.write(`${ESC}[?25l`);
  render();
  await refresh();
  timer = setInterval(() => { refresh(); }, TICK_MS);
  out.on('resize', render);

  const stdin = process.stdin;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return await new Promise((resolve) => {
    const quit = (code) => {
      clearInterval(timer);
      stdin.removeListener('data', onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      out.write(`${ESC}[?25h${ESC}[0m\r\n`);
      resolve(code);
    };

    const move = (delta) => {
      const at = rows.findIndex((a) => a.appHostPath === selected);
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + delta))];
      if (next && next.appHostPath !== selected) {
        selected = next.appHostPath;
        resourceTop = 0;
        status = '';
        render();
      }
    };

    async function runStop(targets) {
      for (const a of targets) { stopping.add(a.appHostPath); marked.delete(a.appHostPath); }
      status = `${YELLOW}stopping ${targets.length} AppHost${targets.length === 1 ? '' : 's'}…${RESET}`;
      render();
      const done = { stopped: 0, killed: 0 };
      const failed = [];
      const gone = [];
      await stopAppHosts(targets, {
        onResult: (a, result) => {
          stopping.delete(a.appHostPath);
          if (result.how === 'failed') failed.push(`${label(a)}: ${result.error}`);
          else { done[result.how] += 1; gone.push(a.appHostPath); }
          render();
        },
      });
      const parts = [];
      if (done.stopped) parts.push(`${GREEN}stopped ${done.stopped}${RESET}`);
      // Killed means `aspire stop` failed and signals finished the job; say so,
      // because containers of a killed AppHost may outlive it.
      if (done.killed) parts.push(`${YELLOW}killed ${done.killed} after aspire stop failed${RESET}`);
      if (failed.length) parts.push(`${RED}could not stop ${failed.join('; ')}${RESET}`);
      status = parts.join(`${DIM} · ${RESET}`);
      forgetAppHosts(gone);
      nudge();
      await refresh();
    }

    function askStop(targets) {
      const pending = targets.filter((a) => !stopping.has(a.appHostPath));
      if (pending.length === 0) { status = `${YELLOW}nothing to stop${RESET}`; return; }
      confirm = { targets: pending };
    }

    async function onData(chunk) {
      const current = rows.find((a) => a.appHostPath === selected);
      if (confirm) {
        const { targets } = confirm;
        confirm = null;
        if (chunk === 'y' || chunk === 'Y') {
          runStop(targets).catch((err) => { status = `${RED}${err.message}${RESET}`; render(); });
        } else status = `${DIM}stop cancelled${RESET}`;
        render();
        return undefined;
      }
      switch (chunk) {
        case 'q': case ESC: case '\x03':
          // Closing the popup kills its children, and with them any
          // `aspire stop` halfway through tearing an AppHost down.
          if (stopping.size) { status = `${YELLOW}wait: ${stopping.size} stop${stopping.size === 1 ? '' : 's'} in flight${RESET}`; break; }
          return quit(0);
        case ' ':
          if (!current) break;
          if (marked.has(current.appHostPath)) marked.delete(current.appHostPath);
          else marked.add(current.appHostPath);
          move(1);
          break;
        case 'x':
          askStop(marked.size ? rows.filter((a) => marked.has(a.appHostPath)) : [current].filter(Boolean));
          break;
        case 'X':
          askStop(rows);
          break;
        case 'j': case `${ESC}[B`: move(1); break;
        case 'k': case `${ESC}[A`: move(-1); break;
        case 'g': move(-rows.length); break;
        case 'G': move(rows.length); break;
        case 'J': case `${ESC}[6~`: case 'K': case `${ESC}[5~`:
          if (!canScroll) { status = `${DIM}every resource fits; nothing to scroll${RESET}`; break; }
          resourceTop = chunk === 'J' || chunk === `${ESC}[6~` ? resourceTop + 1 : Math.max(0, resourceTop - 1);
          break;
        case 'r': forceRefresh(); break;
        case 'o': {
          if (!current?.dashboardUrl) { status = `${YELLOW}no dashboard URL for this AppHost${RESET}`; break; }
          status = openUrl(current.dashboardUrl)
            ? `${GREEN}opened ${dashboardOrigin(current.dashboardUrl)}${RESET}`
            : `${RED}could not open the dashboard${RESET}`;
          break;
        }
        case '\r': case '\n': {
          if (!current?.spaces.length) { status = `${YELLOW}this AppHost is not inside any herdr space${RESET}`; break; }
          try { await call('workspace.focus', { workspace_id: current.spaces[0] }); }
          catch { /* the space went away; closing is still the right move */ }
          return quit(0);
        }
        default: return undefined;
      }
      render();
      return undefined;
    }

    stdin.on('data', onData);
  });
}

