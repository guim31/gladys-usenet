// -----------------------------------------------------------------------------
// SABnzbd client: the HTTP API (`/api?mode=…&output=json&apikey=…`, documented
// at https://sabnzbd.org/wiki/advanced/api), read with the full API key.
//
// What a reading costs: `queue` (limit=1) every time; `history` with
// `last_history_update`, which answers `{"history": false}` while nothing
// changed; `warnings` only when the warning count of the queue moves; the
// maximum line speed (`get_config`) once an hour. Behaviours checked on real
// SABnzbd 4.2.2 and 5.1.3 (test/fixtures/sabnzbd):
//
//   - a wrong key answers 403 "API Key Incorrect" AND adds a warning in the
//     SABnzbd interface: the hub never retries a refused key on its timer;
//   - the NZB key (the second key of Config → General) is refused the same way;
//   - SABnzbd 4 serves the API under `/api` and `/sabnzbd/api`, SABnzbd 5 only
//     under `/api` (its `url_base` is empty): an address typed with
//     `/sabnzbd` falls back to the root once;
//   - `pause_int` is the time left of a timed pause, "M:SS" ("29:59"), "0"
//     without timer; `mode=pause` cancels the timer, `mode=resume` too;
//   - a speed limit in percent is ignored (with a warning in SABnzbd) unless
//     "Maximum line speed" is set in Config → General: without it, the limit
//     is sent in KB/s, computed from the line speed of the integration.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';
import { ClientError, ERROR_KINDS, networkError, parseJson, safeLocation } from './errors.js';
import { GB, KB, MB, OUTCOMES, STATUSES, fromUnits, parseClock, toNumber } from './model.js';

const HISTORY_LIMIT = 20;
const MAX_LINE_SPEED_AGE_MS = 60 * 60_000;
const MAX_PROBLEMS = 100;

export class SabnzbdClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host:port[/path]`
   * @param {string} options.apiKey full API key (Config → General)
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   * @param {() => number} [options.now]
   */
  constructor({
    url,
    apiKey,
    insecure = false,
    request = httpRequest,
    timeoutMs = 10_000,
    now = () => Date.now(),
  }) {
    this.base = url;
    this.apiKey = apiKey;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.history = { update: null, jobs: [], postProcessing: 0 };
    this.warnings = { count: null, problems: [] };
    this.lineSpeed = { at: 0, bps: 0 };
  }

  // --- Transport -----------------------------------------------------------------

  async get(base, params) {
    const query = new URLSearchParams({ output: 'json', ...params, apikey: this.apiKey });
    try {
      return await this.request(`${base}/api?${query}`, {
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      throw networkError(err);
    }
  }

  /** One API call; resolves with the parsed JSON. */
  async api(params) {
    let response = await this.get(this.base, params);
    const origin = new URL(this.base).origin;
    if (this.base !== origin && response.status !== 403 && !isJson(response)) {
      // SABnzbd 5 no longer answers under /sabnzbd: try the root once, and
      // keep it when it answers.
      const fallback = await this.get(origin, params);
      if (isJson(fallback) || fallback.status === 403) {
        this.base = origin;
        response = fallback;
      }
    }
    const { status, body } = response;
    if (status >= 300 && status < 400) {
      throw new ClientError(
        ERROR_KINDS.REDIRECT,
        `Redirected to ${safeLocation(response.headers?.location)}`,
        { status },
      );
    }
    if (status === 401 || status === 403) {
      throw new ClientError(
        ERROR_KINDS.AUTH,
        /required/i.test(body) ? 'API key missing' : 'API key refused',
        { status },
      );
    }
    if (status === 404) {
      throw new ClientError(ERROR_KINDS.NOT_CLIENT, 'No SABnzbd API at this address', { status });
    }
    if (status !== 200) {
      throw new ClientError(ERROR_KINDS.HTTP, `HTTP ${status}`, { status });
    }
    const data = parseJson(body);
    if (!data || typeof data !== 'object') {
      throw new ClientError(ERROR_KINDS.NOT_CLIENT, 'The answer is not SABnzbd JSON');
    }
    if (data.status === false) {
      throw new ClientError(ERROR_KINDS.HTTP, `SABnzbd refused: ${data.error ?? 'error'}`);
    }
    return data;
  }

  // --- Reading -------------------------------------------------------------------

  /** Everything the integration shows, as a snapshot (src/clients/model.js). */
  async read() {
    const { queue } = await this.api({ mode: 'queue', limit: '1' });
    if (!queue || typeof queue !== 'object') {
      throw new ClientError(ERROR_KINDS.NOT_CLIENT, 'No queue in the answer');
    }
    await Promise.all([
      this.readHistory(),
      this.readWarnings(queue),
      this.readLineSpeed().catch(() => {}),
    ]);
    return this.snapshot(queue);
  }

  async readHistory() {
    const params = { mode: 'history', limit: String(HISTORY_LIMIT) };
    if (this.history.update !== null) {
      params.last_history_update = String(this.history.update);
    }
    const { history } = await this.api(params);
    if (!history) {
      return; // unchanged since the last reading
    }
    this.history = {
      update: toNumber(history.last_history_update),
      postProcessing: toNumber(history.ppslots) ?? 0,
      jobs: (Array.isArray(history.slots) ? history.slots : [])
        .map((slot) => parseJob(slot))
        .filter(Boolean),
    };
  }

  async readWarnings(queue) {
    const count = queue.have_warnings === undefined ? null : String(queue.have_warnings);
    if (count !== null && count === this.warnings.count) {
      return;
    }
    const { warnings } = await this.api({ mode: 'warnings' });
    this.warnings = {
      count,
      problems: (Array.isArray(warnings) ? warnings : [])
        .map((warning) => ({
          at: (toNumber(warning?.time) ?? 0) * 1000,
          level: String(warning?.type).toUpperCase() === 'ERROR' ? 'error' : 'warning',
          text: firstLine(warning?.text),
        }))
        .filter((problem) => problem.text)
        .slice(-MAX_PROBLEMS),
    };
  }

  /** "Maximum line speed" of Config → General, in bytes per second (0 when not set). */
  async readLineSpeed({ force = false } = {}) {
    if (!force && this.now() - this.lineSpeed.at < MAX_LINE_SPEED_AGE_MS) {
      return this.lineSpeed.bps;
    }
    const data = await this.api({
      mode: 'get_config',
      section: 'misc',
      keyword: 'bandwidth_max',
    });
    this.lineSpeed = { at: this.now(), bps: fromUnits(data?.config?.misc?.bandwidth_max) };
    return this.lineSpeed.bps;
  }

  snapshot(queue) {
    const paused = queue.paused === true || String(queue.paused).toLowerCase() === 'true';
    const pauseLeft = paused ? parseClock(String(queue.pause_int ?? '')) : null;
    const speedBps = Math.max(0, (toNumber(queue.kbpersec) ?? 0) * KB);
    const queueCount = Math.max(0, toNumber(queue.noofslots_total) ?? 0);
    const disks = [queue.diskspace1, queue.diskspace2]
      .map(toNumber)
      .filter((value) => value !== null && value >= 0);
    const state = String(queue.status ?? '').toLowerCase();
    let status;
    if (paused) {
      status = STATUSES.PAUSED;
    } else if (state === 'downloading' || speedBps > 0) {
      status = STATUSES.DOWNLOADING;
    } else if (this.history.postProcessing > 0) {
      status = STATUSES.POST_PROCESSING;
    } else if (queueCount > 0) {
      status = STATUSES.QUEUED;
    } else {
      status = STATUSES.IDLE;
    }
    const slot = Array.isArray(queue.slots) ? queue.slots[0] : null;
    return {
      version: typeof queue.version === 'string' ? queue.version : null,
      status,
      paused,
      pauseEndsAt: pauseLeft ? this.now() + pauseLeft * 1000 : null,
      speedBps,
      queueCount,
      remainingBytes: Math.max(0, (toNumber(queue.mbleft) ?? 0) * MB),
      timeLeftSec:
        status === STATUSES.DOWNLOADING ? (parseClock(String(queue.timeleft ?? '')) ?? 0) : 0,
      freeBytes: disks.length ? Math.min(...disks) * GB : null,
      limitBps: Math.max(0, toNumber(queue.speedlimit_abs) ?? 0),
      maxBps: this.lineSpeed.bps,
      current:
        status === STATUSES.DOWNLOADING && typeof slot?.filename === 'string'
          ? slot.filename
          : null,
      jobs: this.history.jobs,
      problems: this.warnings.problems,
    };
  }

  // --- Commands ------------------------------------------------------------------

  /** Pause the downloads, for `minutes` (0: until resumed). */
  async pause(minutes = 0) {
    if (minutes > 0) {
      await this.api({ mode: 'config', name: 'set_pause', value: String(minutes) });
    } else {
      await this.api({ mode: 'pause' });
    }
  }

  async resume() {
    await this.api({ mode: 'resume' });
  }

  /**
   * Limit the speed to `percent` of the line (100: no limit).
   * @param {number} percent 1 to 100
   * @param {number} lineBps line speed of the configuration, bytes per second
   */
  async setSpeedLimit(percent, lineBps = 0) {
    const max = await this.readLineSpeed({ force: true });
    let value;
    if (percent >= 100) {
      // With a maximum, 100 % is the whole line; without, an empty value
      // falls back to no limit.
      value = max ? '100' : '';
    } else if (max) {
      value = String(percent);
    } else if (lineBps) {
      value = `${Math.max(1, Math.round((lineBps * percent) / 100 / KB))}K`;
    } else {
      throw new ClientError(ERROR_KINDS.LINE_SPEED, 'No maximum line speed known');
    }
    await this.api({ mode: 'config', name: 'speedlimit', value });
  }
}

function isJson(response) {
  return response.status === 200 && typeof parseJson(response.body) === 'object';
}

const firstLine = (text) => (typeof text === 'string' ? text.split('\n')[0].trim() : '');

/** A finished job of the history; null while it is still post-processed. */
function parseJob(slot) {
  const state = String(slot?.status ?? '').toLowerCase();
  const outcome =
    state === 'completed' ? OUTCOMES.COMPLETED : state === 'failed' ? OUTCOMES.FAILED : null;
  if (!outcome || !slot.nzo_id) {
    return null;
  }
  const category = typeof slot.category === 'string' && slot.category !== '*' ? slot.category : '';
  return {
    id: String(slot.nzo_id),
    name: String(slot.name ?? slot.nzb_name ?? ''),
    category,
    outcome,
    at: (toNumber(slot.completed) ?? 0) * 1000,
    bytes: Math.max(0, toNumber(slot.bytes) ?? 0),
    reason: outcome === OUTCOMES.FAILED ? firstLine(slot.fail_message) : '',
  };
}
