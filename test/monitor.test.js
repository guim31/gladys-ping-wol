// -----------------------------------------------------------------------------
// The monitor through the full SDK wiring (src/app.js) on the SDK's fake
// Gladys: adding hosts, states, offline delay, Wake-on-LAN, network search,
// persistence.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ICMP_DENIED } from '../src/messages.js';
import { WAKE_FAILED_TRIGGER } from '../src/monitor.js';
import {
  addHost,
  create,
  createNetwork,
  createWorld,
  discovered,
  featureId,
  wakes,
} from './helpers/world.js';

const PC = { name: 'Office PC', address: '192.0.2.20', mac: '64:e4:d5:b4:12:66' };

async function worldWithPc(t, { network, config, fields = PC } = {}) {
  const world = await createWorld({
    config,
    network: network ?? createNetwork({ '192.0.2.20': { reachable: true, latency: 0.84 } }),
  });
  t.after(() => world.app.stop());
  await addHost(world, fields);
  const device = await create(world, fields.name);
  return { ...world, device };
}

test('adding a host checks it once and proposes it in the Discover tab', async (t) => {
  const world = await createWorld({
    network: createNetwork({ '192.0.2.20': { reachable: true, latency: 0.84 } }),
  });
  t.after(() => world.app.stop());
  const ack = await addHost(world, PC);
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data.message, {
    en: 'Office PC added. It answers in 0.84 ms (ICMP). Open the Discover tab to create its device.',
    fr: "Office PC ajouté. Il répond en 0.84 ms (ICMP). Ouvrez l'onglet Découverte pour créer son appareil.",
    de: 'Office PC hinzugefügt. Er antwortet in 0.84 ms (ICMP). Öffne den Tab „Entdecken“, um sein Gerät anzulegen.',
    es: 'Office PC añadido. Responde en 0.84 ms (ICMP). Abra la pestaña Descubrir para crear su dispositivo.',
  });
  const device = discovered(world, 'Office PC');
  assert.equal(device.model, 'Ping + Wake-on-LAN');
  assert.equal(device.should_poll, false);
  assert.deepEqual(device.params, [
    { name: 'ADDRESS', value: '192.0.2.20' },
    { name: 'MAC', value: '64:e4:d5:b4:12:66' },
  ]);
  assert.deepEqual(
    device.features.map((feature) => `${feature.category}/${feature.type}`),
    ['presence-sensor/binary', 'duration/decimal', 'button/push'],
  );
  // Not created yet: nothing published.
  assert.deepEqual(world.fake.states, []);
});

test('a mistake in the form is answered in every language, nothing is added', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await addHost(world, { name: 'PC', address: 'pc.local' });
  assert.equal(ack.success, true);
  assert.match(ack.data.message.fr, /« pc\.local » est un nom mDNS/);
  assert.match(ack.data.message.de, /„pc\.local“ ist ein mDNS-Name/);
  assert.deepEqual(world.fake.discoveredDevices, []);
});

test('creating the device publishes its states at once, and refreshes the widget', async (t) => {
  const world = await worldWithPc(t);
  assert.equal(world.fake.lastState(featureId(world.device, 'online')), 1);
  assert.equal(world.fake.lastState(featureId(world.device, 'latency')), 0.84);
  assert.ok(world.fake.widgetRefreshes.includes('hosts'));
});

test('only changes are published; a small latency jitter is not one', async (t) => {
  const world = await worldWithPc(t);
  const count = () => world.fake.states.length;
  const before = count();
  world.network.hosts['192.0.2.20'].latency = 0.9; // + 0.06 ms
  await world.monitor.cycle();
  assert.equal(count(), before, 'nothing changed enough');
  world.network.hosts['192.0.2.20'].latency = 3.5; // + 2.7 ms
  await world.monitor.cycle();
  assert.equal(count(), before + 1);
  assert.equal(world.fake.lastState(featureId(world.device, 'latency')), 3.5);
});

test('the heartbeat publishes an unchanged state again after 12 hours', async (t) => {
  const world = await worldWithPc(t);
  const before = world.fake.states.length;
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 13 * 60 * 60 * 1000 });
  await world.monitor.cycle();
  t.mock.timers.reset();
  assert.equal(world.fake.states.length, before + 2, 'online and latency sent again');
});

test('offline only after the configured delay without any answer', async (t) => {
  const world = await worldWithPc(t, { config: { offline_after: '180', check_interval: '60' } });
  const online = featureId(world.device, 'online');
  world.network.hosts['192.0.2.20'].reachable = false;
  world.clock.advance(60_000);
  await world.monitor.cycle();
  world.clock.advance(60_000);
  await world.monitor.cycle();
  assert.equal(world.fake.lastState(online), 1, 'still online after 2 minutes');
  world.clock.advance(60_000);
  await world.monitor.cycle();
  assert.equal(world.fake.lastState(online), 0, 'offline after 3 minutes');
  // The latency of an offline host is left alone.
  assert.equal(world.fake.lastState(featureId(world.device, 'latency')), 0.84);
  // Back: online at the first answer.
  world.network.hosts['192.0.2.20'].reachable = true;
  await world.monitor.cycle();
  assert.equal(world.fake.lastState(online), 1);
});

test('the per-host offline delay wins over the setting; 0 = first failed check', async (t) => {
  const world = await worldWithPc(t, {
    config: { offline_after: '900' },
    fields: { ...PC, offline_after: '0' },
  });
  world.network.hosts['192.0.2.20'].reachable = false;
  await world.monitor.cycle();
  assert.equal(world.fake.lastState(featureId(world.device, 'online')), 0);
});

test('a host that never answered is declared offline once the delay has passed since the start', async (t) => {
  const world = await createWorld({ config: { offline_after: '60' } });
  t.after(() => world.app.stop());
  await addHost(world, { name: 'TV', address: '192.0.2.31' });
  const device = await create(world, 'TV');
  const online = featureId(device, 'online');
  assert.equal(world.fake.lastState(online), undefined, 'unknown at first');
  world.clock.advance(60_000);
  await world.monitor.cycle();
  assert.equal(world.fake.lastState(online), 0);
});

test('only the hosts created in Gladys are checked', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await addHost(world, PC);
  await addHost(world, { name: 'NAS', address: '192.0.2.21' });
  await create(world, 'NAS');
  world.network.probes.length = 0;
  await world.monitor.cycle();
  assert.deepEqual(
    world.network.probes.map((probe) => probe.address),
    ['192.0.2.21'],
  );
});

test('updating a host keeps its device; removing it keeps the device in Gladys', async (t) => {
  const world = await worldWithPc(t);
  const id = world.device.external_id;
  const ack = await addHost(world, { name: 'office pc', address: '192.0.2.22' });
  assert.equal(ack.data.message.en, 'office pc updated. It does not answer right now.');
  const updated = world.fake.discoveredDevices.find((device) => device.external_id === id);
  assert.equal(updated.name, 'office pc');
  assert.equal(updated.features.length, 2, 'no MAC any more: no wake button');

  const removed = await world.fake.action('remove_host', { host: '192.0.2.22' });
  assert.equal(
    removed.data.message.en,
    'office pc removed from the list. Delete its device in Gladys if needed. 0 host(s) in the list.',
  );
  assert.deepEqual(world.fake.discoveredDevices, []);
  const unknown = await world.fake.action('remove_host', { host: 'TV' });
  assert.equal(unknown.data.message.en, 'No host is named "TV" or has this address.');
});

test('the list survives a restart (/data), and is rebuilt from Gladys if the file is lost', async (t) => {
  const first = await worldWithPc(t);
  await first.app.stop();
  const saved = JSON.parse(await readFile(join(first.dataDir, 'hosts.json'), 'utf8'));
  assert.equal(saved.hosts[0].name, 'Office PC');

  const restarted = await createWorld({ dataDir: first.dataDir, devices: [first.device] });
  t.after(() => restarted.app.stop());
  assert.deepEqual(
    restarted.fake.discoveredDevices.map((device) => device.external_id),
    [first.device.external_id],
  );

  const lost = await createWorld({ devices: [first.device] });
  t.after(() => lost.app.stop());
  const [rebuilt] = lost.fake.discoveredDevices;
  assert.equal(rebuilt.external_id, first.device.external_id);
  assert.deepEqual(rebuilt.params, first.device.params);
});

test('the wake button sends the magic packet through the core, to the subnet broadcast if set', async (t) => {
  const world = await worldWithPc(t, { fields: { ...PC, broadcast: '192.0.2.255' } });
  const wake = world.device.features.find((feature) => feature.type === 'push');
  const ack = await world.fake.setValue(world.device, wake, 1);
  assert.equal(ack.success, true);
  assert.deepEqual(wakes(world), [{ mac: '64:e4:d5:b4:12:66', address: '192.0.2.255' }]);
});

test('two wakes in a row are spaced by the core rate limit (one every 2 s)', async (t) => {
  const world = await worldWithPc(t);
  await addHost(world, { name: 'NAS', address: '192.0.2.21', mac: '00:11:32:0a:0b:0c' });
  const nas = await create(world, 'NAS');
  const start = world.clock.now();
  await Promise.all([
    world.fake.setValue(world.device, { external_id: featureId(world.device, 'wake') }, 1),
    world.fake.setValue(nas, { external_id: featureId(nas, 'wake') }, 1),
  ]);
  assert.equal(wakes(world).length, 2);
  assert.ok(world.clock.now() - start >= 2000, 'the second packet waited');
});

test('a device that does not answer after the wake timeout fires wake_failed', async (t) => {
  const network = createNetwork({ '192.0.2.20': { reachable: false } });
  const world = await worldWithPc(t, { network, config: { wake_timeout: '60' } });
  await world.fake.setValue(world.device, { external_id: featureId(world.device, 'wake') }, 1);
  for (let elapsed = 0; elapsed < 60_000; elapsed += 5000) {
    world.clock.advance(5000);
    await world.monitor.runWakeChecks();
  }
  // Sent again every 30 seconds while it stays silent.
  assert.equal(wakes(world).length, 2);
  assert.deepEqual(world.fake.sceneEvents, [
    {
      key: WAKE_FAILED_TRIGGER,
      data: {
        device: world.device.external_id,
        name: 'Office PC',
        address: '192.0.2.20',
        waited_seconds: 60,
      },
    },
  ]);
  // Over: no more checks.
  world.network.probes.length = 0;
  await world.monitor.runWakeChecks();
  assert.equal(world.network.probes.length, 0);
});

test('a device that boots in time fires nothing and is online at once', async (t) => {
  const network = createNetwork({ '192.0.2.20': { reachable: false } });
  const world = await worldWithPc(t, { network, config: { offline_after: '0' } });
  await world.fake.setValue(world.device, { external_id: featureId(world.device, 'wake') }, 1);
  world.clock.advance(5000);
  await world.monitor.runWakeChecks();
  network.hosts['192.0.2.20'].reachable = true;
  world.clock.advance(5000);
  await world.monitor.runWakeChecks();
  assert.equal(world.fake.lastState(featureId(world.device, 'online')), 1);
  assert.deepEqual(world.fake.sceneEvents, []);
});

test('a host without MAC cannot be woken: the command fails with a clear message', async (t) => {
  const world = await worldWithPc(t, {
    fields: { name: 'TV', address: '192.0.2.31' },
    config: { language: 'fr' },
  });
  const ack = await world.fake.setValue(
    world.device,
    { external_id: `${world.device.external_id}:wake` },
    1,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /n'est pas un hôte|adresse MAC/);
  assert.deepEqual(wakes(world), []);
});

test('ICMP refused in the container: the Configuration screen says so, TCP keeps working', async (t) => {
  const network = createNetwork({ '192.0.2.20': { reachable: true } }, { icmpDenied: true });
  const world = await worldWithPc(t, { network });
  assert.deepEqual(world.fake.connectionStatus, { connected: true, message: ICMP_DENIED });
  assert.equal(world.fake.lastState(featureId(world.device, 'online')), 1);
});

test('the network search proposes the UPnP devices; a created one joins the list', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await addHost(world, { name: 'NAS', address: '192.0.2.20' });
  const ack = await world.fake.action('search');
  assert.deepEqual(world.fake.scans, [{ type: 'ssdp', timeout_seconds: 5 }]);
  assert.equal(
    ack.data.message.en,
    '2 new device(s) found on the network, 1 with a MAC address: Dummy Router (192.0.2.1), Dummy TV (192.0.2.30). Open the Discover tab to add them.',
  );
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.name),
    ['NAS', 'Dummy Router', 'Dummy TV'],
  );
  // The router came with its MAC (core ARP table): Wake-on-LAN ready.
  assert.equal(discovered(world, 'Dummy Router').features.length, 3);

  await create(world, 'Dummy TV');
  // A new search no longer proposes it, and it stays after the restart.
  await world.fake.scanRequest();
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.name),
    ['NAS', 'Dummy TV', 'Dummy Router'],
  );
  await world.app.stop();
  const saved = JSON.parse(await readFile(join(world.dataDir, 'hosts.json'), 'utf8'));
  assert.deepEqual(
    saved.hosts.map((host) => host.name),
    ['NAS', 'Dummy TV'],
  );
});

test('without the SSDP capture (refused by an older core) the search says so', async (t) => {
  const world = await createWorld({ ssdp: null });
  t.after(() => world.app.stop());
  t.mock.method(world.gladys, 'scanNetwork', async () => {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  });
  const ack = await world.fake.action('search');
  assert.equal(ack.data.message.en, 'The network search is unavailable: add your hosts by hand.');
  // The Discovery tab still gets the list.
  await world.fake.scanRequest();
});

test('a new language names the features of the devices created afterwards', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await addHost(world, PC);
  await world.fake.configUpdated({ language: 'es' });
  assert.deepEqual(
    discovered(world, 'Office PC').features.map((feature) => feature.name),
    ['En línea', 'Latencia', 'Encender'],
  );
});

test('a reconnection publishes the devices and the states again', async (t) => {
  const world = await worldWithPc(t);
  const before = world.fake.states.length;
  await world.gladys.disconnect();
  await world.gladys.connect();
  assert.equal(world.fake.states.length, before + 2);
});

test('the onPoll fallback checks the host', async (t) => {
  const world = await worldWithPc(t);
  world.network.probes.length = 0;
  const ack = await world.fake.poll(world.device);
  assert.equal(ack.success, true);
  assert.equal(world.network.probes.length, 1);
});
