import mqtt from 'mqtt';
import { config } from './config.ts';
import { prune } from './db.ts';
import { handleMessage } from './ingest.ts';
import { startServer } from './server.ts';
import { startNameRequester } from './nameRequests.ts';

startServer();

const client = mqtt.connect(config.mqtt.url, {
  username: config.mqtt.username,
  password: config.mqtt.password,
  clientId: config.mqtt.clientId,
  reconnectPeriod: 5000,
  clean: true,
});

client.on('connect', () => {
  console.log(`[mqtt] connected to ${config.mqtt.url}, subscribing to ${config.mqtt.topics.join(', ')}`);
  client.subscribe(config.mqtt.topics, { qos: 0 }, (err) => {
    if (err) console.error('[mqtt] subscribe failed:', err.message);
  });
});
client.on('reconnect', () => console.log('[mqtt] reconnecting...'));
client.on('error', (err) => console.error('[mqtt] error:', err.message));
client.on('message', (topic, payload) => handleMessage(topic, payload));

startNameRequester((topic, payload) => client.publish(topic, payload, { qos: 0 }), () => client.connected);

prune();
setInterval(prune, 3600_000).unref();

const shutdown = () => {
  console.log('shutting down');
  client.end(true, () => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
