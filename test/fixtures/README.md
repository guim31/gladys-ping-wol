# Test fixtures

- `gladys-feature-table.json`: category/type couples, units and poll frequencies the Gladys core
  knows, extracted from its code (see its `source` field).
- `ping/`: real outputs of `ping` from iputils 20250605 (the `iputils-ping` package of Alpine 3.24,
  the one the Docker image installs), run without any privilege (`ping -n -q -c 3 -i 0.2 -W 1`), against `127.0.0.1` and against
  `192.0.2.1` (TEST-NET-1, never answers); the "denied" case was produced in a network namespace
  whose `net.ipv4.ping_group_range` allows no group and without `CAP_NET_RAW`, which is what a
  container sees on a Docker that does not open ping sockets. One BusyBox output for the
  alternative format.
- `ssdp-results.json`: raw results of the core's SSDP scan (`scanNetwork('ssdp')`), in the shape of
  `networkDiscovery.scanSsdp.js` (Gladys 5.2.0). The response headers are taken from the tests of
  [async_upnp_client](https://github.com/StevenLooman/async_upnp_client) (Apache-2.0, Steven
  Looman), the library Home Assistant uses for SSDP, and from common NAS and speaker answers;
  addresses are anonymized (192.0.2.0/24, 198.51.100.0/24) and MAC addresses invented.
- `upnp/igd-device.xml`, `upnp/dmr-device.xml`: UPnP device descriptions from the async_upnp_client
  test fixtures (`tests/fixtures/igd/device.xml`, `tests/fixtures/dlna/dmr/device.xml`,
  Apache-2.0).
