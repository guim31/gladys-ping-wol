import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAIT_CAP_SECONDS } from '../src/scenes.js';
import { addHost, create, createNetwork, createWorld, wakes } from './helpers/world.js';

async function world(t, hosts, config) {
  const w = await createWorld({ network: createNetwork(hosts), config });
  t.after(() => w.app.stop());
  await addHost(w, { name: 'Office PC', address: '192.0.2.20', mac: '64:e4:d5:b4:12:66' });
  const device = await create(w, 'Office PC');
  return { ...w, device };
}

/** Runs the wake checks until `promise` settles (the clock moves 5 s per round). */
async function drive(w, promise, rounds = 40) {
  let settled = false;
  promise.finally(() => {
    settled = true;
  });
  for (let round = 0; round < rounds && !settled; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    w.clock.advance(5000);
    await w.monitor.runWakeChecks();
  }
  return promise;
}

test('wake_device without waiting: the packet is sent, no output', async (t) => {
  const w = await world(t, { '192.0.2.20': { reachable: false } });
  const ack = await w.fake.sceneAction('wake_device', { device: w.device.external_id });
  assert.deepEqual(ack, { success: true, data: { outputs: {} } });
  assert.equal(wakes(w).length, 1);
});

test('wake_device waiting: online with the start-up time once it answers', async (t) => {
  const w = await world(t, { '192.0.2.20': { reachable: false } });
  const pending = w.fake.sceneAction('wake_device', { device: w.device.external_id, wait: true });
  const result = drive(w, pending);
  await new Promise((resolve) => setImmediate(resolve));
  w.clock.advance(15_000);
  w.network.hosts['192.0.2.20'].reachable = true;
  const ack = await result;
  assert.equal(ack.success, true);
  assert.equal(ack.data.outputs.online, 1);
  assert.ok(ack.data.outputs.boot_seconds >= 15 && ack.data.outputs.boot_seconds <= 30);
});

test('wake_device waiting on a host already up: nothing sent', async (t) => {
  const w = await world(t, { '192.0.2.20': { reachable: true } });
  const ack = await w.fake.sceneAction('wake_device', { device: w.device.external_id, wait: true });
  assert.deepEqual(ack.data.outputs, { online: 1, boot_seconds: 0 });
  assert.deepEqual(wakes(w), []);
});

test('wake_device waiting gives up at 100 s (the core waits 120 s for an action)', async (t) => {
  const w = await world(t, { '192.0.2.20': { reachable: false } }, { wake_timeout: '600' });
  const start = w.clock.now();
  const ack = await drive(
    w,
    w.fake.sceneAction('wake_device', { device: w.device.external_id, wait: true }),
  );
  assert.deepEqual(ack.data.outputs, { online: 0 });
  const waited = (w.clock.now() - start) / 1000;
  assert.ok(waited >= WAIT_CAP_SECONDS && waited < WAIT_CAP_SECONDS + 10, `${waited} s`);
  // The follow-up goes on until the wake timeout: no wake_failed yet.
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('wake_device on a device of another integration fails', async (t) => {
  const w = await world(t, {});
  const ack = await w.fake.sceneAction('wake_device', { device: 'ext:other:light:1' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /n'est pas un hôte/);
});

test('check_address: 1 with the latency, or 0', async (t) => {
  const w = await world(t, {
    '192.0.2.50': { reachable: true, latency: 12.5 },
    '192.0.2.51': { reachable: true, latency: 3, tcpOnly: true },
  });
  const up = await w.fake.sceneAction('check_address', { address: '192.0.2.50' });
  assert.deepEqual(up.data.outputs, { reachable: 1, latency_ms: 12.5 });
  const down = await w.fake.sceneAction('check_address', { address: '192.0.2.99' });
  assert.deepEqual(down.data.outputs, { reachable: 0 });
  await w.fake.sceneAction('check_address', { address: '192.0.2.51', port: 443 });
  assert.deepEqual(w.network.probes.at(-1), { address: '192.0.2.51', method: 'tcp', port: 443 });
  const invalid = await w.fake.sceneAction('check_address', { address: 'not an address' });
  assert.equal(invalid.success, false);
});
