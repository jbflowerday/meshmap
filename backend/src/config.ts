import { expandKey } from './crypto.ts';

const env = (k: string, d: string) => process.env[k] ?? d;
const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== '' && process.env[k] !== undefined ? v : d;
};

// Comma separated base64 PSKs. "AQ==" is the default LongFast key.
const keys = env('MESH_CHANNEL_KEYS', 'AQ==')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => expandKey(Buffer.from(s, 'base64')))
  .filter((k): k is Buffer => k !== null);

export const config = {
  port: num('PORT', 3000),
  dbPath: env('DB_PATH', './data/meshmap.db'),
  mqtt: {
    url: env('MQTT_URL', 'mqtt://localhost:1883'),
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    topics: env('MQTT_TOPICS', 'msh/#').split(',').map((s) => s.trim()).filter(Boolean),
    clientId: env('MQTT_CLIENT_ID', `meshmap-backend-${Math.random().toString(16).slice(2, 8)}`),
  },
  keys,
  /** History (positions / telemetry / packet log) retention. */
  retentionDays: num('RETENTION_DAYS', 7),
  /** Nodes not heard for this long are deleted. */
  nodeMaxAgeDays: num('NODE_MAX_AGE_DAYS', 30),
  /** Links not refreshed for this long are deleted. */
  linkMaxAgeHours: num('LINK_MAX_AGE_HOURS', 72),
  /** Drop positions with fewer precision bits than this (0 = keep all). */
  minPrecisionBits: num('MIN_PRECISION_BITS', 0),
  corsOrigin: env('CORS_ORIGIN', '*'),
  /**
   * Ask unnamed nodes for their NODEINFO via MQTT downlink (like "Exchange user
   * info" in the app). Needs Downlink enabled on the gateway's channel. Off by default.
   */
  nameRequests: {
    enabled: /^(1|true|yes|on)$/i.test(env('NAME_REQUESTS', 'false')),
    maxPerHour: num('NAME_REQUEST_MAX_PER_HOUR', 6),
    /** Same node is asked again only after this long (firmware suppresses repeat replies for 12 h). */
    retryHours: num('NAME_REQUEST_RETRY_HOURS', 12),
    /** Give a newly heard node this long to announce itself before asking. */
    minAgeMinutes: num('NAME_REQUEST_MIN_AGE_MINUTES', 5),
    /** Only ask nodes heard this recently (they're likely still in range). */
    heardWithinMinutes: num('NAME_REQUEST_HEARD_WITHIN_MINUTES', 30),
    hopLimit: num('NAME_REQUEST_HOP_LIMIT', 3),
    longName: env('NAME_REQUEST_LONG_NAME', 'MeshMap'),
    shortName: env('NAME_REQUEST_SHORT_NAME', 'MMap'),
    /** Optional fixed node id for MeshMap's requests, e.g. "!4d4d0001". Random and persisted if unset. */
    nodeId: process.env.NAME_REQUEST_NODE_ID || undefined,
  },
};
