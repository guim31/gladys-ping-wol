// -----------------------------------------------------------------------------
// The monitor: the list of hosts, their probes, the states published to Gladys,
// Wake-on-LAN and the network search. Everything the SDK handlers, the scene
// actions and the widget need goes through it (src/app.js wires it).
//
// Scheduling: the devices are published with should_poll: false and the
// monitor checks every created host at the configured interval, a few at a
// time. A host just woken is checked every few seconds until it answers or
// its wake timeout ends (then `wake_failed` fires).
//
// States: `publishChangedStates` sends only what changed, plus a heartbeat
// every 12 hours so a stable host never shows "no recent value" (the front's
// default threshold is 48 hours). The latency is published again only when it
// moves noticeably (20 %, 1 ms at least): a LAN round trip jitters by a few
// tenths of a millisecond at every check, which would fill the history and
// spend the 300 states per minute of the core for nothing.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { buildDevice, hostIdOf, hostIds } from './devices.js';
import {
  SCAN_TIMEOUT_SECONDS,
  candidateName,
  describeCandidates,
  ssdpCandidates,
} from './discovery.js';
import {
  MAX_HOSTS,
  findHost,
  newHostId,
  normalizeAddress,
  parseHostFields,
  restoreHost,
} from './hosts.js';
import { ERRORS, ICMP_DENIED, REPORTS, WAKE_ERRORS, join, render } from './messages.js';
import { createProbe } from './probe.js';

const logger = createLogger({ name: 'ping-wol' });

export const WIDGET_KEY = 'hosts';
export const WAKE_FAILED_TRIGGER = 'wake_failed';

export const DEFAULT_TIMINGS = {
  // Hosts checked at the same time.
  concurrency: 8,
  // Check interval of a host just woken.
  wakeCheckMs: 5000,
  // A magic packet is sent again this often while the host stays silent.
  wakeResendMs: 30000,
  // The core accepts one wake every 2 seconds per integration.
  wakeSpacingMs: 2100,
  heartbeatMs: 12 * 60 * 60 * 1000,
  // requestWidgetRefresh is rate-limited to one call every 10 s by the core.
  widgetRefreshMs: 10000,
};

const LATENCY_MIN_CHANGE_MS = 1;
const LATENCY_MIN_CHANGE_RATIO = 0.2;

export class GladysError extends Error {
  /** An error whose message is a multi-language object (shown in Gladys). */
  constructor(message, language = 'en') {
    super(message[language] ?? message.en);
    this.messages = message;
  }
}

export class Monitor {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK fake)
   * @param {object} options.store see src/store.js
   * @param {Function} [options.probe] `(target) => Promise<result>` (src/probe.js)
   * @param {Function} [options.fetch] fetch, for the UPnP descriptions
   * @param {boolean} [options.timers] false: no background timer (tests drive the cycles)
   * @param {Function} [options.now] clock in ms
   * @param {Function} [options.sleep] `(ms) => Promise`
   * @param {object} [options.timings] overrides of DEFAULT_TIMINGS
   */
  constructor({ gladys, store, probe, fetch: fetchImpl, timers = true, now, sleep, timings }) {
    this.gladys = gladys;
    this.store = store;
    this.probeHost = probe ?? createProbe().probe;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.timers = timers;
    this.now = now ?? (() => Date.now());
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.config = null;
    this.hosts = new Map();
    this.candidates = new Map();
    this.status = new Map();
    this.icmpDenied = false;
    this.cycleTimer = null;
    this.wakeTimer = null;
    this.running = null;
    this.wakeQueue = Promise.resolve();
    this.lastWakeAt = -Infinity;
    this.lastRefreshAt = -Infinity;
    this.refreshTimer = null;
    this.stopped = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    const saved = await this.store.load();
    for (const entry of Array.isArray(saved.hosts) ? saved.hosts : []) {
      const host = restoreHost(entry);
      if (host && this.hosts.size < MAX_HOSTS) {
        this.hosts.set(host.id, host);
      }
    }
    this.restoreFromGladys();
    await this.publishDiscovered();
    await this.gladys.setConnectionStatus(true);
    this.schedule();
    this.runCycle();
  }

  /** Reconnection: Gladys may have restarted, publish everything again. */
  async resync(config) {
    this.config = config;
    this.restoreFromGladys();
    await this.publishDiscovered();
    await this.gladys.setConnectionStatus(true, this.icmpDenied ? ICMP_DENIED : undefined);
    this.gladys.forgetPublishedStates?.();
    await this.publishStates(this.monitoredHosts());
    this.requestRefresh();
  }

  async reconfigure(config) {
    this.config = config;
    // The language of the feature names applies to the devices created from now on.
    await this.publishDiscovered();
    this.schedule();
    this.requestRefresh();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.cycleTimer);
    clearInterval(this.wakeTimer);
    clearTimeout(this.refreshTimer);
    this.cycleTimer = null;
    this.wakeTimer = null;
    await this.running?.catch(() => {});
    await this.store.flush();
  }

  schedule() {
    if (!this.timers || this.stopped) {
      return;
    }
    clearInterval(this.cycleTimer);
    this.cycleTimer = setInterval(() => this.runCycle(), this.config.checkInterval * 1000);
    this.cycleTimer.unref?.();
    if (!this.wakeTimer) {
      this.wakeTimer = setInterval(() => this.runWakeChecks(), this.timings.wakeCheckMs);
      this.wakeTimer.unref?.();
    }
  }

  /**
   * Hosts already created in Gladys but missing from /data (file lost): rebuilt
   * from their device, so they keep being checked.
   */
  restoreFromGladys() {
    for (const device of this.gladys.devices ?? []) {
      const id = hostIdOf(this.gladys, device.external_id);
      if (!id || this.hosts.has(id) || this.hosts.size >= MAX_HOSTS) {
        continue;
      }
      const param = (name) => device.params?.find((p) => p.name === name)?.value;
      const host = restoreHost({
        id,
        name: device.name,
        address: param('ADDRESS'),
        mac: param('MAC'),
      });
      if (host) {
        this.hosts.set(id, host);
        this.save();
      }
    }
  }

  save() {
    return this.store.save({ version: 1, hosts: [...this.hosts.values()] });
  }

  // --- Discovery ---------------------------------------------------------------

  /** The hosts of the list, then the network candidates not already listed. */
  discoveredDevices() {
    const candidates = [...this.candidates.values()].filter(
      (candidate) => !this.isListed(candidate),
    );
    return [...this.hosts.values(), ...candidates].map((host) =>
      buildDevice(this.gladys, host, this.config.language),
    );
  }

  /** A network candidate that is already a host of the list (same id, address or MAC). */
  isListed(candidate) {
    return [...this.hosts.values()].some(
      (host) =>
        host.id === candidate.id ||
        host.address === candidate.address ||
        (candidate.mac !== null && host.mac === candidate.mac),
    );
  }

  async publishDiscovered() {
    await this.gladys.publishDiscoveredDevices(this.discoveredDevices());
  }

  /**
   * Network search (SSDP through the core). Resolves the new candidates, or
   * null when the search is unavailable (older core, refused capture).
   */
  async search() {
    let results;
    try {
      results = await this.gladys.scanNetwork('ssdp', { timeoutSeconds: SCAN_TIMEOUT_SECONDS });
    } catch (err) {
      logger.warn(`Network search unavailable: ${err.message}`);
      return null;
    }
    // Only the devices not in the list yet: their description is fetched once.
    const fresh = ssdpCandidates(results).filter((candidate) => !this.isListed(candidate));
    const described = await describeCandidates(fresh, this.fetch);
    this.candidates = new Map(
      described.map((candidate) => [
        candidate.id,
        {
          id: candidate.id,
          name: candidateName(candidate),
          address: candidate.address,
          mac: candidate.mac,
          broadcast: null,
          method: 'auto',
          port: null,
          offlineAfter: null,
        },
      ]),
    );
    await this.publishDiscovered();
    return [...this.candidates.values()];
  }

  // --- Configuration actions ---------------------------------------------------

  async addHost(fields) {
    const { host, error, param } = parseHostFields(fields);
    if (error) {
      throw new GladysError(render(ERRORS, error, { value: param }), this.config.language);
    }
    const existing =
      findHost([...this.hosts.values()], host.name) ??
      findHost([...this.hosts.values()], host.address);
    if (!existing && this.hosts.size >= MAX_HOSTS) {
      throw new GladysError(render(ERRORS, 'tooMany', { max: MAX_HOSTS }), this.config.language);
    }
    const saved = { id: existing?.id ?? newHostId(), ...host };
    this.hosts.set(saved.id, saved);
    // A new address or method: start again from an unknown state.
    if (existing && (existing.address !== saved.address || existing.method !== saved.method)) {
      this.status.delete(saved.id);
    }
    await this.save();
    await this.publishDiscovered();

    const result = await this.probeHost(saved);
    this.noteIcmp(result);
    const created = this.isCreated(saved.id);
    if (created) {
      await this.applyResult(saved, result);
    }
    const parts = [
      render(REPORTS, existing ? 'updated' : 'added', { name: saved.name }),
      result.reachable
        ? render(REPORTS, 'answers', {
            latency: result.latency ?? '?',
            method: result.method === 'icmp' ? 'ICMP' : 'TCP',
          })
        : render(REPORTS, 'silent'),
    ];
    if (!created) {
      parts.push(render(REPORTS, 'discovery'));
    }
    return join(...parts);
  }

  async removeHost(fields) {
    const query = typeof fields?.host === 'string' ? fields.host.trim() : '';
    const host = findHost([...this.hosts.values()], query);
    if (!host) {
      throw new GladysError(render(REPORTS, 'notFound', { query }), this.config.language);
    }
    this.hosts.delete(host.id);
    this.status.delete(host.id);
    await this.save();
    await this.publishDiscovered();
    this.requestRefresh();
    return join(
      render(REPORTS, 'removed', { name: host.name }),
      render(REPORTS, 'hosts', { count: this.hosts.size }),
    );
  }

  async searchReport() {
    const found = await this.search();
    if (found === null) {
      return render(REPORTS, 'searchUnavailable');
    }
    if (found.length === 0) {
      return render(REPORTS, 'foundNone');
    }
    const list = found
      .slice(0, 8)
      .map((candidate) =>
        candidate.name === candidate.address
          ? candidate.address
          : `${candidate.name} (${candidate.address})`,
      )
      .join(', ');
    return join(
      render(REPORTS, 'found', {
        count: found.length,
        withMac: found.filter((candidate) => candidate.mac).length,
      }),
      Object.fromEntries(Object.keys(REPORTS).map((language) => [language, `${list}.`])),
      render(REPORTS, 'toDiscovery'),
    );
  }

  // --- Gladys events -----------------------------------------------------------

  deviceIdOf(host) {
    return hostIds(this.gladys, host.id).device;
  }

  isCreated(hostId) {
    const id = hostIds(this.gladys, hostId).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  /** The hosts whose device exists in Gladys: the ones worth checking. */
  monitoredHosts() {
    return [...this.hosts.values()].filter((host) => this.isCreated(host.id));
  }

  async onDeviceCreated(device) {
    const id = hostIdOf(this.gladys, device.external_id);
    if (!id) {
      return;
    }
    const candidate = this.candidates.get(id);
    if (!this.hosts.has(id) && candidate) {
      // Created from the network search: it joins the list for good.
      this.hosts.set(id, candidate);
      this.candidates.delete(id);
      await this.save();
    }
    const host = this.hosts.get(id);
    if (!host) {
      return;
    }
    // The SDK forgot the states of the device: everything is published again.
    if (!this.status.get(id)?.checked) {
      const result = await this.probeHost(host);
      this.noteIcmp(result);
      await this.applyResult(host, result);
    } else {
      await this.publishStates([host]);
    }
    this.requestRefresh();
  }

  async setValue(device, feature) {
    const id = hostIdOf(this.gladys, device.external_id);
    const host = id ? this.hosts.get(id) : undefined;
    if (!host || feature.external_id !== hostIds(this.gladys, id).wake) {
      throw new GladysError(render(WAKE_ERRORS, 'unknown'), this.config.language);
    }
    // Every value is a press: the button/push feature only ever sends 1.
    await this.wake(host);
  }

  /** onPoll fallback: should_poll is false, but a Gladys polling anyway gets an answer. */
  async poll(device) {
    const id = hostIdOf(this.gladys, device.external_id);
    const host = id ? this.hosts.get(id) : undefined;
    if (host) {
      await this.check(host);
    }
  }

  // --- Probing -----------------------------------------------------------------

  runCycle() {
    if (this.running || this.stopped) {
      return this.running;
    }
    this.running = this.cycle()
      .catch((err) => logger.error('Check cycle failed', err))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  /** Check every created host, a few at a time, then publish what changed. */
  async cycle() {
    const hosts = this.monitoredHosts();
    let next = 0;
    const worker = async () => {
      while (next < hosts.length) {
        const host = hosts[next];
        next += 1;
        const result = await this.probeHost(host);
        this.noteIcmp(result);
        this.updateStatus(host, result);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.timings.concurrency, hosts.length) }, worker),
    );
    await this.publishStates(hosts);
  }

  async check(host) {
    const result = await this.probeHost(host);
    this.noteIcmp(result);
    await this.applyResult(host, result);
    return result;
  }

  async applyResult(host, result) {
    this.updateStatus(host, result);
    await this.publishStates([host]);
  }

  statusOf(id) {
    if (!this.status.has(id)) {
      this.status.set(id, {
        checked: false,
        online: null,
        latency: null,
        publishedLatency: null,
        lastSuccess: null,
        method: null,
        since: this.now(),
        waking: null,
      });
    }
    return this.status.get(id);
  }

  /** Fold one probe result into the state of a host (offline delay included). */
  updateStatus(host, result) {
    const status = this.statusOf(host.id);
    const now = this.now();
    const wasOnline = status.online;
    status.checked = true;
    if (result.reachable === true) {
      status.online = true;
      status.lastSuccess = now;
      status.latency = result.latency;
      status.method = result.method;
      if (
        result.latency !== null &&
        (status.publishedLatency === null ||
          Math.abs(result.latency - status.publishedLatency) >=
            Math.max(LATENCY_MIN_CHANGE_MS, status.publishedLatency * LATENCY_MIN_CHANGE_RATIO))
      ) {
        status.publishedLatency = result.latency;
      }
      if (status.waking) {
        this.finishWake(host, status, true);
      }
    } else if (result.reachable === false) {
      const delay = (host.offlineAfter ?? this.config.offlineAfter) * 1000;
      const reference = status.lastSuccess ?? status.since;
      if (now - reference >= delay) {
        status.online = false;
        status.latency = null;
      }
    }
    if (status.online !== wasOnline) {
      this.requestRefresh();
    }
    return status;
  }

  async publishStates(hosts) {
    const states = [];
    for (const host of hosts) {
      if (!this.isCreated(host.id)) {
        continue;
      }
      const status = this.status.get(host.id);
      if (!status || status.online === null) {
        continue;
      }
      const ids = hostIds(this.gladys, host.id);
      states.push({ device_feature_external_id: ids.online, state: status.online ? 1 : 0 });
      if (status.online && status.publishedLatency !== null) {
        states.push({ device_feature_external_id: ids.latency, state: status.publishedLatency });
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
    } catch (err) {
      // Sent again at the next cycle (the SDK forgets what Gladys refused).
      logger.warn(`Publishing the states failed: ${err.message}`);
    }
  }

  noteIcmp(result) {
    if (result.icmpDenied && !this.icmpDenied) {
      this.icmpDenied = true;
      logger.warn('ICMP is not allowed in this container: TCP checks only');
      this.gladys.setConnectionStatus(true, ICMP_DENIED).catch(() => {});
    }
  }

  // --- Wake-on-LAN -------------------------------------------------------------

  /** Send one magic packet through the core, one every 2 s at most. */
  sendMagicPacket(host) {
    const send = async () => {
      const wait = this.lastWakeAt + this.timings.wakeSpacingMs - this.now();
      if (wait > 0) {
        await this.sleep(wait);
      }
      const options = host.broadcast ? { address: host.broadcast } : {};
      try {
        await this.gladys.wakeOnLan(host.mac, options);
      } catch (err) {
        if (err?.status !== 429) {
          throw err;
        }
        // Another wake slipped in (the limit is per integration): once more.
        await this.sleep(this.timings.wakeSpacingMs);
        await this.gladys.wakeOnLan(host.mac, options);
      } finally {
        this.lastWakeAt = this.now();
      }
    };
    const run = this.wakeQueue.then(send, send);
    this.wakeQueue = run.catch(() => {});
    return run;
  }

  /**
   * Wake a host and follow it until it answers or its wake timeout ends.
   * Resolves once the packet is sent; `waitMs` also waits for the answer (or
   * that delay) and resolves `{ online, bootSeconds }`.
   */
  async wake(host, { waitMs = 0 } = {}) {
    if (!host.mac) {
      throw new GladysError(
        render(WAKE_ERRORS, 'noMac', { name: host.name }),
        this.config.language,
      );
    }
    const status = this.statusOf(host.id);
    await this.sendMagicPacket(host);
    const now = this.now();
    if (!status.waking) {
      status.waking = {
        since: now,
        deadline: now + this.config.wakeTimeout * 1000,
        resendAt: now + this.timings.wakeResendMs,
        waiters: [],
      };
      this.requestRefresh();
    }
    if (waitMs <= 0) {
      return null;
    }
    const waking = status.waking;
    return new Promise((resolve) => {
      const waiter = {
        resolve,
        // Resolved by the wake checks once this delay is over.
        until: now + waitMs,
      };
      waking.waiters.push(waiter);
    });
  }

  /** Fast checks of the hosts being woken (every few seconds). */
  async runWakeChecks() {
    const waking = [...this.hosts.values()].filter((host) => this.status.get(host.id)?.waking);
    await Promise.all(waking.map((host) => this.wakeCheck(host)));
  }

  async wakeCheck(host) {
    const status = this.status.get(host.id);
    if (!status?.waking) {
      return;
    }
    const result = await this.probeHost(host);
    this.noteIcmp(result);
    this.updateStatus(host, result);
    if (status.waking) {
      const now = this.now();
      const { waking } = status;
      // Waiters whose own delay is over get "not yet" (the follow-up continues).
      waking.waiters = waking.waiters.filter((waiter) => {
        if (now >= waiter.until) {
          waiter.resolve({ online: false, bootSeconds: null });
          return false;
        }
        return true;
      });
      if (now >= waking.deadline) {
        this.finishWake(host, status, false);
      } else if (now >= waking.resendAt) {
        waking.resendAt = now + this.timings.wakeResendMs;
        await this.sendMagicPacket(host).catch((err) =>
          logger.warn(`Wake-on-LAN of ${host.name} failed: ${err.message}`),
        );
      }
    }
    await this.publishStates([host]);
  }

  finishWake(host, status, online) {
    const { waking } = status;
    status.waking = null;
    const elapsed = Math.round((this.now() - waking.since) / 1000);
    for (const waiter of waking.waiters) {
      waiter.resolve({ online, bootSeconds: online ? elapsed : null });
    }
    if (!online) {
      logger.info(`${host.name} did not answer ${elapsed} s after Wake-on-LAN`);
      this.gladys
        .publishSceneEvent(WAKE_FAILED_TRIGGER, {
          device: hostIds(this.gladys, host.id).device,
          name: host.name,
          address: host.address,
          waited_seconds: elapsed,
        })
        .catch((err) => logger.warn(`wake_failed event refused: ${err.message}`));
    }
    this.requestRefresh();
  }

  // --- Scene helpers -----------------------------------------------------------

  /** The host of a device chosen in a scene or a widget. */
  hostOfDevice(externalId) {
    const id = hostIdOf(this.gladys, externalId);
    const host = id ? this.hosts.get(id) : undefined;
    if (!host) {
      throw new GladysError(render(WAKE_ERRORS, 'unknown'), this.config.language);
    }
    return host;
  }

  /** One-off check of any address, without a device. */
  async checkAddress(rawAddress, port) {
    const address = normalizeAddress(rawAddress);
    if (!address) {
      throw new GladysError(
        render(WAKE_ERRORS, 'address', { value: String(rawAddress ?? '') }),
        this.config.language,
      );
    }
    const tcpPort =
      Number.isInteger(Number(port)) && Number(port) >= 1 && Number(port) <= 65535
        ? Number(port)
        : null;
    const result = await this.probeHost({
      address,
      method: tcpPort ? 'tcp' : 'auto',
      port: tcpPort,
    });
    this.noteIcmp(result);
    return result;
  }

  // --- Widget -------------------------------------------------------------------

  requestRefresh() {
    if (this.stopped) {
      return;
    }
    const now = this.now();
    const wait = this.lastRefreshAt + this.timings.widgetRefreshMs - now;
    if (wait <= 0) {
      this.lastRefreshAt = now;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } else if (this.timers && !this.refreshTimer) {
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.requestRefresh();
      }, wait);
      this.refreshTimer.unref?.();
    }
  }

  /** What the widget shows of one host. */
  view(host) {
    const status = this.status.get(host.id);
    return {
      id: host.id,
      name: host.name,
      mac: host.mac,
      online: status?.online ?? null,
      latency: status?.online ? status.latency : null,
      waking: status?.waking ? Math.round((this.now() - status.waking.since) / 1000) : null,
    };
  }
}
