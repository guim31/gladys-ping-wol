// -----------------------------------------------------------------------------
// The monitored hosts: validation of what the user types in the "Add a host"
// action, and the identity of each host.
//
// A host is { id, name, address, mac, broadcast, method, port, offlineAfter }.
// `id` is the platform id of its Gladys device (external id
// `host:<id>`): it never changes once given, whatever the user edits later
// (name, address, MAC). Hosts added by hand get a random id; hosts found by
// the network search get one derived from their MAC, else their address.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { isIPv4 } from 'node:net';

export const MAX_HOSTS = 64;
export const PROBE_METHODS = ['auto', 'icmp', 'tcp'];
// Per-host override of the configured offline delay, in seconds. Empty (the
// action applies no default) means "use the integration setting".
export const HOST_OFFLINE_DELAYS = ['0', '60', '180', '300', '600', '900', '1800'];
export const MAX_NAME_LENGTH = 60;

// A DNS name: labels of letters, digits and hyphens. `.local` (mDNS) names do
// not resolve inside the container: refused with a clear message.
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** `aa:bb:cc:dd:ee:ff` from any common notation, or null. */
export function normalizeMac(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const hex = raw
    .trim()
    .toLowerCase()
    .replace(/[\s:.-]/g, '');
  if (!/^[0-9a-f]{12}$/.test(hex)) {
    return null;
  }
  // All-zero and broadcast addresses identify nothing; a multicast address
  // (lowest bit of the first byte) is never a network card.
  if (hex === '000000000000' || hex === 'ffffffffffff' || parseInt(hex.slice(0, 2), 16) & 1) {
    return null;
  }
  return hex.match(/../g).join(':');
}

/** Lower-cased address without scheme, path or spaces, or null when invalid. */
export function normalizeAddress(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const address = raw
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/[/:].*$/, '')
    .toLowerCase();
  if (isIPv4(address)) {
    return address;
  }
  // Digits and dots only: a mistyped IP address, not a name.
  if (/^[\d.]+$/.test(address) || !HOSTNAME_PATTERN.test(address)) {
    return null;
  }
  return address;
}

export const isMdnsName = (address) => /\.local$/i.test(address);

/** Random platform id of a host added by hand. */
export const newHostId = () => `h${randomBytes(5).toString('hex')}`;

/** Platform id of a host found on the network: its MAC, else its address. */
export function discoveredHostId({ mac, address }) {
  return mac ? `m${mac.replace(/:/g, '')}` : `a${address.replace(/[^a-z0-9]/gi, '-')}`;
}

const blank = (value) => value === undefined || value === null || String(value).trim() === '';

/**
 * Validate the fields of the "Add a host" action. Every optional field may be
 * absent: the action applies no default (GladysAssistant/Gladys#3155).
 * @returns {{ host?: object, error?: string, param?: string }} `error` is a
 *   key of ERRORS (src/messages.js), `param` the offending value.
 */
export function parseHostFields(fields = {}) {
  const name = typeof fields.name === 'string' ? fields.name.trim().replace(/\s+/g, ' ') : '';
  if (!name) {
    return { error: 'name' };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { error: 'nameLength' };
  }
  const address = normalizeAddress(fields.address);
  if (!address) {
    return { error: 'address', param: String(fields.address ?? '') };
  }
  if (isMdnsName(address)) {
    return { error: 'mdns', param: address };
  }
  let mac = null;
  if (!blank(fields.mac)) {
    mac = normalizeMac(fields.mac);
    if (!mac) {
      return { error: 'mac', param: String(fields.mac) };
    }
  }
  let broadcast = null;
  if (!blank(fields.broadcast)) {
    broadcast = String(fields.broadcast).trim();
    if (!isIPv4(broadcast)) {
      return { error: 'broadcast', param: broadcast };
    }
  }
  const method = PROBE_METHODS.includes(fields.method) ? fields.method : 'auto';
  let port = null;
  if (!blank(fields.port)) {
    port = Number(fields.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { error: 'port', param: String(fields.port) };
    }
  }
  if (method === 'tcp' && port === null) {
    return { error: 'tcpPort' };
  }
  const offlineAfter = HOST_OFFLINE_DELAYS.includes(String(fields.offline_after))
    ? Number(fields.offline_after)
    : null;
  return { host: { name, address, mac, broadcast, method, port, offlineAfter } };
}

/**
 * A host read back from /data: same checks as the action, the id kept.
 * Returns null for an entry that cannot be used.
 */
export function restoreHost(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id) {
    return null;
  }
  const { host } = parseHostFields({
    name: entry.name,
    address: entry.address,
    mac: entry.mac ?? undefined,
    broadcast: entry.broadcast ?? undefined,
    method: entry.method,
    port: entry.port ?? undefined,
    offline_after: entry.offlineAfter ?? undefined,
  });
  return host ? { id: entry.id, ...host } : null;
}

/** The host matching a name or an address typed by the user, if any. */
export function findHost(hosts, query) {
  if (typeof query !== 'string' || !query.trim()) {
    return undefined;
  }
  const wanted = query.trim().toLowerCase();
  const address = normalizeAddress(query);
  return (
    hosts.find((host) => host.name.toLowerCase() === wanted) ??
    hosts.find((host) => address && host.address === address)
  );
}
