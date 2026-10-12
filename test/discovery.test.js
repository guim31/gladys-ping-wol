import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateName,
  describeCandidates,
  parseDescription,
  parseSsdpHeaders,
  ssdpCandidates,
} from '../src/discovery.js';
import { DESCRIPTIONS, SSDP_RESULTS, createNetwork } from './helpers/world.js';

test('SSDP headers are read case-insensitively', () => {
  const headers = parseSsdpHeaders(SSDP_RESULTS[0].headers);
  assert.equal(headers.location, 'http://192.0.2.1:80/RootDevice.xml');
  assert.equal(headers.st, 'urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1');
  assert.equal(headers.ext, '');
});

test('one candidate per answering IPv4 address, with its MAC when the core knows it', () => {
  const candidates = ssdpCandidates(SSDP_RESULTS);
  assert.deepEqual(candidates, [
    {
      id: 'm02005e100001',
      address: '192.0.2.1',
      mac: '02:00:5e:10:00:01',
      location: 'http://192.0.2.1/RootDevice.xml',
    },
    {
      id: 'a192-0-2-30',
      address: '192.0.2.30',
      mac: null,
      location: 'http://192.0.2.30:1400/xml/device_description.xml',
    },
    // The description is served by another address: never fetched.
    { id: 'm0011320a0b0c', address: '192.0.2.20', mac: '00:11:32:0a:0b:0c', location: null },
  ]);
  assert.deepEqual(ssdpCandidates(null), []);
  assert.deepEqual(ssdpCandidates([{ source_ip: 42 }, null]), []);
});

test('the root device of a UPnP description gives the name', () => {
  assert.deepEqual(parseDescription(DESCRIPTIONS['http://192.0.2.1/RootDevice.xml']), {
    friendlyName: 'Dummy Router',
    manufacturer: 'Steven',
    modelName: 'DummyRouter v1',
  });
  assert.equal(
    parseDescription('<friendlyName>Living room &amp; kitchen&#x21;</friendlyName>').friendlyName,
    'Living room & kitchen!',
  );
  assert.deepEqual(parseDescription('not xml'), {
    friendlyName: null,
    manufacturer: null,
    modelName: null,
  });
});

test('names: friendly name, else manufacturer and model, else the address', () => {
  assert.equal(
    candidateName({ address: '192.0.2.1', description: { friendlyName: 'Box' } }),
    'Box',
  );
  assert.equal(
    candidateName({ address: '192.0.2.1', description: { manufacturer: 'Acme', modelName: 'R1' } }),
    'Acme R1',
  );
  assert.equal(candidateName({ address: '192.0.2.1' }), '192.0.2.1');
});

test('descriptions are fetched for the candidates that have one; a failure is not fatal', async () => {
  const network = createNetwork();
  const fetched = [];
  const fetch = async (url, options) => {
    fetched.push(url);
    assert.ok(options.signal, 'the request is bounded in time');
    if (url.includes('192.0.2.1/')) {
      throw new Error('timeout');
    }
    return network.fetch(url);
  };
  const candidates = await describeCandidates(ssdpCandidates(SSDP_RESULTS), fetch);
  assert.deepEqual(fetched.sort(), [
    'http://192.0.2.1/RootDevice.xml',
    'http://192.0.2.30:1400/xml/device_description.xml',
  ]);
  assert.deepEqual(
    candidates.map((candidate) => candidateName(candidate)),
    ['192.0.2.1', 'Dummy TV', '192.0.2.20'],
  );
});
