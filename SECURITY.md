# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Stored in `/data`** (`/data/hosts.json`): the list of hosts the user added
  or created from the network search — name, address, MAC address, broadcast
  address, check method, port and offline delay. No secret, no account, no
  token: the integration needs none.
- **Network**: from its container, ICMP echo requests (through `iputils`
  ping and the unprivileged ICMP sockets of Docker) and TCP connection
  attempts, only towards the addresses the user entered or created; HTTP GET
  of the UPnP description of a device found by the network search, only when
  the device serves it from its own address. Wake-on-LAN packets and the SSDP
  search are sent by the Gladys core on the integration's behalf (manifest
  `network_wake` and `network_discovery`), with the core's own limits. Nothing
  leaves the local network unless the user enters an outside address.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the devices the integration checks or wakes up.
