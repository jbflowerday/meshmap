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
};
