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

- **Secrets**: the SABnzbd API key and the NZBGet password are `secret` fields of the Gladys
  configuration. The integration reads them from Gladys, keeps them in memory, sends them only to
  the client they belong to (the `apikey` parameter of SABnzbd, the HTTP Basic authentication of
  NZBGet), and never writes them to `/data` nor to the logs. An address containing credentials
  (`http://user:pass@…`) is refused.
- **Stored in `/data`**: `usenet-state.json`, the ids of the finished jobs already announced to the
  scenes, per client (with the software and address of the client). Nothing else.
- **Network**: requests go only to the client addresses typed in the configuration, on the local
  network, in HTTP or HTTPS. HTTPS certificates are verified unless the user ticks "Accept
  self-signed certificates"; the integration opens no port and calls no cloud service. It never
  deletes a job or a file: pause, resume and speed limit are the only commands it sends.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)), SABnzbd and NZBGet
themselves, and the other devices and services of your network.
