// -----------------------------------------------------------------------------
// The probe, with an injected process runner and socket factory: the outputs
// are real ones of iputils 20250605 (Alpine 3.24), see test/fixtures/README.md.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { DEFAULT_TCP_PORTS, createProbe, parsePingOutput } from '../src/probe.js';

const output = (name) =>
  readFileSync(new URL(`./fixtures/ping/${name}.txt`, import.meta.url), 'utf8');

/** A fake `spawn`: prints `text` then exits with `code`. */
function fakeSpawn(text, code, calls = []) {
  return (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      (code === 2 ? child.stderr : child.stdout).emit('data', text);
      child.emit('close', code);
    });
    return child;
  };
}

/** A fake `net.connect`: `answers[port]` is 'accept', 'refuse', 'unreachable' or absent (silence). */
function fakeConnect(answers, calls = []) {
  return ({ host, port }) => {
    calls.push({ host, port });
    const socket = new EventEmitter();
    socket.destroy = () => {};
    setImmediate(() => {
      const answer = answers[port];
      if (answer === 'accept') {
        socket.emit('connect');
      } else if (answer === 'refuse') {
        socket.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
      } else if (answer === 'unreachable') {
        socket.emit('error', Object.assign(new Error('unreachable'), { code: 'EHOSTUNREACH' }));
      }
    });
    return socket;
  };
}

let clock = 0;
const now = () => (clock += 2.5);

test('the ping summaries of iputils and BusyBox are read', () => {
  assert.deepEqual(parsePingOutput(output('iputils-reply')), { received: 3, average: 0.047 });
  assert.deepEqual(parsePingOutput(output('iputils-noreply')), { received: 0, average: null });
  assert.deepEqual(parsePingOutput(output('iputils-denied')), { received: 0, average: null });
  assert.deepEqual(parsePingOutput(output('busybox-reply')), { received: 3, average: 0.087 });
});

test('ICMP: an answer, a silence, a refused socket, no ping binary', async () => {
  const calls = [];
  const reply = createProbe({ spawn: fakeSpawn(output('iputils-reply'), 0, calls) });
  assert.deepEqual(await reply.icmp('192.0.2.10'), { status: 'reply', latency: 0.05 });
  assert.deepEqual(calls[0], {
    command: 'ping',
    args: ['-n', '-q', '-c', '3', '-i', '0.2', '-W', '1', '192.0.2.10'],
  });

  const silent = createProbe({ spawn: fakeSpawn(output('iputils-noreply'), 1) });
  assert.deepEqual(await silent.icmp('192.0.2.1'), { status: 'noreply' });

  const denied = createProbe({ spawn: fakeSpawn(output('iputils-denied'), 2) });
  assert.deepEqual(await denied.icmp('127.0.0.1'), { status: 'denied' });

  const unresolved = createProbe({
    spawn: fakeSpawn('ping: nas.invalid: Name does not resolve\n', 2),
  });
  assert.equal((await unresolved.icmp('nas.invalid')).status, 'error');

  const missing = createProbe({
    spawn: () => {
      const child = new EventEmitter();
      setImmediate(() =>
        child.emit('error', Object.assign(new Error('spawn ping ENOENT'), { code: 'ENOENT' })),
      );
      return child;
    },
  });
  assert.deepEqual(await missing.icmp('192.0.2.10'), { status: 'denied' });
});

test('TCP: an accepted or a refused connection proves the host is up', async () => {
  const accept = createProbe({ connect: fakeConnect({ 445: 'accept' }), now });
  assert.equal((await accept.tcp('192.0.2.10', [445])).status, 'reply');

  const refuse = createProbe({ connect: fakeConnect({ 80: 'refuse' }), now });
  const refused = await refuse.tcp('192.0.2.10', [80]);
  assert.equal(refused.status, 'reply');
  assert.equal(refused.latency, 2.5);

  const unreachable = createProbe({
    connect: fakeConnect({ 80: 'unreachable', 443: 'unreachable' }),
    now,
  });
  assert.deepEqual(await unreachable.tcp('192.0.2.10', [80, 443]), { status: 'noreply' });

  // Silence: the attempt times out.
  const silent = createProbe({ connect: fakeConnect({}), now });
  assert.deepEqual(await silent.tcp('192.0.2.10', [80], 20), { status: 'noreply' });
});

test('auto: ping first, TCP on the usual ports when the ping gets no answer', async () => {
  const calls = [];
  const probe = createProbe({
    spawn: fakeSpawn(output('iputils-noreply'), 1),
    connect: fakeConnect({ 62078: 'accept' }, calls),
    now,
  });
  const result = await probe.probe({ address: '192.0.2.40', method: 'auto' });
  assert.equal(result.reachable, true);
  assert.equal(result.method, 'tcp');
  assert.equal(result.icmpDenied, false);
  assert.deepEqual(
    calls.map((call) => call.port),
    DEFAULT_TCP_PORTS,
  );
});

test('auto with a port: only that port; tcp: no ping at all', async () => {
  const pings = [];
  const ports = [];
  const probe = createProbe({
    spawn: fakeSpawn(output('iputils-noreply'), 1, pings),
    connect: fakeConnect({ 3389: 'refuse' }, ports),
    now,
  });
  assert.equal((await probe.probe({ address: '192.0.2.20', port: 3389 })).reachable, true);
  assert.deepEqual(
    ports.map((call) => call.port),
    [3389],
  );
  assert.equal(pings.length, 1);

  await probe.probe({ address: '192.0.2.20', method: 'tcp', port: 3389 });
  assert.equal(pings.length, 1, 'no ping in TCP mode');
});

test('ICMP refused by the container: TCP in auto mode, "unknown" in ICMP mode', async () => {
  const probe = createProbe({
    spawn: fakeSpawn(output('iputils-denied'), 2),
    connect: fakeConnect({ 80: 'accept' }),
    now,
  });
  const auto = await probe.probe({ address: '192.0.2.10', method: 'auto' });
  assert.deepEqual(
    { reachable: auto.reachable, method: auto.method, icmpDenied: auto.icmpDenied },
    { reachable: true, method: 'tcp', icmpDenied: true },
  );
  const icmpOnly = await probe.probe({ address: '192.0.2.10', method: 'icmp' });
  assert.deepEqual(icmpOnly, { reachable: null, latency: null, method: null, icmpDenied: true });
});

test('a silent host is offline, whatever the method', async () => {
  const probe = createProbe({
    spawn: fakeSpawn(output('iputils-noreply'), 1),
    connect: fakeConnect({}),
    now,
  });
  assert.deepEqual(await probe.probe({ address: '192.0.2.1', method: 'icmp' }), {
    reachable: false,
    latency: null,
    method: null,
    icmpDenied: false,
  });
});
