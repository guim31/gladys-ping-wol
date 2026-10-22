# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.2] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.1] - 2026-10-13

### Changed

- Quieter logs: by default they only show the start, a host going offline or
  coming back, each Wake-on-LAN and each host added or removed. A problem that
  repeats (Gladys unreachable, network search refused, `/data` not writable) is
  written once, then once more when it is over. `LOG_LEVEL=debug` shows every
  check (see Troubleshooting).
- Updated dependencies.

## [1.0.0] - 2026-10-12

### Added

- One Gladys device per watched host (computer, NAS, TV, phone, server):
  **Online** (presence sensor, usable in scene conditions) and **Latency** (in
  milliseconds, with history), plus a **Wake up** button when the MAC address
  is known (Wake-on-LAN, sent by the Gladys core).
- Hosts added from the Configuration screen (**Add or update a host**,
  **Remove a host**), kept across restarts and updates.
- Checks by ping (ICMP), with a TCP fallback for the hosts that ignore pings
  (a refused connection counts as an answer too): automatic, ping only or TCP
  port only, per host.
- Adjustable check interval (15 s to 5 min) and delay before a host is shown
  offline, globally and per host, so that phones asleep on Wi-Fi do not
  flicker.
- **Search the network**: devices that announce themselves over UPnP (TVs, NAS,
  media servers, routers…) are proposed in the Discover tab, with their MAC
  address when Gladys knows it.
- After a wake-up, the device is checked every 5 seconds and the packet sent
  again every 30 seconds until it answers or the wake-up timeout ends.
- Scene trigger **A device did not wake up**, with the device name, its
  address and the time waited.
- Scene actions **Wake a device (Wake-on-LAN)**, which can wait until the
  device answers (start-up time as a result), and **Check an address**, which
  checks any address without creating a device.
- Dashboard widget **Network devices**: several hosts at a glance (online with
  latency, offline, starting) and a **Wake** button for the offline ones.
- Texts and documentation in English, French, German and Spanish; feature
  names in French by default (setting **Language of the feature names**).
- Apache-2.0 `LICENSE` file.

[Unreleased]: https://github.com/guim31/gladys-ping-wol/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/guim31/gladys-ping-wol/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-ping-wol/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-ping-wol/releases/tag/v1.0.0
