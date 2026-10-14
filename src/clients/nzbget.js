// -----------------------------------------------------------------------------
// NZBGet client: the JSON-RPC API (`POST /jsonrpc`, documented at
// https://nzbget.com/documentation/api/), with the control user name and
// password in HTTP Basic authentication.
//
// What a reading costs: `status` and `listgroups` every time; `log` from the
// last message already read (only the new lines); `history` only when the
// queue moved, something was downloaded or post-processed, or every 15
// minutes: NZBGet sends its whole history, every job ever kept, several KB
// each. Behaviours checked on real NZBGet 21.0 and 26.3 (test/fixtures/nzbget):
//
//   - every call is a POST: NZBGet refuses the commands sent as GET ("Not
//     safe procedure for HTTP-Method GET");
//   - a wrong password answers 401 with an empty body;
//   - 64-bit sizes come as two 32-bit halves (`…Lo`, `…Hi`); a free disk space
//     NZBGet cannot read comes as 0xFFFFFFFF in both halves (seen on 21.0);
//   - `pausedownload` cancels a pending timed resume; `scheduleresume(0)` does
//     not resume, it stamps ResumeTime with the current time: only a ResumeTime
//     ahead of ServerTime, while paused, is a timed pause. NZBGet checks it
//     every few seconds (up to ~25 s late);
//   - `log(0, N)` returns the last N messages, `log(ID, 0)` the messages from
//     ID on; the IDs start again at 1 when NZBGet restarts.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';
import { ClientError, ERROR_KINDS, networkError, parseJson, safeLocation } from './errors.js';
import { KB, OUTCOMES, STATUSES, join64, toNumber } from './model.js';

const HISTORY_MAX_AGE_MS = 15 * 60_000;
const VERSION_MAX_AGE_MS = 60 * 60_000;
const LOG_BOOTSTRAP = 100;
const MAX_PROBLEMS = 100;
const MAX_JOBS = 20;
const UNKNOWN_32 = 0xffffffff;

// Queue states of a job still to download (the others are post-processing).
const DOWNLOAD_STATES = new Set(['QUEUED', 'PAUSED', 'DOWNLOADING', 'FETCHING']);

export class NzbgetClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host:port[/path]`
   * @param {string} [options.username] ControlUsername (or RestrictedUsername)
   * @param {string} [options.password]
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   * @param {() => number} [options.now]
   */
  constructor({
    url,
    username = '',
    password = '',
    insecure = false,
    request = httpRequest,
    timeoutMs = 10_000,
    now = () => Date.now(),
  }) {
    this.url = `${url}/jsonrpc`;
    this.authorization =
      username || password
        ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
        : null;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.version = { at: 0, value: null };
    this.history = { at: 0, key: null, jobs: [] };
    this.log = { lastId: null, uptime: null, problems: [] };
  }

  // --- Transport -----------------------------------------------------------------

  async rpc(method, params = []) {
    let response;
    try {
      response = await this.request(this.url, {
        method: 'POST',
        headers: this.authorization ? { authorization: this.authorization } : {},
        json: { method, params, id: 1 },
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      throw networkError(err);
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
      throw new ClientError(ERROR_KINDS.AUTH, 'User name or password refused', { status });
    }
    if (status === 404) {
      throw new ClientError(ERROR_KINDS.NOT_CLIENT, 'No NZBGet API at this address', { status });
    }
    if (status !== 200) {
      throw new ClientError(ERROR_KINDS.HTTP, `HTTP ${status}`, { status });
    }
    const data = parseJson(body);
    if (!data || typeof data !== 'object' || !('result' in data || 'error' in data)) {
      throw new ClientError(ERROR_KINDS.NOT_CLIENT, 'The answer is not NZBGet JSON-RPC');
    }
    if (data.error) {
      throw new ClientError(
        ERROR_KINDS.HTTP,
        `NZBGet refused ${method}: ${data.error.message ?? 'error'}`,
      );
    }
    return data.result;
  }

  // --- Reading -------------------------------------------------------------------

  /** Everything the integration shows, as a snapshot (src/clients/model.js). */
  async read() {
    const [status, groups] = await Promise.all([this.rpc('status'), this.rpc('listgroups', [0])]);
    if (!status || typeof status !== 'object' || !Array.isArray(groups)) {
      throw new ClientError(ERROR_KINDS.NOT_CLIENT, 'Unexpected NZBGet status');
    }
    await Promise.all([
      this.readHistory(status, groups),
      this.readLog(status),
      this.readVersion().catch(() => {}),
    ]);
    return this.snapshot(status, groups);
  }

  async readVersion() {
    if (this.now() - this.version.at < VERSION_MAX_AGE_MS) {
      return;
    }
    const value = await this.rpc('version');
    this.version = { at: this.now(), value: typeof value === 'string' ? value : null };
  }

  async readHistory(status, groups) {
    // Something changed when a job left the queue, data came in, or a
    // post-processing started or ended.
    const key = JSON.stringify([
      groups.map((group) => group.NZBID),
      join64(status.DownloadedSizeLo, status.DownloadedSizeHi),
      status.PostJobCount,
    ]);
    if (key === this.history.key && this.now() - this.history.at < HISTORY_MAX_AGE_MS) {
      return;
    }
    const history = await this.rpc('history', [false]);
    this.history = {
      at: this.now(),
      key,
      jobs: (Array.isArray(history) ? history : [])
        .map((item) => parseJob(item))
        .filter(Boolean)
        .sort((a, b) => b.at - a.at)
        .slice(0, MAX_JOBS),
    };
  }

  async readLog(status) {
    const uptime = toNumber(status.UpTimeSec);
    const restarted = uptime !== null && this.log.uptime !== null && uptime < this.log.uptime;
    this.log.uptime = uptime;
    const fresh = this.log.lastId === null || restarted;
    const lines = await this.rpc('log', fresh ? [0, LOG_BOOTSTRAP] : [this.log.lastId + 1, 0]);
    if (!Array.isArray(lines)) {
      return;
    }
    const problems = lines
      .filter((line) => line?.Kind === 'ERROR' || line?.Kind === 'WARNING')
      .map((line) => ({
        at: (toNumber(line.Time) ?? 0) * 1000,
        level: line.Kind === 'ERROR' ? 'error' : 'warning',
        text: typeof line.Text === 'string' ? line.Text.trim() : '',
      }))
      .filter((problem) => problem.text);
    this.log.problems = [...(fresh ? [] : this.log.problems), ...problems].slice(-MAX_PROBLEMS);
    const ids = lines.map((line) => toNumber(line?.ID)).filter((id) => id !== null);
    if (ids.length) {
      this.log.lastId = Math.max(...ids);
    } else if (fresh) {
      this.log.lastId = 0;
    }
  }

  snapshot(status, groups) {
    const paused = status.DownloadPaused === true;
    const speedBps = Math.max(
      0,
      status.DownloadRateLo !== undefined
        ? join64(status.DownloadRateLo, status.DownloadRateHi)
        : (toNumber(status.DownloadRate) ?? 0),
    );
    const remainingBytes = join64(status.RemainingSizeLo, status.RemainingSizeHi);
    const waiting = groups.filter((group) => DOWNLOAD_STATES.has(group.Status));
    const resumeTime = toNumber(status.ResumeTime) ?? 0;
    const serverTime = toNumber(status.ServerTime) ?? 0;
    const free = [
      [status.FreeDiskSpaceLo, status.FreeDiskSpaceHi],
      [status.FreeInterDiskSpaceLo, status.FreeInterDiskSpaceHi],
    ]
      .filter(([lo, hi]) => lo !== undefined && !(lo === UNKNOWN_32 && hi === UNKNOWN_32))
      .map(([lo, hi]) => join64(lo, hi));
    let state;
    if (paused) {
      state = STATUSES.PAUSED;
    } else if (speedBps > 0 || groups.some((group) => group.Status === 'DOWNLOADING')) {
      state = STATUSES.DOWNLOADING;
    } else if ((toNumber(status.PostJobCount) ?? 0) > 0) {
      state = STATUSES.POST_PROCESSING;
    } else if (waiting.length > 0) {
      state = STATUSES.QUEUED;
    } else {
      state = STATUSES.IDLE;
    }
    const current = groups.find((group) => group.Status === 'DOWNLOADING');
    return {
      version: this.version.value,
      status: state,
      paused,
      // A timed pause; ResumeTime is in NZBGet's clock, ServerTime too.
      pauseEndsAt:
        paused && resumeTime > serverTime ? this.now() + (resumeTime - serverTime) * 1000 : null,
      speedBps,
      queueCount: waiting.length,
      remainingBytes,
      timeLeftSec:
        state === STATUSES.DOWNLOADING && speedBps > 0 ? Math.round(remainingBytes / speedBps) : 0,
      freeBytes: free.length ? Math.min(...free) : null,
      limitBps: Math.max(0, toNumber(status.DownloadLimit) ?? 0),
      maxBps: 0,
      current:
        state === STATUSES.DOWNLOADING && typeof current?.NZBName === 'string'
          ? current.NZBName
          : null,
      jobs: this.history.jobs,
      problems: this.log.problems,
    };
  }

  // --- Commands ------------------------------------------------------------------

  /** Pause the downloads, for `minutes` (0: until resumed). */
  async pause(minutes = 0) {
    await this.rpc('pausedownload');
    if (minutes > 0) {
      await this.rpc('scheduleresume', [minutes * 60]);
    }
  }

  async resume() {
    await this.rpc('resumedownload');
  }

  /**
   * Limit the speed to `percent` of the line (100: no limit). NZBGet only
   * knows absolute limits: the percentage needs the line speed of the
   * configuration.
   */
  async setSpeedLimit(percent, lineBps = 0) {
    if (percent >= 100) {
      await this.rpc('rate', [0]);
      return;
    }
    if (!lineBps) {
      throw new ClientError(ERROR_KINDS.LINE_SPEED, 'No line speed configured');
    }
    await this.rpc('rate', [Math.max(1, Math.round((lineBps * percent) / 100 / KB))]);
  }
}

/**
 * A finished job of the history. SUCCESS, and a WARNING of a post-processing
 * script only, are completed downloads; FAILURE and the other WARNING
 * (damaged, password, disk space, health) are failures. DELETED jobs (by hand,
 * duplicates) are neither.
 */
function parseJob(item) {
  const status = String(item?.Status ?? '');
  const [family] = status.split('/');
  let outcome = null;
  if (family === 'SUCCESS' || status === 'WARNING/SCRIPT') {
    outcome = OUTCOMES.COMPLETED;
  } else if (family === 'FAILURE' || family === 'WARNING') {
    outcome = OUTCOMES.FAILED;
  }
  if (!outcome || item.NZBID === undefined) {
    return null;
  }
  return {
    id: String(item.NZBID),
    name: String(item.Name ?? item.NZBName ?? ''),
    category: typeof item.Category === 'string' ? item.Category : '',
    outcome,
    at: (toNumber(item.HistoryTime) ?? 0) * 1000,
    bytes: join64(item.FileSizeLo, item.FileSizeHi),
    reason: outcome === OUTCOMES.FAILED ? status : '',
  };
}
