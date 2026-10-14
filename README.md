# SABnzbd / NZBGet for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for the two Usenet download clients
of the home server: [SABnzbd](https://sabnzbd.org) and [NZBGet](https://nzbget.com). It reads the
local API of the client, shows the downloads on the dashboard, pauses them or limits their speed
from a scene, and starts scenes when a download is finished or has failed.

Tested against real SABnzbd 4.2.2 and 5.1.3 and NZBGet 21.0 and 26.3 installs, not yet in a real
Gladys: feedback welcome in the [issues](https://github.com/guim31/gladys-usenet/issues).

## Features

- **One device per client** (up to two, SABnzbd or NZBGet): downloads paused (switch), speed limit
  in % of the line (slider), download speed, jobs in the queue, left to download, time left, free
  disk space of the download folders, status, last download, errors and warnings of the last 24
  hours. Feature names in French by default, or English, German, Spanish.
- **Scene triggers**: _Download completed_ and _Download failed_, filtered by client and category,
  with the name, category, size or reason as variables. Once per job, including the jobs finished
  while the integration was restarting.
- **Scene actions**: _Pause downloads_ (for a number of minutes, or until resumed), _Resume
  downloads_, _Limit the download speed_ (in %), on one client or all of them.
- **Widget** _Usenet downloads_: speed, queue, time left, one line per client, and Pause, Pause 30
  min and Resume buttons.
- **Test the connection** button in the configuration.

## Requirements

- Gladys 5.1.0 or later.
- SABnzbd 3 or later (with its full API key), or NZBGet 21 or later (with its control user name
  and password), on the local network of Gladys.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the address of this
   repository: `https://github.com/guim31/gladys-usenet` (or install **SABnzbd / NZBGet** from the
   catalog once it is listed).
2. In **Configuration**, choose the software, enter the address with its port
   (`192.168.1.10:8080` for SABnzbd, `192.168.1.10:6789` for NZBGet), the API key or the user name
   and password, and optionally a name and your line speed. Save, then click **Test the
   connection**.
3. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

- The integration reads each client on its own timer (30 s by default, 10 s to 5 min), not through
  the polling of Gladys (the devices are published with `should_poll: false`,
  GladysAssistant/Gladys#3198). Only the changed values are sent to Gladys, and each value again
  after 6 hours.
- **SABnzbd**: `mode=queue` at each reading; `mode=history` with `last_history_update` (answered
  `false` while nothing changed); `mode=warnings` only when the warning count moves; the maximum
  line speed (`get_config`) once an hour. Commands: `pause`, `resume`, `config set_pause` (timed
  pause), `config speedlimit`.
- **NZBGet**: JSON-RPC over HTTP POST: `status` and `listgroups` at each reading, `log` from the
  last line read, `history` only when the queue or the downloaded volume moved (it sends the whole
  history), at least every 15 minutes. Commands: `pausedownload`, `scheduleresume`,
  `resumedownload`, `rate`.
- A finished job is recognised by its id in the history: the ids already seen are kept in
  `/data/usenet-state.json`, so a restart neither repeats nor misses an event.
- A refused API key or password is not retried on the timer (each refused key is a warning in
  SABnzbd): saving the configuration or **Test the connection** tries again.

## Checked on real software, and what was not

The session that wrote this integration installed SABnzbd 4.2.2 (Ubuntu package) and 5.1.3
(official source release), NZBGet 21.0 (Ubuntu package) and 26.3 (official Linux binary), and a
small news server (`test/real/nntp.js`) serving generated yEnc articles, so the clients really
downloaded, completed and failed jobs. Their answers are recorded, anonymised, in `test/fixtures`
and replayed by the tests. `npm run test:real` drives a real client end to end (see
`test/real/real.test.js`); it passed on SABnzbd 4.2.2 and 5.1.3 and NZBGet 26.3. NZBGet 21.0 of
Ubuntu 24.04 crashed in its own post-processing in that sandbox: its recorded answers are covered
by the unit tests only.

Not checked: a real Gladys (dashboard rendering, scene editor, Discovery tab), a real Usenet
provider, HTTPS with a self-signed certificate on a real client, a reverse proxy.

## Limitations

- No job management (adding, removing, reordering downloads): pause, resume and speed limit only.
- A speed limit in % needs the line speed: SABnzbd's "Maximum line speed", or the line speed typed
  in the configuration (always for NZBGet).
- NZBGet resumes a timed pause up to ~25 s late; its error counter starts with the last 100 log
  lines.
- No "low disk space" trigger: compare the Free disk space feature in a device trigger.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npm run test:real   # optional, against a throwaway SABnzbd / NZBGet (see test/real/real.test.js)
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`) and
in-memory clients (`test/helpers/fakeClients.js`) built from the recorded answers. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- The Home Assistant integrations [`sabnzbd`](https://www.home-assistant.io/integrations/sabnzbd)
  and [`nzbget`](https://www.home-assistant.io/integrations/nzbget) (Apache-2.0) and their
  libraries `pysabnzbd` and `pynzbgetapi`, for the fields worth showing;
  `test/fixtures/sabnzbd/home-assistant-queue.json` comes from the tests of Home Assistant.
- The [SABnzbd API](https://sabnzbd.org/wiki/advanced/api) and
  [NZBGet API](https://github.com/nzbgetcom/nzbget/blob/develop/docs/api/API.md) documentation.
- Built from the official
  [JavaScript template](https://github.com/GladysAssistant/integration-template-js) and
  [SDK](https://github.com/GladysAssistant/integration-sdk-js) of Gladys Assistant.

## Disclaimer

Not affiliated with, endorsed by or sponsored by SABnzbd or NZBGet. The names belong to their
respective owners.

## License

[Apache-2.0](LICENSE).
