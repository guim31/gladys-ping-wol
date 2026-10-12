// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a simulated network (which
// address answers, how fast, by which method), a manual clock, a temporary
// /data, and the integration wired on top through registerHandlers.
// Nothing touches the network.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';

process.env.LOG_LEVEL ??= 'silent';

const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

/** Raw answers of the core to an SSDP scan (anonymized addresses). */
export const SSDP_RESULTS = JSON.parse(fixture('ssdp-results.json'));

/** UPnP descriptions served by the simulated devices, by URL. */
export const DESCRIPTIONS = {
  'http://192.0.2.1/RootDevice.xml': fixture('upnp/igd-device.xml'),
  'http://192.0.2.30:1400/xml/device_description.xml': fixture('upnp/dmr-device.xml'),
};

/**
 * Simulated network: `hosts[address] = { reachable, latency, tcpOnly }` (tcpOnly:
 * the host filters ICMP).
 * `icmpDenied: true` simulates a Docker without ping sockets.
 */
export function createNetwork(hosts = {}, { icmpDenied = false } = {}) {
  const network = {
    hosts: { ...hosts },
    icmpDenied,
    probes: [],
    async probe(target) {
      network.probes.push({ ...target });
      const host = network.hosts[target.address];
      const icmpOk = Boolean(host?.reachable) && !host.tcpOnly && !network.icmpDenied;
      if (target.method === 'icmp') {
        return network.icmpDenied
          ? { reachable: null, latency: null, method: null, icmpDenied: true }
          : {
              reachable: icmpOk,
              latency: icmpOk ? (host.latency ?? 1.2) : null,
              method: icmpOk ? 'icmp' : null,
              icmpDenied: false,
            };
      }
      if (!host?.reachable) {
        return { reachable: false, latency: null, method: null, icmpDenied: network.icmpDenied };
      }
      const method = target.method === 'auto' && icmpOk ? 'icmp' : 'tcp';
      return {
        reachable: true,
        latency: host.latency ?? 1.2,
        method,
        icmpDenied: network.icmpDenied,
      };
    },
    async fetch(url) {
      const body = DESCRIPTIONS[url];
      return body === undefined
        ? { ok: false, status: 404, text: async () => '' }
        : { ok: true, status: 200, text: async () => body };
    },
  };
  return network;
}

/** A manual clock; `sleep` moves it forward instead of waiting. */
export function createClock(start = 1_700_000_000_000) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
    async sleep(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {object} [options.network] from createNetwork
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {object} [options.saved] content of /data/hosts.json before the start
 * @param {Array|null} [options.ssdp] raw SSDP results, null: no capture declared
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  config = {},
  network = createNetwork(),
  devices = [],
  saved,
  ssdp = SSDP_RESULTS,
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-ping-wol-')),
} = {}) {
  const gladys = createFakeGladys({
    config,
    devices,
    scanResults: ssdp === null ? {} : { ssdp },
  });
  const store = new Store(dataDir);
  if (saved) {
    await store.save(saved);
    await store.flush();
  }
  const clock = createClock();
  const app = registerHandlers(gladys, {
    store,
    probe: network.probe,
    fetch: network.fetch,
    timers: false,
    now: clock.now,
    sleep: clock.sleep,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    await app.monitor.running;
  }
  return { gladys, fake: gladys.fake, app, monitor: app.monitor, network, clock, store, dataDir };
}

/** Run the "Add or update a host" action; resolves with the ack. */
export const addHost = (world, fields) => world.fake.action('add_host', fields);

/** The device published for a host name, from the last discovery list. */
export const discovered = (world, name) =>
  world.fake.discoveredDevices.find((device) => device.name === name);

/** Create the device of a host in Gladys, as the user would. */
export async function create(world, name) {
  const device = discovered(world, name);
  if (!device) {
    throw new Error(`${name} is not in the discovered devices`);
  }
  await world.fake.deviceCreated(device);
  return device;
}

/** External id of one feature of a device. */
export const featureId = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`))?.external_id;

/** Wake-on-LAN requests the core received. */
export const wakes = (world) =>
  world.fake.requests
    .filter((r) => r.path === '/network/wake' && r.status === 200)
    .map((r) => r.body);
