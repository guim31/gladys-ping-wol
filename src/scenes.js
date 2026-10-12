// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// - wake_device: Wake-on-LAN from a scene, optionally waiting until the host
//   answers, so the next steps (start a media player, mount a share, send a
//   message) run on a machine that is up. The core waits 120 s at most for an
//   action: the wait stops at 100 s, the follow-up continues in the background
//   (and fires `wake_failed` at the end of the configured wake timeout).
// - check_address: one check of any address, without creating a device: the
//   output feeds a "Continue only if" step.
//
// Outputs are numbers (1/0), not booleans: the core's "Continue only if"
// compares with ===, and its value field only produces numbers and strings,
// so a boolean output could never be matched (Gladys 5.2.0).
// -----------------------------------------------------------------------------

export const WAIT_CAP_SECONDS = 100;

const isTrue = (value) => value === true || value === 'true' || value === 1;

export const SCENE_ACTIONS = {
  async wake_device(monitor, { fields }) {
    const host = monitor.hostOfDevice(fields.device);
    if (!isTrue(fields.wait)) {
      await monitor.wake(host);
      return {};
    }
    // Already up: nothing to send, nothing to wait for.
    const before = await monitor.check(host);
    if (before.reachable) {
      return { online: 1, boot_seconds: 0 };
    }
    const waitSeconds = Math.min(WAIT_CAP_SECONDS, monitor.config.wakeTimeout);
    const result = await monitor.wake(host, { waitMs: waitSeconds * 1000 });
    return result.online ? { online: 1, boot_seconds: result.bootSeconds } : { online: 0 };
  },

  async check_address(monitor, { fields }) {
    const result = await monitor.checkAddress(fields.address, fields.port);
    return result.reachable
      ? { reachable: 1, latency_ms: result.latency ?? undefined }
      : { reachable: 0 };
  },
};
