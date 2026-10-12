// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Select values are strings in the manifest (stored by Gladys as typed); the
// normalized config holds numbers, in seconds.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two checks of every host. The scheduler runs in the
// container (devices are published with should_poll: false): any value works,
// the list keeps the load and the state rate predictable.
export const CHECK_INTERVALS = ['15', '30', '60', '120', '300'];

// Seconds without any answer before a host is declared offline; 0 = at the
// first failed check. Phones asleep on Wi-Fi skip answers for minutes.
export const OFFLINE_DELAYS = ['0', '60', '180', '300', '600', '900'];

// Seconds a woken device has to answer before `wake_failed` fires.
export const WAKE_TIMEOUTS = ['60', '120', '180', '300', '600'];

export const DEFAULT_CONFIG = {
  check_interval: '30',
  offline_after: '60',
  wake_timeout: '180',
  language: 'fr',
};

const pick = (value, allowed, fallback) =>
  allowed.includes(String(value)) ? Number(value) : Number(fallback);

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    checkInterval: pick(source.check_interval, CHECK_INTERVALS, DEFAULT_CONFIG.check_interval),
    offlineAfter: pick(source.offline_after, OFFLINE_DELAYS, DEFAULT_CONFIG.offline_after),
    wakeTimeout: pick(source.wake_timeout, WAKE_TIMEOUTS, DEFAULT_CONFIG.wake_timeout),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
