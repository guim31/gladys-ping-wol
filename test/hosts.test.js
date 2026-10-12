import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  discoveredHostId,
  findHost,
  newHostId,
  normalizeAddress,
  normalizeMac,
  parseHostFields,
  restoreHost,
} from '../src/hosts.js';

test('MAC addresses in every common notation', () => {
  for (const raw of [
    '64:e4:d5:b4:12:66',
    '64-E4-D5-B4-12-66',
    '64e4.d5b4.1266',
    ' 64E4D5B41266 ',
  ]) {
    assert.equal(normalizeMac(raw), '64:e4:d5:b4:12:66', raw);
  }
  for (const raw of [
    '',
    '64:e4:d5:b4:12',
    '00:00:00:00:00:00',
    'ff:ff:ff:ff:ff:ff',
    '01:00:5e:00:00:fb',
    42,
  ]) {
    assert.equal(normalizeMac(raw), null, String(raw));
  }
});

test('addresses: IPv4 and DNS names, pasted URLs cleaned', () => {
  assert.equal(normalizeAddress(' 192.0.2.10 '), '192.0.2.10');
  assert.equal(normalizeAddress('http://192.0.2.10:5000/web'), '192.0.2.10');
  assert.equal(normalizeAddress('NAS.example.org'), 'nas.example.org');
  for (const raw of ['192.0.2', '300.1.1.1', '192.0.2.10.5', 'bad_name', '', '-nas', null]) {
    assert.equal(normalizeAddress(raw), null, String(raw));
  }
});

test('the "Add a host" fields: defaults and normalization', () => {
  assert.deepEqual(parseHostFields({ name: '  Office   PC ', address: '192.0.2.20' }), {
    host: {
      name: 'Office PC',
      address: '192.0.2.20',
      mac: null,
      broadcast: null,
      method: 'auto',
      port: null,
      offlineAfter: null,
    },
  });
  assert.deepEqual(
    parseHostFields({
      name: 'Phone',
      address: '192.0.2.40',
      mac: '',
      broadcast: '',
      method: 'tcp',
      port: '62078',
      offline_after: '600',
    }).host,
    {
      name: 'Phone',
      address: '192.0.2.40',
      mac: null,
      broadcast: null,
      method: 'tcp',
      port: 62078,
      offlineAfter: 600,
    },
  );
});

test('the "Add a host" fields: every mistake has its message', () => {
  const cases = [
    [{ address: '192.0.2.20' }, 'name'],
    [{ name: 'x'.repeat(61), address: '192.0.2.20' }, 'nameLength'],
    [{ name: 'PC', address: '192.0.2' }, 'address'],
    [{ name: 'PC', address: 'pc.local' }, 'mdns'],
    [{ name: 'PC', address: '192.0.2.20', mac: '64:e4' }, 'mac'],
    [{ name: 'PC', address: '192.0.2.20', broadcast: '192.0.2' }, 'broadcast'],
    [{ name: 'PC', address: '192.0.2.20', port: 70000 }, 'port'],
    [{ name: 'PC', address: '192.0.2.20', method: 'tcp' }, 'tcpPort'],
  ];
  for (const [fields, error] of cases) {
    assert.equal(parseHostFields(fields).error, error, JSON.stringify(fields));
  }
});

test('ids: random for a host added by hand, derived from the MAC or the address otherwise', () => {
  assert.match(newHostId(), /^h[0-9a-f]{10}$/);
  assert.notEqual(newHostId(), newHostId());
  assert.equal(
    discoveredHostId({ mac: '00:11:32:0a:0b:0c', address: '192.0.2.20' }),
    'm0011320a0b0c',
  );
  assert.equal(discoveredHostId({ mac: null, address: '192.0.2.30' }), 'a192-0-2-30');
});

test('a host read back from /data is checked again', () => {
  assert.equal(restoreHost({ id: 'h1', name: 'PC', address: '192.0.2.20' }).method, 'auto');
  assert.equal(restoreHost({ id: 'h1', name: 'PC', address: 'not valid!' }), null);
  assert.equal(restoreHost({ name: 'PC', address: '192.0.2.20' }), null);
  assert.equal(restoreHost(null), null);
});

test('a host is found by name (any case) or by address', () => {
  const hosts = [
    { id: 'a', name: 'Office PC', address: '192.0.2.20' },
    { id: 'b', name: 'NAS', address: '192.0.2.21' },
  ];
  assert.equal(findHost(hosts, 'office pc')?.id, 'a');
  assert.equal(findHost(hosts, ' 192.0.2.21 ')?.id, 'b');
  assert.equal(findHost(hosts, 'TV'), undefined);
  assert.equal(findHost(hosts, ''), undefined);
});
