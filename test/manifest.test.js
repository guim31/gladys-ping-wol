// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CHECK_INTERVALS,
  DEFAULT_CONFIG,
  LANGUAGES,
  OFFLINE_DELAYS,
  WAKE_TIMEOUTS,
} from '../src/config.js';
import { SSDP_SEARCH_TARGET } from '../src/discovery.js';
import { HOST_OFFLINE_DELAYS, PROBE_METHODS } from '../src/hosts.js';
import { WAKE_FAILED_TRIGGER, WIDGET_KEY } from '../src/monitor.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { addHost, create, createNetwork, createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The handlers the integration actually registers on the SDK.
const { gladys: registered, app } = await createWorld({ connect: false });
await app.stop();
const handlerKeys = (prefix) =>
  Object.keys(registered.handlers)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionValues = (field) => field.options.map((option) => option.value);
const field = (list, key) => list.find((entry) => entry.key === key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

test('identity: name, image, cover, local transport, network category', () => {
  assert.equal(manifest.name, 'Ping & Wake-on-LAN');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-ping-wol:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-ping-wol/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['network']);
});

test('the core contracts the code uses are declared: Wake-on-LAN and the SSDP capture', () => {
  assert.equal(manifest.network_wake, true);
  assert.deepEqual(manifest.network_discovery, [{ type: 'ssdp', st: SSDP_SEARCH_TARGET }]);
});

test('Gladys 5.1.0 at least: widgets, scene triggers and actions, Wake-on-LAN, SSDP', () => {
  const [major, minor] = minGladysVersion();
  assert.ok(major > 5 || (major === 5 && minor >= 1), manifest.gladys_version);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), handlerKeys('action:').sort());
});

test('every scene action has a handler, and its outputs are the declared ones', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.deepEqual(handlerKeys('sceneAction:').sort(), keysOf(manifest.scene_actions).sort());
  const world = await createWorld({
    network: createNetwork({ '192.0.2.20': { reachable: true, latency: 2 } }),
  });
  t.after(() => world.app.stop());
  await addHost(world, { name: 'PC', address: '192.0.2.20', mac: '64:e4:d5:b4:12:66' });
  const device = await create(world, 'PC');
  const results = {
    wake_device: await world.fake.sceneAction('wake_device', {
      device: device.external_id,
      wait: true,
    }),
    check_address: await world.fake.sceneAction('check_address', { address: '192.0.2.20' }),
  };
  for (const action of manifest.scene_actions) {
    assert.equal(results[action.key].success, true, action.key);
    assert.deepEqual(
      Object.keys(results[action.key].data.outputs).sort(),
      keysOf(action.outputs).sort(),
      `${action.key} outputs`,
    );
    // "Continue only if" compares with ===: numbers, never booleans.
    for (const output of action.outputs) {
      assert.notEqual(output.type, 'boolean', `${action.key}.${output.key}`);
    }
  }
});

test('the scene trigger the monitor fires is declared, with its filter and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers), [WAKE_FAILED_TRIGGER]);
  const world = await createWorld({ config: { wake_timeout: '60' } });
  t.after(() => world.app.stop());
  await addHost(world, { name: 'PC', address: '192.0.2.20', mac: '64:e4:d5:b4:12:66' });
  const device = await create(world, 'PC');
  await world.fake.sceneAction('wake_device', { device: device.external_id });
  world.clock.advance(60_000);
  await world.monitor.runWakeChecks();
  const [event] = world.fake.sceneEvents;
  assert.equal(event.key, WAKE_FAILED_TRIGGER);
  const [trigger] = manifest.scene_triggers;
  for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
    assert.ok(key in event.data, `"${key}" is in the event data`);
  }
  assert.equal(event.data.device, device.external_id, 'the device filter matches the select value');
});

test('every widget has its handlers, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widget:'), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widgetAction:'), [WIDGET_KEY]);
});

test('config_schema defaults and options are the ones of the code', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, entry.key);
    }
  }
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((entry) => entry.type !== 'section')
      .map((entry) => entry.key)
      .sort(),
  );
  assert.deepEqual(optionValues(field(manifest.config_schema, 'language')), LANGUAGES);
  assert.deepEqual(optionValues(field(manifest.config_schema, 'check_interval')), CHECK_INTERVALS);
  assert.deepEqual(optionValues(field(manifest.config_schema, 'offline_after')), OFFLINE_DELAYS);
  assert.deepEqual(optionValues(field(manifest.config_schema, 'wake_timeout')), WAKE_TIMEOUTS);
  const addFields = field(manifest.actions, 'add_host').fields;
  assert.deepEqual(optionValues(field(addFields, 'method')), PROBE_METHODS);
  assert.deepEqual(optionValues(field(addFields, 'offline_after')), HOST_OFFLINE_DELAYS);
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((entry) => entry.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare the devices source and no static options', () => {
  const dynamic = allFields.filter((entry) => entry.source !== undefined);
  assert.ok(dynamic.length >= 3);
  for (const entry of dynamic) {
    assert.equal(entry.source, 'devices');
    assert.equal(entry.options, undefined, entry.key);
  }
});

test('number fields have integer bounds (the form has no step)', () => {
  for (const entry of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (entry[key] !== undefined) {
        assert.ok(Number.isInteger(entry[key]), `${entry.key}.${key}`);
      }
    }
  }
});

test('actions: no secret field, no default (the core applies none to actions)', () => {
  // GladysAssistant/Gladys#3154 and #3155.
  for (const action of manifest.actions) {
    for (const entry of action.fields ?? []) {
      assert.notEqual(entry.type, 'secret', `${action.key}.${entry.key}`);
      assert.equal(entry.default, undefined, `${action.key}.${entry.key}`);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
