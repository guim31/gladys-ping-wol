// -----------------------------------------------------------------------------
// One Gladys device per monitored host.
//
// Features (couples checked against the Gladys front, v5.2.0):
//   - online   presence-sensor/binary, read only: the green "presence
//              detected" / red "no presence" badge, a Yes/No condition in scenes;
//   - latency  duration/decimal in milliseconds, read only (average round trip);
//   - wake     button/push, only when a MAC address is known: the "Push" button
//              of the dashboard sends 1, the integration sends the magic packet.
//              Not a switch: "off" could do nothing, and a switch would show a
//              state Wake-on-LAN cannot know.
//
// Published with should_poll: false: the scheduler runs in the container
// (src/monitor.js), at the interval of the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'host';
export const FEATURE_KEYS = { ONLINE: 'online', LATENCY: 'latency', WAKE: 'wake' };

// The slowest answer a probe can measure stays far below this bound (ICMP
// waits 1 s per reply, TCP 1.5 s): display bounds of the history chart.
export const MAX_LATENCY_MS = 5000;

// Feature names, frozen at creation in Gladys (language of the configuration).
export const NAMES = {
  en: { online: 'Online', latency: 'Latency', wake: 'Wake up' },
  fr: { online: 'En ligne', latency: 'Latence', wake: 'Allumer' },
  de: { online: 'Online', latency: 'Latenz', wake: 'Aufwecken' },
  es: { online: 'En línea', latency: 'Latencia', wake: 'Encender' },
};

export const MODELS = { ping: 'Ping', wol: 'Ping + Wake-on-LAN' };

/** External ids of a host device and of its features. */
export function hostIds(gladys, hostId) {
  const ids = gladys.externalIds(DEVICE_TYPE, hostId);
  return {
    device: ids.device,
    online: ids.feature(FEATURE_KEYS.ONLINE),
    latency: ids.feature(FEATURE_KEYS.LATENCY),
    wake: ids.feature(FEATURE_KEYS.WAKE),
  };
}

/** The platform id of a host device, from its external id (null if not ours). */
export function hostIdOf(gladys, externalId) {
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const rest = externalId.slice(prefix.length);
  return rest.split(':')[0] || null;
}

/**
 * The discovery payload of a host.
 * @param {object} gladys
 * @param {object} host see src/hosts.js
 * @param {string} language language of the feature names
 */
export function buildDevice(gladys, host, language = 'en') {
  const ids = hostIds(gladys, host.id);
  const names = NAMES[language] ?? NAMES.en;
  const features = [
    {
      name: names.online,
      external_id: ids.online,
      category: DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: 1,
    },
    {
      name: names.latency,
      external_id: ids.latency,
      category: DEVICE_FEATURE_CATEGORIES.DURATION,
      type: DEVICE_FEATURE_TYPES.DURATION.DECIMAL,
      unit: DEVICE_FEATURE_UNITS.MILLISECONDS,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: MAX_LATENCY_MS,
    },
  ];
  if (host.mac) {
    features.push({
      name: names.wake,
      external_id: ids.wake,
      category: DEVICE_FEATURE_CATEGORIES.BUTTON,
      type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
      read_only: false,
      has_feedback: false,
      keep_history: false,
      min: 0,
      max: 1,
    });
  }
  const params = [{ name: 'ADDRESS', value: host.address }];
  if (host.mac) {
    params.push({ name: 'MAC', value: host.mac });
  }
  return {
    name: host.name,
    external_id: ids.device,
    model: host.mac ? MODELS.wol : MODELS.ping,
    should_poll: false,
    params,
    features,
  };
}
