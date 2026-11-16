import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.ts';

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS nodes (
  num            INTEGER PRIMARY KEY,
  id             TEXT NOT NULL,
  long_name      TEXT,
  short_name     TEXT,
  hw_model       INTEGER,
  role           INTEGER,
  firmware       TEXT,
  is_licensed    INTEGER,
  has_public_key INTEGER,
  lat            REAL,
  lon            REAL,
  alt            INTEGER,
  precision_bits INTEGER,
  position_time  INTEGER,
  sats_in_view   INTEGER,
  battery        INTEGER,
  voltage        REAL,
  channel_util   REAL,
  air_util_tx    REAL,
  uptime         INTEGER,
  temperature    REAL,
  humidity       REAL,
  pressure       REAL,
  region         INTEGER,
  modem_preset   INTEGER,
  online_local_nodes INTEGER,
  hops_away      INTEGER,
  snr            REAL,
  rssi           INTEGER,
  last_gateway   INTEGER,
  via_mqtt       INTEGER,
  is_gateway     INTEGER DEFAULT 0,
  gateway_status TEXT,
  packet_count   INTEGER DEFAULT 0,
  first_seen     INTEGER NOT NULL,
  last_heard     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS nodes_last_heard ON nodes(last_heard);

-- Directed RF link: "to" heard "from" with snr (dB). source = neighbor | traceroute | direct
CREATE TABLE IF NOT EXISTS links (
  from_num  INTEGER NOT NULL,
  to_num    INTEGER NOT NULL,
  source    TEXT NOT NULL,
  snr       REAL,
  rssi      INTEGER,
  count     INTEGER NOT NULL DEFAULT 1,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (from_num, to_num, source)
);
CREATE INDEX IF NOT EXISTS links_last_seen ON links(last_seen);

CREATE TABLE IF NOT EXISTS positions (
  num  INTEGER NOT NULL,
  time INTEGER NOT NULL,
  lat  REAL NOT NULL,
  lon  REAL NOT NULL,
  alt  INTEGER
);
CREATE INDEX IF NOT EXISTS positions_num_time ON positions(num, time);

CREATE TABLE IF NOT EXISTS telemetry (
  num          INTEGER NOT NULL,
  time         INTEGER NOT NULL,
  battery      INTEGER,
  voltage      REAL,
  channel_util REAL,
  air_util_tx  REAL,
  temperature  REAL,
  humidity     REAL,
  pressure     REAL
);
CREATE INDEX IF NOT EXISTS telemetry_num_time ON telemetry(num, time);

CREATE TABLE IF NOT EXISTS traceroutes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  packet_id   INTEGER,
  from_num    INTEGER NOT NULL, -- requester
  to_num      INTEGER NOT NULL, -- target
  route       TEXT NOT NULL,    -- JSON: full forward path incl. endpoints
  snr_towards TEXT,
  route_back  TEXT,             -- JSON: full return path incl. endpoints (may be null)
  snr_back    TEXT,
  gateway     INTEGER,
  time        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS traceroutes_time ON traceroutes(time);
CREATE UNIQUE INDEX IF NOT EXISTS traceroutes_dedupe ON traceroutes(packet_id, from_num);

-- One row per gateway reception (the same packet may be heard by many gateways).
CREATE TABLE IF NOT EXISTS packets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  packet_id  INTEGER,
  from_num   INTEGER NOT NULL,
  to_num     INTEGER NOT NULL,
  portnum    INTEGER,
  channel_id TEXT,
  gateway    INTEGER,
  hop_start  INTEGER,
  hop_limit  INTEGER,
  relay_node INTEGER,
  snr        REAL,
  rssi       INTEGER,
  encrypted  INTEGER,
  time       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS packets_time ON packets(time);
CREATE INDEX IF NOT EXISTS packets_from ON packets(from_num, time);
`);

export const nowSec = () => Math.floor(Date.now() / 1000);

export type NodeRow = Record<string, number | string | null>;

const NODE_COLUMNS = new Set([
  'long_name', 'short_name', 'hw_model', 'role', 'firmware', 'is_licensed', 'has_public_key',
  'lat', 'lon', 'alt', 'precision_bits', 'position_time', 'sats_in_view',
  'battery', 'voltage', 'channel_util', 'air_util_tx', 'uptime', 'temperature', 'humidity', 'pressure',
  'region', 'modem_preset', 'online_local_nodes', 'hops_away', 'snr', 'rssi', 'last_gateway', 'via_mqtt',
  'is_gateway', 'gateway_status',
]);

const stmtCache = new Map<string, ReturnType<DatabaseSync['prepare']>>();
const prep = (sql: string) => {
  let s = stmtCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
};

const toSql = (v: unknown): number | string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return String(v);
};

/**
 * Inserts the node if unknown and applies the given column patch.
 * `heard` = true bumps last_heard and packet_count (an actual RF packet from this node).
 */
export function upsertNode(num: number, id: string, patch: Record<string, unknown>, heard = true) {
  const t = nowSec();
  prep(`INSERT INTO nodes (num, id, first_seen, last_heard, packet_count) VALUES (?, ?, ?, ?, 0)
        ON CONFLICT(num) DO NOTHING`).run(num, id, t, t);
  const cols = Object.keys(patch).filter((k) => NODE_COLUMNS.has(k) && patch[k] !== undefined);
  const sets = cols.map((c) => `${c} = ?`);
  if (heard) sets.push('last_heard = ?', 'packet_count = packet_count + 1');
  if (sets.length === 0) return;
  const values = cols.map((c) => toSql(patch[c]));
  if (heard) values.push(t);
  prep(`UPDATE nodes SET ${sets.join(', ')} WHERE num = ?`).run(...values, num);
}

export function getNode(num: number): NodeRow | undefined {
  return prep('SELECT * FROM nodes WHERE num = ?').get(num) as NodeRow | undefined;
}

export function listNodes(): NodeRow[] {
  return prep('SELECT * FROM nodes ORDER BY last_heard DESC').all() as NodeRow[];
}

export function upsertLink(fromNum: number, toNum: number, source: string, snr: number | null, rssi: number | null = null) {
  if (fromNum === toNum) return;
  const t = nowSec();
  prep(`INSERT INTO links (from_num, to_num, source, snr, rssi, count, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(from_num, to_num, source) DO UPDATE SET
          snr = COALESCE(excluded.snr, links.snr),
          rssi = COALESCE(excluded.rssi, links.rssi),
          count = links.count + 1,
          last_seen = excluded.last_seen`).run(fromNum, toNum, source, toSql(snr), toSql(rssi), t, t);
}

export function getLink(fromNum: number, toNum: number, source: string) {
  return prep('SELECT * FROM links WHERE from_num = ? AND to_num = ? AND source = ?').get(fromNum, toNum, source);
}

export function listLinks(maxAgeSec: number) {
  return prep('SELECT * FROM links WHERE last_seen >= ? ORDER BY last_seen DESC').all(nowSec() - maxAgeSec);
}

export function linksForNode(num: number, maxAgeSec: number) {
  return prep('SELECT * FROM links WHERE (from_num = ? OR to_num = ?) AND last_seen >= ? ORDER BY last_seen DESC')
    .all(num, num, nowSec() - maxAgeSec);
}

export function addPosition(num: number, lat: number, lon: number, alt: number | null) {
  const t = nowSec();
  // Skip duplicates of the most recent point to keep tracks compact.
  const last = prep('SELECT lat, lon FROM positions WHERE num = ? ORDER BY time DESC LIMIT 1').get(num) as
    | { lat: number; lon: number }
    | undefined;
  if (last && last.lat === lat && last.lon === lon) return;
  prep('INSERT INTO positions (num, time, lat, lon, alt) VALUES (?, ?, ?, ?, ?)').run(num, t, lat, lon, toSql(alt));
}

export function positionsForNode(num: number, sinceSec: number) {
  return prep('SELECT time, lat, lon, alt FROM positions WHERE num = ? AND time >= ? ORDER BY time ASC LIMIT 2000')
    .all(num, sinceSec);
}

export function addTelemetry(num: number, m: Record<string, number | undefined>) {
  prep(`INSERT INTO telemetry (num, time, battery, voltage, channel_util, air_util_tx, temperature, humidity, pressure)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    num, nowSec(), toSql(m.battery), toSql(m.voltage), toSql(m.channel_util), toSql(m.air_util_tx),
    toSql(m.temperature), toSql(m.humidity), toSql(m.pressure),
  );
}

export function telemetryForNode(num: number, sinceSec: number) {
  return prep(`SELECT time, battery, voltage, channel_util, air_util_tx, temperature, humidity, pressure
               FROM telemetry WHERE num = ? AND time >= ? ORDER BY time ASC LIMIT 2000`).all(num, sinceSec);
}

export function addTraceroute(tr: {
  packetId: number; from: number; to: number; route: number[]; snrTowards: (number | null)[];
  routeBack: number[] | null; snrBack: (number | null)[] | null; gateway: number | null;
}): boolean {
  const res = prep(`INSERT OR IGNORE INTO traceroutes (packet_id, from_num, to_num, route, snr_towards, route_back, snr_back, gateway, time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    tr.packetId, tr.from, tr.to, JSON.stringify(tr.route), JSON.stringify(tr.snrTowards),
    tr.routeBack ? JSON.stringify(tr.routeBack) : null, tr.snrBack ? JSON.stringify(tr.snrBack) : null,
    tr.gateway, nowSec(),
  );
  return Number(res.changes) > 0;
}

const parseTr = (r: Record<string, unknown>): Record<string, unknown> => ({
  ...r,
  route: JSON.parse(String(r.route)),
  snr_towards: r.snr_towards ? JSON.parse(String(r.snr_towards)) : [],
  route_back: r.route_back ? JSON.parse(String(r.route_back)) : null,
  snr_back: r.snr_back ? JSON.parse(String(r.snr_back)) : null,
});

export function listTraceroutes(limit: number, num?: number) {
  const rows = (num === undefined
    ? prep('SELECT * FROM traceroutes ORDER BY time DESC LIMIT ?').all(limit)
    : prep(`SELECT * FROM traceroutes WHERE from_num = ? OR to_num = ? OR route LIKE ? OR route_back LIKE ?
            ORDER BY time DESC LIMIT ?`).all(num, num, `%${num}%`, `%${num}%`, limit)) as Record<string, unknown>[];
  return rows.map(parseTr).filter((r) =>
    num === undefined || r.from_num === num || r.to_num === num ||
    (r.route as number[]).includes(num) || ((r.route_back as number[] | null) ?? []).includes(num));
}

export function addPacket(p: {
  packetId: number; from: number; to: number; portnum: number | null; channelId: string; gateway: number | null;
  hopStart: number; hopLimit: number; relayNode: number; snr: number; rssi: number; encrypted: boolean;
}) {
  prep(`INSERT INTO packets (packet_id, from_num, to_num, portnum, channel_id, gateway, hop_start, hop_limit, relay_node, snr, rssi, encrypted, time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    p.packetId, p.from, p.to, toSql(p.portnum), p.channelId, toSql(p.gateway), p.hopStart, p.hopLimit,
    p.relayNode, toSql(p.snr), toSql(p.rssi), p.encrypted ? 1 : 0, nowSec(),
  );
}

export function recentPackets(limit: number, num?: number) {
  return num === undefined
    ? prep('SELECT * FROM packets ORDER BY id DESC LIMIT ?').all(limit)
    : prep('SELECT * FROM packets WHERE from_num = ? OR gateway = ? ORDER BY id DESC LIMIT ?').all(num, num, limit);
}

export function stats(linkMaxAgeSec: number) {
  const t = nowSec();
  const one = (sql: string, ...a: number[]) => Number((prep(sql).get(...a) as { c: number }).c);
  return {
    nodes: one('SELECT COUNT(*) c FROM nodes'),
    nodesWithPosition: one('SELECT COUNT(*) c FROM nodes WHERE lat IS NOT NULL'),
    active1h: one('SELECT COUNT(*) c FROM nodes WHERE last_heard >= ?', t - 3600),
    active24h: one('SELECT COUNT(*) c FROM nodes WHERE last_heard >= ?', t - 86400),
    gateways: one('SELECT COUNT(*) c FROM nodes WHERE is_gateway = 1 AND last_heard >= ?', t - 86400),
    links: one('SELECT COUNT(*) c FROM links WHERE last_seen >= ?', t - linkMaxAgeSec),
    packets24h: one('SELECT COUNT(*) c FROM packets WHERE time >= ?', t - 86400),
    traceroutes: one('SELECT COUNT(*) c FROM traceroutes'),
  };
}

export function prune() {
  const t = nowSec();
  const hist = t - config.retentionDays * 86400;
  db.prepare('DELETE FROM positions WHERE time < ?').run(hist);
  db.prepare('DELETE FROM telemetry WHERE time < ?').run(hist);
  db.prepare('DELETE FROM packets WHERE time < ?').run(hist);
  db.prepare('DELETE FROM traceroutes WHERE time < ?').run(hist);
  db.prepare('DELETE FROM links WHERE last_seen < ?').run(t - config.linkMaxAgeHours * 3600);
  db.prepare('DELETE FROM nodes WHERE last_heard < ?').run(t - config.nodeMaxAgeDays * 86400);
  db.prepare('DELETE FROM name_requests WHERE num NOT IN (SELECT num FROM nodes)').run();
  db.prepare('DELETE FROM traceroute_requests WHERE num NOT IN (SELECT num FROM nodes)').run();
}

/** Marks a node as alive without counting a packet (e.g. a gateway uplinking others' traffic). */
export function touchNode(num: number, id: string, patch: Record<string, unknown> = {}) {
  upsertNode(num, id, patch, false);
  prep('UPDATE nodes SET last_heard = ? WHERE num = ?').run(nowSec(), num);
}

// ---------------------------------------------------------------- name requests

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS name_requests (
  num         INTEGER PRIMARY KEY,
  last_sent   INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  gateway     INTEGER,
  answered_at INTEGER
);
`);

export function getSetting(key: string): string | undefined {
  return (prep('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}
export function setSetting(key: string, value: string) {
  prep('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** Unnamed nodes worth asking for their name, most recently heard first. */
export function nameRequestCandidates(opts: { heardSince: number; firstSeenBefore: number; retryBefore: number; exclude: number }) {
  return prep(`
    SELECT n.num, n.last_gateway, n.hops_away FROM nodes n
    LEFT JOIN name_requests r ON r.num = n.num
    WHERE n.long_name IS NULL AND n.short_name IS NULL
      AND n.last_heard >= ? AND n.first_seen <= ? AND n.last_gateway IS NOT NULL
      AND n.num != ? AND n.num != n.last_gateway
      AND (r.last_sent IS NULL OR r.last_sent < ?)
    ORDER BY n.last_heard DESC LIMIT 50`)
    .all(opts.heardSince, opts.firstSeenBefore, opts.exclude, opts.retryBefore) as { num: number; last_gateway: number; hops_away: number | null }[];
}

export function recordNameRequest(num: number, gateway: number) {
  prep(`INSERT INTO name_requests (num, last_sent, attempts, gateway) VALUES (?, ?, 1, ?)
        ON CONFLICT(num) DO UPDATE SET last_sent = excluded.last_sent, attempts = name_requests.attempts + 1,
          gateway = excluded.gateway, answered_at = NULL`).run(num, nowSec(), gateway);
}

/** Marks outstanding requests answered once the node has a name. Returns how many. */
export function markNameRequestsAnswered(): number {
  const r = prep(`UPDATE name_requests SET answered_at = ? WHERE answered_at IS NULL AND num IN
        (SELECT num FROM nodes WHERE long_name IS NOT NULL OR short_name IS NOT NULL)`).run(nowSec());
  return Number(r.changes);
}

export function getNameRequest(num: number) {
  return prep('SELECT last_sent, attempts, gateway, answered_at FROM name_requests WHERE num = ?').get(num) as
    | { last_sent: number; attempts: number; gateway: number | null; answered_at: number | null }
    | undefined;
}

export function nameRequestStats() {
  const one = (sql: string, ...a: number[]) => Number((prep(sql).get(...a) as { c: number }).c);
  return {
    sentLastHour: one('SELECT COUNT(*) c FROM name_requests WHERE last_sent >= ?', nowSec() - 3600),
    sent24h: one('SELECT COUNT(*) c FROM name_requests WHERE last_sent >= ?', nowSec() - 86400),
    answered: one('SELECT COUNT(*) c FROM name_requests WHERE answered_at IS NOT NULL'),
    pending: one('SELECT COUNT(*) c FROM name_requests WHERE answered_at IS NULL'),
  };
}

// ---------------------------------------------------------- scheduled traceroutes

db.exec(`
CREATE TABLE IF NOT EXISTS traceroute_requests (
  num         INTEGER PRIMARY KEY,
  last_sent   INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  gateway     INTEGER,
  packet_id   INTEGER,
  answered_at INTEGER
);
`);

/**
 * Nodes worth tracing: heard recently through a known gateway and not traced lately.
 * Never-traced nodes first, then nodes more than 0 hops out (direct ones teach little),
 * then the longest since their last trace.
 */
export function tracerouteCandidates(opts: { heardSince: number; retryBefore: number; maxHopsAway: number; exclude: number }) {
  return prep(`
    SELECT n.num, n.last_gateway, n.hops_away FROM nodes n
    LEFT JOIN traceroute_requests r ON r.num = n.num
    WHERE n.last_heard >= ? AND n.last_gateway IS NOT NULL
      AND n.num != ? AND n.num != n.last_gateway
      AND (n.hops_away IS NULL OR n.hops_away <= ?)
      AND (r.last_sent IS NULL OR r.last_sent < ?)
    ORDER BY (r.last_sent IS NOT NULL), (n.hops_away = 0), r.last_sent, n.last_heard DESC LIMIT 50`)
    .all(opts.heardSince, opts.exclude, opts.maxHopsAway, opts.retryBefore) as { num: number; last_gateway: number; hops_away: number | null }[];
}

export function recordTracerouteRequest(num: number, gateway: number, packetId: number) {
  prep(`INSERT INTO traceroute_requests (num, last_sent, attempts, gateway, packet_id) VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(num) DO UPDATE SET last_sent = excluded.last_sent, attempts = traceroute_requests.attempts + 1,
          gateway = excluded.gateway, packet_id = excluded.packet_id, answered_at = NULL`).run(num, nowSec(), gateway, packetId);
}

export function getTracerouteRequest(num: number) {
  return prep('SELECT last_sent, attempts, gateway, packet_id, answered_at FROM traceroute_requests WHERE num = ?').get(num) as
    | { last_sent: number; attempts: number; gateway: number | null; packet_id: number | null; answered_at: number | null }
    | undefined;
}

export function markTracerouteAnswered(num: number) {
  prep('UPDATE traceroute_requests SET answered_at = ? WHERE num = ? AND answered_at IS NULL').run(nowSec(), num);
}

export function tracerouteRequestStats() {
  const one = (sql: string, ...a: number[]) => Number((prep(sql).get(...a) as { c: number }).c);
  return {
    sentLastHour: one('SELECT COUNT(*) c FROM traceroute_requests WHERE last_sent >= ?', nowSec() - 3600),
    sent24h: one('SELECT COUNT(*) c FROM traceroute_requests WHERE last_sent >= ?', nowSec() - 86400),
    answered: one('SELECT COUNT(*) c FROM traceroute_requests WHERE answered_at IS NOT NULL'),
    pending: one('SELECT COUNT(*) c FROM traceroute_requests WHERE answered_at IS NULL'),
    lastSentAt: one('SELECT COALESCE(MAX(last_sent), 0) c FROM traceroute_requests'),
  };
}
