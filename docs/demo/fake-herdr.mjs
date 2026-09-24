// A stand-in for the herdr server socket, for the demo recordings only.
//
//   node docs/demo/fake-herdr.mjs --socket <path> [--parent <pid>]
//
// It speaks the same wire format as herdr: one newline-terminated JSON request
// per connection, one newline-terminated JSON response, then close. It knows
// only the methods the plugin sends:
//
//   workspace.list             the spaces in ../demo/fixture.json
//   workspace.focus            moves `focused` to the named space
//   workspace.report_metadata  keeps the daemon's badge tokens on the space
//   notification.show          accepted and dropped
//
// With --parent it exits when that process does, so a demo shell that closes
// does not leave the socket behind.
//
// Demo scaffolding only: docs/ is not shipped, and nothing in lib/ or bin/
// refers to it.
import { readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixture.json'), 'utf8'));

function option(name) {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

const socketPath = option('--socket');
const parent = Number(option('--parent'));
if (!socketPath) {
  process.stderr.write('usage: fake-herdr.mjs --socket <path> [--parent <pid>]\n');
  process.exit(2);
}

const home = (path) => path.replace(/^~(?=\/)/, homedir());

const spaces = fixture.spaces.map((s, i) => ({
  workspace_id: s.id,
  number: i + 1,
  label: s.label,
  focused: Boolean(s.focused),
  pane_count: 1,
  tab_count: 1,
  active_tab_id: `${s.id}:t1`,
  agent_status: 'idle',
  tokens: {},
  worktree: {
    repo_key: s.repo,
    repo_name: s.repo,
    repo_root: home(fixture.spaces.find((o) => o.repo === s.repo && !o.linked)?.checkout ?? s.checkout),
    checkout_path: home(s.checkout),
    is_linked_worktree: Boolean(s.linked),
  },
}));

function answer(request) {
  const params = request.params ?? {};
  const space = spaces.find((s) => s.workspace_id === params.workspace_id);
  switch (request.method) {
    case 'workspace.list':
      return { type: 'workspace_list', workspaces: spaces };
    case 'workspace.focus':
      if (!space) break;
      for (const s of spaces) s.focused = s === space;
      return { type: 'ok' };
    case 'workspace.report_metadata':
      if (!space) break;
      for (const [name, text] of Object.entries(params.tokens ?? {})) {
        if (text == null) delete space.tokens[name];
        else space.tokens[name] = text;
      }
      return { type: 'ok' };
    case 'notification.show':
      return { type: 'ok' };
    default:
      return { error: { code: 'unknown_method', message: `demo herdr does not know ${request.method}` } };
  }
  return { error: { code: 'not_found', message: `no workspace ${params.workspace_id}` } };
}

const server = net.createServer((conn) => {
  let buffer = '';
  conn.setEncoding('utf8');
  conn.on('error', () => {});
  conn.on('data', (chunk) => {
    buffer += chunk;
    const nl = buffer.indexOf('\n');
    if (nl < 0) return;
    let request;
    try { request = JSON.parse(buffer.slice(0, nl)); } catch { conn.destroy(); return; }
    const result = answer(request);
    const envelope = result.error ? { id: request.id, error: result.error } : { id: request.id, result };
    conn.end(`${JSON.stringify(envelope)}\n`);
  });
});

const shutdown = () => {
  server.close();
  rmSync(socketPath, { force: true });
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (Number.isInteger(parent) && parent > 0) {
  setInterval(() => {
    try { process.kill(parent, 0); } catch { shutdown(); }
  }, 1_000).unref();
}

rmSync(socketPath, { force: true });
server.listen(socketPath);
