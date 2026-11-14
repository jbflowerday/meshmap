import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.ts';
import * as db from './db.ts';
import { counters, events } from './ingest.ts';
import { nameRequestStatus } from './nameRequests.ts';
import { hwName, nodeNumFromId, PORT_NAMES, ROLE_NAMES } from './proto/meshtastic.ts';

const linkMaxAge = () => config.linkMaxAgeHours * 3600;

export function serializeNode(r: db.NodeRow) {
  return {
    ...r,
    hw_model_name: hwName(r.hw_model as number | null),
    role_name: r.role === null || r.role === undefined ? null : ROLE_NAMES[r.role as number] ?? `ROLE_${r.role}`,
  };
}

const serializePacket = (p: Record<string, unknown>) => ({
  ...p,
  port: p.portnum === null ? 'ENCRYPTED' : PORT_NAMES[p.portnum as number] ?? `PORT_${p.portnum}`,
});

function send(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  let buf: Buffer = Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': config.corsOrigin,
    'cache-control': 'no-store',
  };
  if (buf.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    buf = gzipSync(buf);
    headers['content-encoding'] = 'gzip';
  }
  res.writeHead(status, headers).end(buf);
}

const parseNum = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) >>> 0 : nodeNumFromId(s));

type Handler = (url: URL, m: RegExpExecArray) => [number, unknown];
const routes: [RegExp, Handler][] = [
  [/^\/api\/health$/, () => [200, { ok: true, counters }]],
  [/^\/api\/stats$/, () => [200, {
    ...db.stats(linkMaxAge()),
    ingest: counters,
    nameRequests: { enabled: nameRequestStatus.enabled, nodeId: nameRequestStatus.nodeId, ...db.nameRequestStats() },
  }]],
  [/^\/api\/nodes$/, () => [200, db.listNodes().map(serializeNode)]],
  [/^\/api\/links$/, () => [200, db.listLinks(linkMaxAge())]],
  [/^\/api\/traceroutes$/, (u) => [200, db.listTraceroutes(Math.min(Number(u.searchParams.get('limit')) || 100, 500))]],
  [/^\/api\/packets$/, (u) => [200, db.recentPackets(Math.min(Number(u.searchParams.get('limit')) || 100, 500)).map((p) => serializePacket(p as Record<string, unknown>))]],
  [/^\/api\/nodes\/([^/]+)$/, (u, m) => {
    const num = parseNum(decodeURIComponent(m[1]));
    if (num === null) return [400, { error: 'bad node id' }];
    const node = db.getNode(num);
    if (!node) return [404, { error: 'not found' }];
    const hours = Math.min(Number(u.searchParams.get('hours')) || 24, 24 * 30);
    const since = db.nowSec() - hours * 3600;
    return [200, {
      node: serializeNode(node),
      name_request: nameRequestStatus.enabled ? db.getNameRequest(num) ?? null : null,
      links: db.linksForNode(num, linkMaxAge()),
      traceroutes: db.listTraceroutes(20, num),
      positions: db.positionsForNode(num, since),
      telemetry: db.telemetryForNode(num, since),
      packets: db.recentPackets(50, num).map((p) => serializePacket(p as Record<string, unknown>)),
    }];
  }],
];

export function startServer() {
  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': config.corsOrigin,
        'access-control-allow-methods': 'GET, OPTIONS',
      }).end();
      return;
    }
    if (req.method !== 'GET') return send(req, res, 405, { error: 'method not allowed' });
    const url = new URL(req.url ?? '/', 'http://x');
    for (const [re, h] of routes) {
      const m = re.exec(url.pathname);
      if (!m) continue;
      try {
        const [status, body] = h(url, m);
        return send(req, res, status, body);
      } catch (err) {
        console.error('[http]', err);
        return send(req, res, 500, { error: 'internal error' });
      }
    }
    send(req, res, 404, { error: 'not found' });
  });

  // ---------------------------------------------------------- live updates
  const wss = new WebSocketServer({ server, path: '/ws' });
  const pendingNodes = new Set<number>();
  const pendingLinks = new Map<string, unknown>();
  let pendingPackets: unknown[] = [];
  let pendingTraceroutes: unknown[] = [];

  events.on('node', (num: number) => pendingNodes.add(num));
  events.on('link', (l: Record<string, unknown> | undefined) => {
    if (l) pendingLinks.set(`${l.from_num}:${l.to_num}:${l.source}`, l);
  });
  events.on('packet', (p: unknown) => {
    pendingPackets.push(p);
    if (pendingPackets.length > 50) pendingPackets = pendingPackets.slice(-50);
  });
  events.on('traceroute', (t: unknown) => pendingTraceroutes.push(t));

  // Batch updates once per second so busy meshes don't flood clients.
  setInterval(() => {
    if (!pendingNodes.size && !pendingLinks.size && !pendingPackets.length && !pendingTraceroutes.length) return;
    const nodes = [...pendingNodes].map((n) => db.getNode(n)).filter((n): n is db.NodeRow => !!n).map(serializeNode);
    const msg = JSON.stringify({
      type: 'update', nodes, links: [...pendingLinks.values()], packets: pendingPackets, traceroutes: pendingTraceroutes,
    });
    pendingNodes.clear();
    pendingLinks.clear();
    pendingPackets = [];
    pendingTraceroutes = [];
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
  }, 1000).unref();

  // Keepalive so proxies don't drop idle sockets.
  setInterval(() => {
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.ping();
  }, 30_000).unref();

  server.listen(config.port, () => console.log(`[http] listening on :${config.port}`));
  return server;
}
