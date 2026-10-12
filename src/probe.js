// -----------------------------------------------------------------------------
// Is a host answering, and how fast?
//
// ICMP: the container runs with every capability dropped (no raw socket), so
// the probe spawns iputils `ping`, which uses the unprivileged ICMP datagram
// sockets ("ping sockets") the kernel opens to the groups listed in
// net.ipv4.ping_group_range — Docker 20.10+ sets that range for its bridge
// containers. Node itself has no ICMP socket.
//
// TCP: a connection to a port. An accepted connection (SYN-ACK) or a refused
// one (RST, ECONNREFUSED) both prove the host is up; only a timeout or an
// unreachable error means no answer. It covers the hosts that filter ICMP
// (Windows firewall, some phones) and a Docker without ping sockets.
//
// The process runner and the socket factory are injected: the tests never
// touch the network.
// -----------------------------------------------------------------------------

import { spawn as spawnProcess } from 'node:child_process';
import { connect as connectSocket } from 'node:net';

export const PING_COUNT = 3;
export const TCP_TIMEOUT_MS = 1500;
// Tried together when no port is configured: web, SSH, SMB/NetBIOS, RDP, NAS
// web interfaces, Google Cast, and the iPhone sync port that answers while the
// phone sleeps. A closed port answers too (RST), unless a firewall drops it.
export const DEFAULT_TCP_PORTS = [80, 443, 22, 445, 139, 3389, 5000, 8080, 8009, 62078];

const RTT_LINE = /(?:rtt|round-trip) min\/avg\/max(?:\/mdev)? = [\d.]+\/([\d.]+)\//;
const RECEIVED = /(\d+) (?:packets )?received/;
const DENIED = /operation not permitted|permission denied|are you root/i;

/**
 * Summary of a `ping` run (iputils, BusyBox as a fallback format).
 * @returns {{ received: number, average: number|null }}
 */
export function parsePingOutput(text) {
  const received = Number(String(text).match(RECEIVED)?.[1] ?? 0);
  const average = String(text).match(RTT_LINE)?.[1];
  return { received, average: average === undefined ? null : Number(average) };
}

// Two decimals: a LAN round trip is a fraction of a millisecond.
const roundLatency = (ms) => Math.round(ms * 100) / 100;

/**
 * @param {object} [seams] test seams
 * @param {Function} [seams.spawn] child_process.spawn
 * @param {Function} [seams.connect] net.connect
 * @param {Function} [seams.now] monotonic clock in ms
 */
export function createProbe({
  spawn = spawnProcess,
  connect = connectSocket,
  now = () => performance.now(),
} = {}) {
  /**
   * @returns {Promise<{ status: 'reply'|'noreply'|'denied'|'error', latency?: number }>}
   */
  function icmp(address, count = PING_COUNT) {
    return new Promise((resolve) => {
      let output = '';
      let settled = false;
      let guard = null;
      const done = (result) => {
        if (!settled) {
          settled = true;
          clearTimeout(guard);
          resolve(result);
        }
      };
      let child;
      try {
        // -n: no reverse lookups; -q: summary only; -i 0.2: the fastest an
        // unprivileged user may send; -W 1: wait 1 s for the last reply. No
        // -w: with a deadline, iputils keeps sending until `count` replies.
        child = spawn('ping', ['-n', '-q', '-c', String(count), '-i', '0.2', '-W', '1', address], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        done({ status: 'denied' });
        return;
      }
      guard = setTimeout(
        () => {
          child.kill?.('SIGKILL');
          done({ status: 'noreply' });
        },
        (count + 2) * 1000,
      );
      child.stdout?.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr?.on('data', (chunk) => {
        output += chunk;
      });
      // No ping binary at all: ICMP is unavailable, like a refused socket.
      child.on('error', () => done({ status: 'denied' }));
      child.on('close', (code) => {
        const { received, average } = parsePingOutput(output);
        if (received > 0) {
          done({ status: 'reply', latency: average === null ? null : roundLatency(average) });
        } else if (code === 1) {
          done({ status: 'noreply' });
        } else if (DENIED.test(output)) {
          done({ status: 'denied' });
        } else {
          // Name that does not resolve, invalid address...: no answer either way.
          done({ status: 'error', message: output.trim().split('\n').pop() });
        }
      });
    });
  }

  /** One TCP attempt: resolves the latency in ms when the host answered, else null. */
  function tcpPort(address, port, timeoutMs) {
    return new Promise((resolve) => {
      const start = now();
      let socket;
      let timer = null;
      const finish = (answered) => {
        clearTimeout(timer);
        socket?.destroy();
        resolve(answered ? roundLatency(now() - start) : null);
      };
      timer = setTimeout(() => finish(false), timeoutMs);
      try {
        socket = connect({ host: address, port });
      } catch {
        finish(false);
        return;
      }
      socket.once('connect', () => finish(true));
      socket.once('error', (err) => finish(err?.code === 'ECONNREFUSED'));
    });
  }

  /** Every port at once: the first answer wins. */
  function tcp(address, ports, timeoutMs = TCP_TIMEOUT_MS) {
    return new Promise((resolve) => {
      let pending = ports.length;
      let answered = false;
      for (const port of ports) {
        tcpPort(address, port, timeoutMs).then((latency) => {
          pending -= 1;
          if (latency !== null && !answered) {
            answered = true;
            resolve({ status: 'reply', latency, port });
          } else if (pending === 0 && !answered) {
            resolve({ status: 'noreply' });
          }
        });
      }
    });
  }

  /**
   * Probe a host the way it is configured.
   * @param {{ address: string, method?: string, port?: number|null }} target
   * @returns {Promise<{ reachable: boolean|null, latency: number|null,
   *   method: 'icmp'|'tcp'|null, icmpDenied: boolean }>} `reachable` is null
   *   when nothing could be measured (ICMP-only host and ICMP refused).
   */
  async function probe({ address, method = 'auto', port = null }) {
    let icmpDenied = false;
    if (method !== 'tcp') {
      const result = await icmp(address);
      if (result.status === 'reply') {
        return { reachable: true, latency: result.latency, method: 'icmp', icmpDenied };
      }
      icmpDenied = result.status === 'denied';
      if (method === 'icmp') {
        return { reachable: icmpDenied ? null : false, latency: null, method: null, icmpDenied };
      }
    }
    const result = await tcp(address, port ? [port] : DEFAULT_TCP_PORTS);
    if (result.status === 'reply') {
      return { reachable: true, latency: result.latency, method: 'tcp', icmpDenied };
    }
    return { reachable: false, latency: null, method: null, icmpDenied };
  }

  return { probe, icmp, tcp };
}
