// Raw herdr socket client.
//
// The daemon rewrites every badge on each poll, so it talks to the socket
// instead of spawning `herdr` once per token write. The server answers exactly
// one request per connection and then closes it, so requests fan out over
// separate connections.
import net from 'node:net';
import { socketPath } from './env.mjs';

const CONCURRENCY = 32;
let seq = 0;

function one(request, timeoutMs) {
  const id = `aspire-hud:${process.pid}:${seq++}`;
  const payload = `${JSON.stringify({ id, method: request.method, params: request.params ?? {} })}\n`;

  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath());
    let buffer = '';
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      fn(value);
    };

    sock.setTimeout(timeoutMs, () => finish(reject, new Error(`${request.method}: timed out`)));
    sock.on('error', (err) => finish(reject, err));
    sock.on('connect', () => sock.write(payload));
    sock.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      try { finish(resolve, JSON.parse(buffer.slice(0, nl))); }
      catch { finish(reject, new Error(`${request.method}: unparseable response`)); }
    });
    sock.on('close', () => finish(reject, new Error(`${request.method}: closed without a response`)));
  });
}

/**
 * Send every request; resolve with the response envelopes in order.
 * Envelopes may be success or error; callers decide what is fatal.
 * @param {{method: string, params?: object}[]} requests
 * @returns {Promise<object[]>}
 */
export async function send(requests, { timeoutMs = 5_000 } = {}) {
  const out = new Array(requests.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, requests.length) }, async () => {
    for (let i = next++; i < requests.length; i = next++) {
      try { out[i] = await one(requests[i], timeoutMs); }
      catch (err) { out[i] = { error: { code: 'transport', message: String(err.message ?? err) } }; }
    }
  });
  await Promise.all(workers);
  return out;
}

/** Send one request and return its `result`, throwing on an error response. */
export async function call(method, params, opts) {
  const [envelope] = await send([{ method, params }], opts);
  if (envelope?.error) throw new Error(`${envelope.error.code}: ${envelope.error.message}`);
  return envelope?.result;
}

/** Every herdr space, in sidebar order. */
export async function listSpaces() {
  const result = await call('workspace.list', {});
  return result?.workspaces ?? [];
}
