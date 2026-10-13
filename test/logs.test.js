// -----------------------------------------------------------------------------
// What the integration writes to `docker logs`: at info, only the lifecycle (a
// host going offline or coming back, a Wake-on-LAN), never one line per check
// cycle; a failure that repeats at every cycle is logged once, plus one line
// when it is over.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addHost, captureLogs, create, createNetwork, createWorld } from './helpers/world.js';

const PC = { name: 'Office PC', address: '192.0.2.20', mac: '64:e4:d5:b4:12:66' };

async function worldWithPc(t) {
  const world = await createWorld({
    network: createNetwork({ '192.0.2.20': { reachable: true, latency: 0.84 } }),
  });
  t.after(() => world.app.stop());
  await addHost(world, PC);
  await create(world, PC.name);
  return world;
}

async function cycles(world, count) {
  for (let i = 0; i < count; i += 1) {
    world.clock.advance(30_000);
    await world.monitor.runCycle();
  }
}

test('a normal check cycle writes nothing at info', async (t) => {
  const world = await worldWithPc(t);
  const lines = captureLogs(t, 'info');
  await cycles(world, 5);
  assert.deepEqual(lines, []);
});

test('LOG_LEVEL=debug shows the check cycles', async (t) => {
  const world = await worldWithPc(t);
  const lines = captureLogs(t, 'debug');
  await cycles(world, 2);
  assert.equal(lines.filter((line) => /Check cycle: 1 host/.test(line.text)).length, 2);
});

test('a host going offline and coming back is one info line each', async (t) => {
  const world = await worldWithPc(t);
  const lines = captureLogs(t, 'info');
  world.network.hosts['192.0.2.20'].reachable = false;
  await cycles(world, 4);
  world.network.hosts['192.0.2.20'].reachable = true;
  await cycles(world, 3);
  assert.deepEqual(
    lines.map((line) => line.text.replace(/^\[[^\]]+\] /, '')),
    ['[INFO] [ping-wol] Office PC is offline', '[INFO] [ping-wol] Office PC is back online'],
  );
});

test('states refused at every cycle: one warning, then one line at recovery', async (t) => {
  const world = await worldWithPc(t);
  const lines = captureLogs(t, 'info');
  const publish = t.mock.method(world.gladys, 'publishChangedStates', async () => {
    throw new Error('Gladys unreachable');
  });
  await cycles(world, 4);
  assert.ok(publish.mock.callCount() >= 4);
  assert.deepEqual(
    lines.map((line) => [line.level, line.text.replace(/^\[[^\]]+\] \[\w+\] /, '')]),
    [['warn', '[ping-wol] Publishing the states failed: Gladys unreachable']],
  );
  publish.mock.restore();
  await cycles(world, 2);
  assert.equal(lines.length, 2);
  assert.match(lines[1].text, /\[INFO\].*Publishing the states works again/);
});

test('a check cycle failing again and again is logged once', async (t) => {
  const world = await worldWithPc(t);
  const lines = captureLogs(t, 'info');
  const probe = world.monitor.probeHost;
  world.monitor.probeHost = async () => {
    throw new Error('spawn failed');
  };
  await cycles(world, 3);
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /\[ERROR\].*Check cycle failed spawn failed/);
  world.monitor.probeHost = probe;
  await cycles(world, 1);
  assert.equal(lines.length, 2);
  assert.match(lines[1].text, /Check cycles work again/);
});

test('an unavailable network search is logged once', async (t) => {
  const world = await worldWithPc(t);
  const lines = captureLogs(t, 'info');
  t.mock.method(world.gladys, 'scanNetwork', async () => {
    throw new Error('capture refused');
  });
  assert.equal(await world.monitor.search(), null);
  assert.equal(await world.monitor.search(), null);
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /\[WARN\].*Network search unavailable: capture refused/);
});

test('ICMP refused by Docker is logged once', async (t) => {
  const world = await createWorld({
    network: createNetwork({ '192.0.2.20': { reachable: true } }, { icmpDenied: true }),
  });
  t.after(() => world.app.stop());
  const lines = captureLogs(t, 'info');
  await addHost(world, PC);
  await create(world, PC.name);
  await cycles(world, 3);
  assert.equal(lines.filter((line) => /ICMP is not allowed/.test(line.text)).length, 1);
  assert.ok(lines.every((line) => line.level !== 'warn' || /ICMP/.test(line.text)));
});

test('a Wake-on-LAN is one info line, without the MAC address', async (t) => {
  const world = await worldWithPc(t);
  const lines = captureLogs(t, 'info');
  await world.monitor.wake(world.monitor.hostOfDevice(world.fake.discoveredDevices[0].external_id));
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /Wake-on-LAN sent to Office PC/);
  assert.doesNotMatch(lines[0].text, /64:e4/);
});
