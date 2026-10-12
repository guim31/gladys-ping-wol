// -----------------------------------------------------------------------------
// Network search: hosts that announce themselves over UPnP/SSDP (TVs, NAS,
// media servers, routers, printers, game consoles, Windows PCs with network
// discovery on), proposed in the Discovery tab without typing anything.
//
// The integration container sits on a bridge network and never sees SSDP: the
// core sends the M-SEARCH and relays the raw answers (mediated discovery,
// manifest `network_discovery`). The core adds `source_mac` when its ARP table
// knows the responder (best effort): the Wake-on-LAN button then comes for
// free. The friendly name is read from the UPnP description each device
// serves over HTTP (unicast crosses the bridge), only when it is served by
// the very address that answered.
// -----------------------------------------------------------------------------

import { isIPv4 } from 'node:net';
import { discoveredHostId, normalizeMac } from './hosts.js';

export const SSDP_SEARCH_TARGET = 'ssdp:all';
export const SCAN_TIMEOUT_SECONDS = 5;
export const MAX_CANDIDATES = 32;
const DESCRIPTION_TIMEOUT_MS = 2000;
const DESCRIPTION_MAX_BYTES = 64 * 1024;
const DESCRIPTION_CONCURRENCY = 4;

/** Headers of one raw SSDP answer, keys lower-cased. */
export function parseSsdpHeaders(text) {
  const headers = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0) {
      const key = line.slice(0, at).trim().toLowerCase();
      if (!(key in headers)) {
        headers[key] = line.slice(at + 1).trim();
      }
    }
  }
  return headers;
}

/** The description URL, only when the answering address serves it. */
function sameHostLocation(location, address) {
  try {
    const url = new URL(location);
    return url.protocol === 'http:' && url.hostname === address ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * One candidate per answering address, from `scanNetwork('ssdp')`.
 * @param {Array<{ source_ip: string, source_mac?: string, headers: string }>} results
 * @returns {Array<{ id, address, mac, location }>}
 */
export function ssdpCandidates(results) {
  const byAddress = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const address = result?.source_ip;
    if (typeof address !== 'string' || !isIPv4(address)) {
      continue;
    }
    const headers = parseSsdpHeaders(result.headers);
    const known = byAddress.get(address);
    const mac = normalizeMac(result.source_mac ?? '');
    const location = headers.location ? sameHostLocation(headers.location, address) : null;
    if (known) {
      // Several services per device: keep the first description found, and a MAC.
      known.location ??= location;
      known.mac ??= mac;
      continue;
    }
    if (byAddress.size >= MAX_CANDIDATES) {
      continue;
    }
    byAddress.set(address, { address, mac, location });
  }
  return [...byAddress.values()].map((candidate) => ({
    id: discoveredHostId(candidate),
    ...candidate,
  }));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      if (entity[0] === '#') {
        const code =
          entity[1] === 'x' || entity[1] === 'X'
            ? parseInt(entity.slice(2), 16)
            : Number(entity.slice(1));
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : '';
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/[\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** friendlyName, manufacturer and modelName of the root device of a description. */
export function parseDescription(xml) {
  const read = (tag) => {
    const match = String(xml ?? '').match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
    const value = match ? decodeXml(match[1]) : '';
    return value || null;
  };
  return {
    friendlyName: read('friendlyName'),
    manufacturer: read('manufacturer'),
    modelName: read('modelName'),
  };
}

/**
 * Fetch one description, bounded in time and size.
 * @param {Function} fetchImpl
 */
export async function fetchDescription(fetchImpl, location) {
  const response = await fetchImpl(location, {
    signal: AbortSignal.timeout(DESCRIPTION_TIMEOUT_MS),
    redirect: 'error',
  });
  if (!response.ok) {
    return null;
  }
  const text = await response.text();
  return parseDescription(text.slice(0, DESCRIPTION_MAX_BYTES));
}

/** Name shown in the Discovery tab: the UPnP friendly name, else the model, else the address. */
export function candidateName(candidate) {
  const description = candidate.description ?? {};
  const model = [description.manufacturer, description.modelName].filter(Boolean).join(' ');
  return (description.friendlyName || model || candidate.address).slice(0, 60);
}

/**
 * Add the description of each candidate, a few at a time; a failure leaves
 * the candidate without one.
 */
export async function describeCandidates(candidates, fetchImpl) {
  let next = 0;
  const worker = async () => {
    while (next < candidates.length) {
      const candidate = candidates[next];
      next += 1;
      if (!candidate.location) {
        continue;
      }
      try {
        candidate.description = await fetchDescription(fetchImpl, candidate.location);
      } catch {
        candidate.description = null;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(DESCRIPTION_CONCURRENCY, candidates.length) }, worker),
  );
  return candidates;
}
