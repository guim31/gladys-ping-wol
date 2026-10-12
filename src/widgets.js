// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `hosts`.
//
// The device box already shows one host. The widget shows several at a
// glance — a status line per host (online with its latency, offline, starting
// up after a wake) — and a "Wake" button for each offline host that has a MAC
// address. Budget (8 components, 1 status, 4 buttons): one status list of 10
// hosts at most, 4 wake buttons at most, and a text when there is nothing to
// show.
//
// Button keys are numbered (`wake_1`…): the core drops a button whose action
// key is already taken. The host travels in `params`, which the core echoes
// from the content, never from the request.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './monitor.js';

export const MAX_STATUS_ITEMS = 10;
export const MAX_BUTTONS = 4;
export const TTL_SECONDS = 30;
const BUTTON_PREFIX = 'wake_';
const MAX_BUTTON_LABEL = 24;

export const TEXT = {
  empty: {
    en: 'No host yet: add one in the configuration of the Ping & Wake-on-LAN integration.',
    fr: "Aucun hôte pour l'instant : ajoutez-en un dans la configuration de l'intégration Ping & Wake-on-LAN.",
    de: 'Noch kein Host: Füge einen in der Konfiguration der Integration Ping & Wake-on-LAN hinzu.',
    es: 'Aún no hay equipos: añada uno en la configuración de la integración Ping & Wake-on-LAN.',
  },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  unknown: {
    en: 'Not checked yet',
    fr: 'Pas encore testé',
    de: 'Noch nicht geprüft',
    es: 'Aún sin comprobar',
  },
  starting: { en: 'Starting', fr: 'Démarrage', de: 'Startet', es: 'Arrancando' },
  wake: { en: 'Wake', fr: 'Allumer', de: 'Wecken', es: 'Encender' },
  sent: {
    en: 'Wake-on-LAN sent to ',
    fr: 'Wake-on-LAN envoyé à ',
    de: 'Wake-on-LAN gesendet an ',
    es: 'Wake-on-LAN enviado a ',
  },
  gone: {
    en: 'This host is no longer in the list.',
    fr: "Cet hôte n'est plus dans la liste.",
    de: 'Dieser Host ist nicht mehr in der Liste.',
    es: 'Este equipo ya no está en la lista.',
  },
};

const t = (text, language) => text[language] ?? text.en;

/** Status value of one host, e.g. "Online · 2.4 ms" (40 characters at most). */
export function statusValue(view, language) {
  if (view.waking !== null) {
    return {
      value: `${t(TEXT.starting, language)}… ${view.waking} s`,
      color: WIDGET_COLORS.WARNING,
    };
  }
  if (view.online === true) {
    const latency = view.latency === null ? '' : ` · ${view.latency} ms`;
    return { value: `${t(TEXT.online, language)}${latency}`, color: WIDGET_COLORS.SUCCESS };
  }
  if (view.online === false) {
    return { value: t(TEXT.offline, language), color: WIDGET_COLORS.DANGER };
  }
  return { value: t(TEXT.unknown, language), color: WIDGET_COLORS.NEUTRAL };
}

function buttonLabel(name, language) {
  const label = `${t(TEXT.wake, language)} ${name}`;
  return label.length <= MAX_BUTTON_LABEL ? label : `${label.slice(0, MAX_BUTTON_LABEL - 1)}…`;
}

/** The hosts a widget instance shows: the chosen ones, else every created host. */
function selectedHosts(monitor, settings) {
  const created = monitor.monitoredHosts();
  const chosen = Array.isArray(settings?.devices) ? settings.devices : [];
  if (chosen.length === 0) {
    return created.slice(0, MAX_STATUS_ITEMS);
  }
  const byDevice = new Map(created.map((host) => [monitor.deviceIdOf(host), host]));
  return chosen
    .map((externalId) => byDevice.get(externalId))
    .filter(Boolean)
    .slice(0, MAX_STATUS_ITEMS);
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(monitor, { settings, language = 'en' }) {
      const hosts = selectedHosts(monitor, settings);
      if (hosts.length === 0) {
        return {
          ttl_seconds: TTL_SECONDS,
          components: [{ type: 'text', variant: 'body', text: t(TEXT.empty, language) }],
        };
      }
      const views = hosts.map((host) => monitor.view(host));
      const components = [
        {
          type: 'status',
          items: views.map((view) => ({
            label: view.name.slice(0, 40),
            ...statusValue(view, language),
          })),
        },
      ];
      views
        .filter((view) => view.mac && view.online !== true && view.waking === null)
        .slice(0, MAX_BUTTONS)
        .forEach((view, index) => {
          components.push({
            type: 'button',
            label: buttonLabel(view.name, language),
            icon: 'power',
            style: 'secondary',
            action: { key: `${BUTTON_PREFIX}${index + 1}`, params: { host: view.id } },
          });
        });
      return { ttl_seconds: TTL_SECONDS, components };
    },

    async action(monitor, { actionKey, params }) {
      const host = actionKey.startsWith(BUTTON_PREFIX)
        ? monitor.hosts.get(params?.host)
        : undefined;
      if (!host) {
        return TEXT.gone;
      }
      await monitor.wake(host);
      return Object.fromEntries(
        Object.entries(TEXT.sent).map(([language, start]) => [language, `${start}${host.name}`]),
      );
    },
  },
};
