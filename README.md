# Ping & Wake-on-LAN for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that tells which
hosts of the local network are up — computers, NAS, TVs, phones, servers — and wakes them up with
Wake-on-LAN. The equivalent of the Home Assistant **Ping** and **Wake on LAN** integrations, in
one: "switch on the PC / the NAS / the TV, and know when it is up". No cloud, no account.

> **Developed without the hardware: feedback welcome.** The integration is covered by automated
> tests (real outputs of `ping`, real UPnP answers, the SDK's fake Gladys), but has not yet run in
> a real Gladys installation against real Wake-on-LAN computers. Please report what works and what
> does not in the [issues](https://github.com/guim31/gladys-ping-wol/issues).

## Features

- **One device per host**: **Online** (presence sensor: a yes/no badge, and a condition in
  scenes), **Latency** (milliseconds, with history), and a **Wake up** push button when the MAC
  address is known.
- **Checks by ping or TCP**: ICMP echo first; for the hosts that ignore pings (Windows firewall,
  phones), a TCP connection — accepted or refused, any answer proves the host is up. Automatic,
  ping only or TCP port only, per host.
- **No flicker**: a host is shown offline only after a delay without any answer (1 minute by
  default, per host if needed: 10 to 30 minutes for phones asleep on Wi-Fi).
- **Wake-on-LAN through the Gladys core** (the container cannot broadcast on the LAN), with an
  optional subnet broadcast address. After a wake-up, the host is checked every 5 seconds and the
  packet sent again every 30 seconds until it answers.
- **Network search**: the devices that announce themselves over UPnP/SSDP (TVs, NAS, media
  servers, routers…) are proposed in the Discover tab, with their MAC address when the core's ARP
  table knows it.
- **Scene trigger** _A device did not wake up_; **scene actions** _Wake a device (Wake-on-LAN)_
  (can wait until the device answers, and returns its start-up time) and _Check an address_ (any
  address, no device needed).
- **Dashboard widget** _Network devices_: several hosts at a glance, with a Wake button for the
  offline ones.
- English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions, Wake-on-LAN and SSDP
  through the core).
- Docker 20.10 or later on the Gladys machine for the pings (unprivileged ICMP sockets); with an
  older Docker, the hosts are checked over TCP only.
- For Wake-on-LAN: a computer on the same local network as Gladys, preferably wired, with
  Wake-on-LAN enabled in its BIOS/UEFI and system, and its MAC address.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-ping-wol` (or install it from the catalog once it is listed).
   The install screen shows the two accesses the integration asks for: **Wake-on-LAN access** and
   **SSDP search for ssdp:all**.
2. In **Configuration**, run **Add or update a host** for each host (name, IP address, MAC address
   for Wake-on-LAN), or **Search the network**.
3. Open the **Discover** tab and press **Add to Gladys**.

The user guide is in [`docs/en.md`](docs/en.md) ([français](docs/fr.md), [Deutsch](docs/de.md),
[español](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

```
Integration container ──ping (iputils, ICMP datagram socket) / TCP connect──▶ hosts
      │ SDK (WebSocket + host API)
      ▼
Gladys core (host network) ──Wake-on-LAN magic packet (UDP broadcast, port 9)──▶ LAN
                           ──SSDP M-SEARCH ssdp:all, raw answers + ARP MAC────▶ LAN
```

- The container has no capability (no raw socket): `ping` from iputils uses the unprivileged ICMP
  datagram sockets Docker opens to its containers (`net.ipv4.ping_group_range`, Docker 20.10+).
  When they are refused, iputils exits with code 2, and the integration falls back on TCP and says
  so in the Configuration screen.
- Devices are published with `should_poll: false`: the integration checks the created hosts
  itself, 8 at a time, at the configured interval. Only the changes are published (Gladys allows
  300 states a minute), the latency only when it moves by 20 % (1 ms at least), and every state is
  sent again every 12 hours so that a stable host never shows "No recent value".
- The list of hosts is kept in `/data/hosts.json`. If the file is lost, the hosts already created
  in Gladys are rebuilt from their device parameters (address, MAC).
- Scene action results are numbers (1/0), not booleans: the core's _Condition on variables_
  compares with `===` and its value field only produces numbers and strings.

## Limitations

- **Developed without the hardware**: see above.
- IPv4 addresses and DNS names only: `.local` names (mDNS) do not resolve inside the container.
- Wake-on-LAN reaches the local network of the Gladys machine only; other subnets need a router
  that forwards directed broadcasts.
- The core sends one magic packet every 2 seconds at most per integration.
- A wake-up only means the packet was sent: the next answers prove the device is on. The _Wake a
  device_ scene action waits 100 seconds at most (Gladys gives an action 120 seconds); the
  follow-up goes on in the background until the wake-up timeout.
- Phones asleep on Wi-Fi answer irregularly: give them a long offline delay. Some answer on no
  port at all while asleep.
- 64 hosts at most.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js); the
Docker image adds Alpine's `iputils-ping`.

```bash
npm install
npm test              # node --test: unit tests + the SDK's fake Gladys and a simulated network
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store --skip-image-check .   # store validator
```

```
index.js              SDK wiring (src/app.js registers the handlers)
src/app.js            handlers → monitor, configuration actions
src/monitor.js        hosts, checks, states, Wake-on-LAN, network search, wake_failed trigger
src/probe.js          ping (iputils) and TCP checks
src/hosts.js          validation of the host fields, ids
src/devices.js        Gladys device of a host (features, names)
src/discovery.js      SSDP answers and UPnP descriptions
src/scenes.js         scene actions
src/widgets.js        dashboard widget
src/messages.js       texts sent from the container, four languages
src/store.js          /data persistence
src/config.js         configuration defaults and normalization
```

## Credits

- [Home Assistant](https://www.home-assistant.io) ([`ping`](https://www.home-assistant.io/integrations/ping/)
  and [`wake_on_lan`](https://www.home-assistant.io/integrations/wake_on_lan/), Apache-2.0) for
  what users expect from these integrations: the presence and latency sensors, the consider-home
  delay of phones, the optional broadcast address.
- [async_upnp_client](https://github.com/StevenLooman/async_upnp_client) (Apache-2.0, Steven
  Looman): the UPnP descriptions and SSDP answers used as test fixtures.
- [iputils](https://github.com/iputils/iputils): the `ping` of the Docker image.

Not affiliated with any hardware vendor, nor with Home Assistant. Wake-on-LAN is an industry
standard (AMD/IBM, 1995).

## License

Apache-2.0 (as declared in `package.json`).
