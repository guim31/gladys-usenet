# SABnzbd / NZBGet

Follow and control your Usenet downloads from Gladys: [SABnzbd](https://sabnzbd.org) and
[NZBGet](https://nzbget.com), the two download clients most home servers run (Docker, Unraid,
Synology, Proxmox…). The integration talks to the local API of the client: the download speed, the
queue and the time left show on the dashboard, a scene can pause the downloads during a video call
and limit the speed in the evening, and Gladys can tell you when a download is finished or failed.

Tested against real SABnzbd (4.2 and 5.1) and NZBGet (21 and 26) installs, not yet in a real
Gladys: feedback welcome on
[GitHub](https://github.com/guim31/gladys-usenet/issues).

## Requirements

- Gladys 5.1.0 or later.
- SABnzbd 3 or later, or NZBGet 21 or later, reachable from the Gladys server (same network).
- For SABnzbd: its **API key** (Config → General → Security → API Key). The NZB key, just below,
  is not enough: it can only add jobs.
- For NZBGet: the **control user name and password** (Settings → Security → ControlUsername and
  ControlPassword, `nzbget` / `tegbzn6789` until you change them).

## Configuration

Up to two clients, each with:

- **Software**: SABnzbd or NZBGet.
- **Address**: the IP address or name, with the port: `192.168.1.10:8080` (SABnzbd) or
  `192.168.1.10:6789` (NZBGet). Without port, the default port of the software is added. Write
  `https://` for HTTPS, and the path if the client sits behind a reverse proxy
  (`https://nas.example.org/sabnzbd`).
- **API key (SABnzbd)**, or **User name (NZBGet)** and **Password (NZBGet)**.
- **Name**: the name of the device in Gladys (empty: the software followed by the address).
- **Line speed (Mbit/s)**: your download speed, needed to limit the speed in percent with NZBGet,
  and with SABnzbd when its "Maximum line speed" (Config → General) is not set. 0: unknown.

Options:

- **Accept self-signed certificates**: for `https://` addresses with the certificate SABnzbd
  generates. Tick it for your own servers only.
- **Refresh interval**: how often the clients are read, 30 seconds by default.
- **Language of the feature names**: the names given to the features when a device is added, and
  the status texts (French by default).

The **Test the connection** button reads every client and says what it found: version, state,
queue, recent errors.

## Devices

One device per client, found in the Discovery tab. Its features:

| Feature           | What it shows                                                                        |
| ----------------- | ------------------------------------------------------------------------------------ |
| Downloads paused  | switch: on pauses the downloads until you turn it off, off resumes them.             |
| Speed limit       | slider, the share of the line in %, 100 = no limit. Moving it limits the speed.      |
| Download speed    | in MB/s.                                                                             |
| Jobs in the queue | the jobs waiting or downloading (post-processing excluded).                          |
| Left to download  | in GB.                                                                               |
| Time left         | in minutes at the current speed, 0 when nothing downloads.                           |
| Free disk space   | in GB, of the download folders (the smaller of the temporary and completed folders). |
| Status            | Downloading, Paused, Post-processing, Waiting, Idle, or Unreachable.                 |
| Last download     | the name of the last download completed.                                             |
| Errors (24 h)     | the errors and warnings the client reported over the last 24 hours.                  |

Sizes and speeds are binary units, like the clients show them (1 MB = 1024 × 1024 bytes). Only
the changes are sent to Gladys, and every value again after 6 hours.

## Widget

The **Usenet downloads** widget shows the speed, the queue and the time left of every client (or
of the one chosen in its settings), one line per client (state, end of a timed pause, speed limit,
free space, last download, errors), and three buttons:

- **Pause**: pauses the downloads until you resume them;
- **Pause 30 min**: pauses them for 30 minutes;
- **Resume**: resumes them.

The check mark shows the current state: on **Pause** when everything is paused, on **Resume**
when everything downloads.

## Scene triggers

- **Download completed**: a job finished downloading and post-processing successfully. Filters:
  the client, the category (exactly as written in the client, `tv`, `Movies`…). Variables: name,
  category, size in MB, client name.
- **Download failed**: a job failed (missing articles, repair or unpack impossible). Same filters;
  variables: name, category, the reason given by the client, client name.

Each job fires once. The jobs finished while the integration was stopped (an update, a restart)
fire when it starts again, if they are less than an hour old.

There is no "low disk space" trigger: the **Free disk space** feature is a value, and the device
trigger of Gladys already compares it with a threshold ("Free disk space below 20 GB").

## Scene actions

- **Pause downloads**: one client or all of them, for a number of minutes (0: until resumed).
  Outputs: number of clients paused, duration.
- **Resume downloads**: one client or all of them.
- **Limit the download speed**: a share of the line in %, 100 to remove the limit. Needs the line
  speed (see Configuration).

## Scene examples

- Video call: when the calendar event "Meeting" starts, **Pause downloads** for 60 minutes.
- Evening: at 7 pm, **Limit the download speed** to 30 %; at 11 pm, back to 100 %.
- Notification: on **Download completed** with the category `tv`, send "{{triggerEvent.data.name}}
  is ready to watch" to the family.
- Problem: on **Download failed**, send the name and the reason to the administrator.
- Disk: when **Free disk space** drops below 20 GB, pause the downloads and send a message.

## Troubleshooting

- "does not answer": check the address and the port, and that the Gladys server can reach the
  client (firewall, Docker network).
- "API key or password refused": correct the key or the password, then save. The integration does
  not try again on its own: each refused key adds a warning in SABnzbd.
- "certificate refused": tick "Accept self-signed certificates", or use `http://`.
- "no SABnzbd or NZBGet at this address": wrong software chosen, or wrong port.
- "the address redirects": write the `https://` address.
- A limit in % refused: enter the **Line speed (Mbit/s)**, or set "Maximum line speed" in SABnzbd.
- More details: the integration logs, with `LOG_LEVEL=debug` for every reading.

## Limits

- Each refresh reads the queue: every 30 seconds by default, a few small requests. NZBGet sends
  its whole history at once: it is only read again when something changed, at most every 15
  minutes otherwise.
- NZBGet resumes a timed pause up to about 25 seconds late (it checks its timer periodically).
- No job management: the integration does not add, remove or reorder downloads, and deletes
  nothing.
- The "Errors (24 h)" of NZBGet count the messages since the integration started reading its log
  (the last 100 at start).
- Not affiliated with SABnzbd or NZBGet.
