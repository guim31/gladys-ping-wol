import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { TEXT, statusValue } from '../src/widgets.js';
import { addHost, create, createNetwork, createWorld, wakes } from './helpers/world.js';

const HOSTS = [
  { name: 'Office PC', address: '192.0.2.20', mac: '64:e4:d5:b4:12:66' },
  { name: 'NAS', address: '192.0.2.21', mac: '00:11:32:0a:0b:0c' },
  { name: 'Phone', address: '192.0.2.40' },
  {
    name: 'A very long name for a gaming computer',
    address: '192.0.2.22',
    mac: '02:00:5e:10:00:22',
  },
];

async function world(t) {
  const w = await createWorld({
    network: createNetwork({ '192.0.2.20': { reachable: true, latency: 0.84 } }),
    config: { offline_after: '0' },
  });
  t.after(() => w.app.stop());
  const devices = {};
  for (const fields of HOSTS) {
    await addHost(w, fields);
    devices[fields.name] = await create(w, fields.name);
  }
  return { ...w, devices };
}

test('one status line per host, a wake button for the offline hosts with a MAC', async (t) => {
  const w = await world(t);
  const ack = await w.fake.widgetGet('hosts', { language: 'fr' });
  const content = ack.data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  const [status, ...buttons] = content.components;
  assert.deepEqual(status.items, [
    { label: 'Office PC', value: 'En ligne · 0.84 ms', color: 'success' },
    { label: 'NAS', value: 'Hors ligne', color: 'danger' },
    { label: 'Phone', value: 'Hors ligne', color: 'danger' },
    { label: 'A very long name for a gaming computer', value: 'Hors ligne', color: 'danger' },
  ]);
  assert.deepEqual(
    buttons.map((button) => [button.label, button.action.key]),
    [
      ['Allumer NAS', 'wake_1'],
      ['Allumer A very long nam…', 'wake_2'],
    ],
  );
  assert.ok(buttons.every((button) => button.label.length <= 24));
});

test('the settings choose the hosts shown, in their order', async (t) => {
  const w = await world(t);
  const settings = {
    devices: [w.devices.Phone.external_id, w.devices['Office PC'].external_id, 'ext:other:x'],
  };
  const ack = await w.fake.widgetGet('hosts', { settings });
  assert.deepEqual(
    ack.data.content.components[0].items.map((item) => item.label),
    ['Phone', 'Office PC'],
  );
});

test('tapping a wake button wakes the host, with a toast; the host then shows as starting', async (t) => {
  const w = await world(t);
  const content = (await w.fake.widgetGet('hosts', { language: 'de' })).data.content;
  const button = content.components.find((component) => component.type === 'button');
  const ack = await w.fake.widgetAction('hosts', button.action.key, button.action.params);
  assert.equal(ack.data.message.de, 'Wake-on-LAN gesendet an NAS');
  assert.equal(wakes(w).length, 1);
  const after = (await w.fake.widgetGet('hosts', { language: 'de' })).data.content;
  assert.deepEqual(after.components[0].items[1], {
    label: 'NAS',
    value: 'Startet… 0 s',
    color: 'warning',
  });
  assert.ok(!after.components.some((component) => component.label === 'Wecken NAS'));
});

test('a stale button (host removed) answers without waking anything', async (t) => {
  const w = await world(t);
  const ack = await w.fake.widgetAction('hosts', 'wake_1', { host: 'gone' });
  assert.deepEqual(ack.data.message, TEXT.gone);
  assert.deepEqual(wakes(w), []);
});

test('no host yet: a text says where to add one', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  const ack = await w.fake.widgetGet('hosts', { language: 'es' });
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  assert.equal(ack.data.content.components[0].text, TEXT.empty.es);
});

test('at most 10 status lines and 4 buttons, within the core budget', async (t) => {
  const w = await createWorld();
  t.after(() => w.app.stop());
  for (let i = 1; i <= 12; i += 1) {
    const mac = `02:00:5e:10:01:${String(i).padStart(2, '0')}`;
    await addHost(w, { name: `Host ${i}`, address: `192.0.2.${100 + i}`, mac });
    await create(w, `Host ${i}`);
  }
  const content = (await w.fake.widgetGet('hosts')).data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].items.length, 10);
  assert.equal(content.components.filter((component) => component.type === 'button').length, 4);
});

test('status values stay within 40 characters', () => {
  for (const language of ['en', 'fr', 'de', 'es']) {
    for (const view of [
      { waking: 600, online: false, latency: null },
      { waking: null, online: true, latency: 4999.99 },
      { waking: null, online: false, latency: null },
      { waking: null, online: null, latency: null },
    ]) {
      assert.ok(statusValue(view, language).value.length <= 40);
    }
  }
});
