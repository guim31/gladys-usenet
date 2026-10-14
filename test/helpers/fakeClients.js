// -----------------------------------------------------------------------------
// In-memory SABnzbd and NZBGet behind the `request` seam of the clients
// (src/clients/http.js). Answers start from the real responses recorded in
// test/fixtures (SABnzbd 5.1.3, NZBGet 26.3), with the behaviours that matter:
// API key / password, wrong key warnings, pause with or without timer, speed
// limit, history with `last_history_update`, NZBGet log IDs, a client that
// does not answer.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const fixture = (path) =>
  readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8');
export const fixtureJson = (path) => JSON.parse(fixture(path));

export const SAB_KEY = '0123456789abcdef0123456789abcdef';
export const NZBGET_USER = 'nzbget';
export const NZBGET_PASSWORD = 'tegbzn6789';

const json = (status, body) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const text = (status, body, type = 'text/html') => ({
  status,
  headers: { 'content-type': type },
  body,
});

function offline() {
  const error = new Error('connect ECONNREFUSED');
  error.code = 'ECONNREFUSED';
  return error;
}

/** "29:59" like SABnzbd's pause_int. */
const minutesSeconds = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export class FakeSabnzbd {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey]
   * @param {4|5} [options.major] SABnzbd 4 also answers under /sabnzbd/api
   * @param {() => number} [options.now]
   */
  constructor({ apiKey = SAB_KEY, major = 5, now = () => Date.now() } = {}) {
    this.apiKey = apiKey;
    this.major = major;
    this.now = now;
    this.online = true;
    this.requests = [];
    this.paused = false;
    this.pauseUntil = null;
    this.kbpersec = 0;
    this.mbleft = 0;
    this.count = 0;
    this.current = null;
    this.diskspace = ['29.40', '29.40'];
    this.bandwidthMax = '';
    this.speedlimitAbs = 0;
    this.speedlimit = '100';
    this.warnings = [];
    this.historyUpdate = 1;
    this.postProcessing = 0;
    this.slots = fixtureJson('sabnzbd/5.1.3/history.json').history.slots;
  }

  /** Something downloads: KB/s, MB left, jobs in the queue. */
  download({
    kbpersec = 2804.89,
    mbleft = 49.78,
    count = 3,
    name = 'Big.Linux.Distribution',
  } = {}) {
    this.kbpersec = kbpersec;
    this.mbleft = mbleft;
    this.count = count;
    this.current = name;
  }

  idle() {
    this.download({ kbpersec: 0, mbleft: 0, count: 0, name: null });
  }

  /** A job ends: it goes on top of the history. */
  finish(name, { failed = false, category = 'tv', at = this.now(), bytes = 734_003_200 } = {}) {
    const [template] = this.slots;
    this.slots = [
      {
        ...template,
        nzo_id: `SABnzbd_nzo_${name.toLowerCase().replace(/\W/g, '')}`,
        name,
        category,
        status: failed ? 'Failed' : 'Completed',
        completed: Math.floor(at / 1000),
        bytes: failed ? 0 : bytes,
        fail_message: failed
          ? 'Download failed - Not on your server(s) - https://sabnzbd.org/not-complete'
          : '',
      },
      ...this.slots,
    ];
    this.historyUpdate += 1;
  }

  warn(textOfWarning, type = 'WARNING') {
    this.warnings.push({
      type,
      text: textOfWarning,
      time: Math.floor(this.now() / 1000),
      origin: 'test',
    });
  }

  queue(limit) {
    const base = fixtureJson('sabnzbd/5.1.3/queue-idle.json').queue;
    const paused = this.paused;
    const left = this.pauseUntil ? Math.max(0, (this.pauseUntil - this.now()) / 1000) : 0;
    const speed = paused ? 0 : this.kbpersec;
    const slots =
      this.count > 0 && Number(limit) > 0
        ? [
            {
              ...fixtureJson('sabnzbd/5.1.3/queue-downloading.json').queue.slots[0],
              filename: this.current,
              status: paused ? 'Paused' : 'Downloading',
            },
          ]
        : [];
    return {
      queue: {
        ...base,
        paused,
        pause_int: paused && this.pauseUntil ? minutesSeconds(left) : '0',
        diskspace1: this.diskspace[0],
        diskspace2: this.diskspace[1],
        speedlimit: this.speedlimit,
        speedlimit_abs: String(this.speedlimitAbs),
        have_warnings: String(this.warnings.length),
        kbpersec: speed.toFixed(2),
        mbleft: this.mbleft.toFixed(2),
        noofslots_total: this.count,
        noofslots: slots.length,
        status: paused ? 'Paused' : speed > 0 ? 'Downloading' : 'Idle',
        timeleft:
          speed > 0
            ? new Date(((this.mbleft * 1024) / speed) * 1000).toISOString().slice(11, 19)
            : '0:00:00',
        slots,
      },
    };
  }

  /** The `request` function given to the client. */
  handle(url, options = {}) {
    const { pathname, searchParams } = new URL(url);
    const params = Object.fromEntries(searchParams);
    this.requests.push({ path: pathname, params, insecure: options.insecure });
    if (!this.online) {
      throw offline();
    }
    if (this.pauseUntil && this.now() >= this.pauseUntil) {
      this.paused = false;
      this.pauseUntil = null;
    }
    const prefixed = pathname === '/sabnzbd/api';
    if (pathname !== '/api' && !(prefixed && this.major === 4)) {
      return text(404, fixture('sabnzbd/5.1.3/sabnzbd-path.txt').split('\n').slice(1).join('\n'));
    }
    if (params.mode === 'version') {
      return json(200, { version: this.major === 4 ? '4.2.2' : '5.1.3' });
    }
    if (!params.apikey) {
      this.warn(
        'API key missing, please enter the API key from Config->General into your 3rd party program: 192.0.2.1 [node]',
      );
      return text(403, 'API Key Required', 'text/html;charset=utf-8');
    }
    if (params.apikey !== this.apiKey) {
      this.warn(
        'API key incorrect, Use the API key from Config->General in your 3rd party program: 192.0.2.1 [node]',
      );
      return text(403, 'API Key Incorrect', 'text/html;charset=utf-8');
    }
    switch (params.mode) {
      case 'queue':
        return json(200, this.queue(params.limit));
      case 'history':
        if (Number(params.last_history_update) === this.historyUpdate) {
          return json(200, { history: false });
        }
        return json(200, {
          history: {
            ...fixtureJson('sabnzbd/5.1.3/history.json').history,
            slots: this.slots.slice(0, Number(params.limit) || 20),
            ppslots: this.postProcessing,
            last_history_update: this.historyUpdate,
          },
        });
      case 'warnings':
        return json(200, { warnings: this.warnings });
      case 'get_config':
        return json(200, { config: { misc: { bandwidth_max: this.bandwidthMax } } });
      case 'pause':
        this.paused = true;
        this.pauseUntil = null;
        return json(200, { status: true });
      case 'resume':
        this.paused = false;
        this.pauseUntil = null;
        return json(200, { status: true });
      case 'config':
        return this.config(params);
      default:
        return json(200, { status: false, error: 'not implemented' });
    }
  }

  config({ name, value }) {
    if (name === 'set_pause') {
      this.paused = true;
      this.pauseUntil = this.now() + Number(value) * 60_000;
      return json(200, { status: true });
    }
    if (name === 'speedlimit') {
      const max = toBytes(this.bandwidthMax);
      if (!value) {
        this.speedlimit = '100';
        this.speedlimitAbs = 0;
      } else if (/^\d+$/.test(value) && Number(value) <= 100) {
        if (max) {
          this.speedlimit = value;
          this.speedlimitAbs = Math.round((max * Number(value)) / 100);
        } else {
          this.speedlimit = value;
          this.warn('You must set a maximum bandwidth before you can set a bandwidth limit');
        }
      } else {
        this.speedlimitAbs = toBytes(value);
        this.speedlimit = max ? String(Math.round((100 * this.speedlimitAbs) / max)) : '100';
      }
      return json(200, { status: true });
    }
    return json(200, { status: false, error: 'not implemented' });
  }
}

function toBytes(value) {
  const match = String(value).match(/^(\d+(?:\.\d+)?)([KMG]?)$/i);
  return match
    ? Math.round(Number(match[1]) * 1024 ** ' KMG'.indexOf(match[2].toUpperCase() || ' '))
    : 0;
}

export class FakeNzbget {
  /**
   * @param {object} [options]
   * @param {string} [options.username]
   * @param {string} [options.password]
   * @param {() => number} [options.now]
   */
  constructor({ username = NZBGET_USER, password = NZBGET_PASSWORD, now = () => Date.now() } = {}) {
    this.username = username;
    this.password = password;
    this.now = now;
    this.online = true;
    this.requests = [];
    this.paused = false;
    this.resumeTime = 0;
    this.rateBps = 0;
    this.remaining = 0;
    this.limit = 0;
    this.groups = [];
    this.downloaded = 292_558_233;
    this.postJobs = 0;
    this.free = [1196269568, 7];
    this.uptime = 600;
    this.history = fixtureJson('nzbget/26.3/history.json').result;
    this.log = fixtureJson('nzbget/26.3/log-from-140.json').result;
  }

  download({ rate = 2489637, remaining = 51659748, name = 'Big.Linux.Distribution' } = {}) {
    this.rateBps = rate;
    this.remaining = remaining;
    const [group] = fixtureJson('nzbget/26.3/listgroups-downloading.json').result;
    this.groups = [
      { ...group, NZBID: 100, NZBName: name, Status: 'DOWNLOADING' },
      { ...group, NZBID: 101, NZBName: 'Next.Job', Status: 'QUEUED' },
    ];
  }

  idle() {
    this.rateBps = 0;
    this.remaining = 0;
    this.groups = [];
  }

  finish(name, { status = 'SUCCESS/HEALTH', category = 'Series', at = this.now() } = {}) {
    const [template] = this.history;
    const id = Math.max(...this.history.map((item) => item.NZBID)) + 1;
    this.history = [
      {
        ...template,
        NZBID: id,
        Name: name,
        NZBName: name,
        Category: category,
        Status: status,
        HistoryTime: Math.floor(at / 1000),
      },
      ...this.history,
    ];
    this.downloaded += 1_000_000;
  }

  addLog(kind, textOfLine) {
    const id = Math.max(0, ...this.log.map((line) => line.ID)) + 1;
    this.log.push({ ID: id, Kind: kind, Time: Math.floor(this.now() / 1000), Text: textOfLine });
  }

  status() {
    const base = fixtureJson('nzbget/26.3/status-idle.json').result;
    const serverTime = Math.floor(this.now() / 1000);
    if (this.paused && this.resumeTime && serverTime >= this.resumeTime) {
      this.paused = false;
      this.resumeTime = 0;
    }
    const rate = this.paused ? 0 : this.limit ? Math.min(this.limit, this.rateBps) : this.rateBps;
    return {
      ...base,
      DownloadRate: rate,
      DownloadRateLo: rate,
      DownloadRateHi: 0,
      RemainingSizeLo: this.remaining % 2 ** 32,
      RemainingSizeHi: Math.floor(this.remaining / 2 ** 32),
      RemainingSizeMB: Math.floor(this.remaining / 1048576),
      DownloadedSizeLo: this.downloaded % 2 ** 32,
      DownloadedSizeHi: 0,
      DownloadPaused: this.paused,
      DownloadLimit: this.limit,
      PostJobCount: this.postJobs,
      FreeDiskSpaceLo: this.free[0],
      FreeDiskSpaceHi: this.free[1],
      FreeInterDiskSpaceLo: this.free[0],
      FreeInterDiskSpaceHi: this.free[1],
      ResumeTime: this.resumeTime,
      ServerTime: serverTime,
      UpTimeSec: this.uptime,
    };
  }

  handle(url, { method = 'GET', headers = {}, json: body } = {}) {
    const { pathname } = new URL(url);
    this.requests.push({ method, path: pathname, rpc: body?.method, params: body?.params });
    if (!this.online) {
      throw offline();
    }
    const expected = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
    if (headers.authorization !== expected) {
      return text(401, '', 'text/plain');
    }
    if (pathname !== '/jsonrpc') {
      return text(404, 'Not found', 'text/plain');
    }
    if (method !== 'POST') {
      return json(200, fixtureJson('nzbget/26.3/error-get-not-safe.json'));
    }
    const result = (value) => json(200, { version: '1.1', id: body.id, result: value });
    const params = body.params ?? [];
    switch (body.method) {
      case 'version':
        return result('26.3');
      case 'status':
        return result(this.status());
      case 'listgroups':
        return result(this.groups);
      case 'history':
        return result(this.history);
      case 'log': {
        const [from, count] = params;
        return result(
          from === 0 ? this.log.slice(-count) : this.log.filter((line) => line.ID >= from),
        );
      }
      case 'pausedownload':
        this.paused = true;
        this.resumeTime = 0;
        return result(true);
      case 'resumedownload':
        this.paused = false;
        this.resumeTime = 0;
        return result(true);
      case 'scheduleresume':
        this.resumeTime = Math.floor(this.now() / 1000) + params[0];
        return result(true);
      case 'rate':
        this.limit = params[0] * 1024;
        return result(true);
      default:
        return json(200, fixtureJson('nzbget/26.3/error-invalid-procedure.json'));
    }
  }
}

/**
 * A network of fake clients, by origin: the `request` seam of the hub. An
 * address without a client does not answer.
 */
export function createNetwork(clients = {}) {
  const byOrigin = new Map(Object.entries(clients));
  return {
    clients: byOrigin,
    async request(url, options) {
      const client = byOrigin.get(new URL(url).origin);
      if (!client) {
        const error = new Error('connect EHOSTUNREACH');
        error.code = 'EHOSTUNREACH';
        throw error;
      }
      return client.handle(url, options);
    },
  };
}
