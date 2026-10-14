// -----------------------------------------------------------------------------
// The Usenet hub: one record per configured download client, read on a timer
// of the container (the interval chosen in the configuration), its states
// published to Gladys when they change, its scene events fired when a job
// completes or fails, and the commands of the devices, the widget and the
// scene actions (pause, resume, speed limit).
//
// Gladys never polls these devices (should_poll: false): the core does not
// poll the external devices reliably (GladysAssistant/Gladys#3198), the
// configurable interval goes up to 5 minutes, beyond the fixed list of the
// core scheduler, and the scene events must fire even for a client whose
// device was not added.
//
// States: only for the devices the user added, only what changed
// (publishChangedStates of the SDK), every value again after 6 hours unchanged
// so the dashboard never shows "no recent value".
//
// Logs stay quiet: a normal reading writes at the debug level only; a failure
// that repeats on every reading writes one line when it starts and one when
// it ends. A refused API key or password is never retried on the timer: each
// refused key adds a warning in SABnzbd. Saving the configuration, "Test the
// connection" or a command try again.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { SOFTWARE } from './config.js';
import { ERROR_KINDS } from './clients/errors.js';
import { NzbgetClient } from './clients/nzbget.js';
import { SabnzbdClient } from './clients/sabnzbd.js';
import { MB, OUTCOMES, limitPercent, recentProblems } from './clients/model.js';
import {
  ERRORS_WINDOW_MS,
  FEATURE_KEYS,
  SOFTWARE_NAMES,
  buildDevice,
  clientName,
  deviceIds,
  deviceStates,
  slotOf,
  unreachableState,
} from './devices.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  STATUS_TEXT,
  decimal,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'usenet-hub' });

export const WIDGET_KEY = 'usenet';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  COMPLETED: 'download_completed',
  FAILED: 'download_failed',
});

export const HUB_TIMINGS = {
  // A client that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before a client counts as unreachable.
  downAfterFailures: 2,
  // An unchanged value is sent again after this long (the front shows "no
  // recent value" past 48 hours; the maintainer rule is 12 hours at most).
  heartbeatMs: 6 * 3600_000,
  // Jobs finished while the integration was stopped are announced after a
  // restart if they are at most this old.
  catchUpMs: 60 * 60_000,
};

// Longest pause accepted from a scene or the widget: one week.
export const MAX_PAUSE_MINUTES = 10_080;
// The ids of finished jobs remembered per client (the history shows 20).
const MAX_SEEN = 200;
const MAX_TRANSPORTS_PER_REQUEST = 100;

/** Minutes of a pause typed in a scene: a number, or a string ("30", "2,5"). */
export function parseMinutes(raw) {
  const number =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim().replace(',', '.'))
        : 0;
  if (!Number.isFinite(number) || number <= 0) {
    return 0;
  }
  return Math.min(MAX_PAUSE_MINUTES, Math.max(1, Math.round(number)));
}

/** A speed limit typed in a scene or sent by the slider: 1 to 100 %. */
export function parsePercent(raw) {
  const number =
    typeof raw === 'number'
      ? raw
      : Number(
          String(raw ?? '')
            .trim()
            .replace(',', '.'),
        );
  if (!Number.isFinite(number)) {
    return 100;
  }
  return Math.min(100, Math.max(1, Math.round(number)));
}

const identity = (client) => JSON.stringify([client.software, client.url]);
const signature = (client, config) =>
  JSON.stringify([
    client.software,
    client.url,
    client.apiKey,
    client.username,
    client.password,
    config.allowSelfSigned,
  ]);

export class UsenetHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/clients/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** @type {Map<number, object>} client records, by slot */
    this.records = new Map();
    this.transports = new Map();
    this.connection = null;
    this.saved = { seen: {} };
    this.pollTimer = null;
    this.stopped = false;
    /** Problems already logged, by key: their repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------

  /** Log a problem once (`level` warn or error), its repeats at debug. */
  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  /** The problem `key` is gone: the next occurrence is logged again. */
  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = { seen: saved.seen && typeof saved.seen === 'object' ? saved.seen : {} };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates();
    this.transports.clear();
    this.connection = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    this.config = config;
    const wanted = new Map(config.clients.map((client) => [client.slot, client]));
    for (const [slot, record] of this.records) {
      const client = wanted.get(slot);
      if (!client || record.signature !== signature(client, config)) {
        record.dropped = true;
        clearTimeout(record.retryTimer);
        this.records.delete(slot);
      }
    }
    for (const client of config.clients) {
      const record = this.records.get(client.slot);
      if (record) {
        record.client = client; // a new name or line speed: same connection
      } else {
        this.records.set(client.slot, this.newRecord(client, config));
      }
    }
    await this.publishDevices();
    await this.pollAll({ manual: true });
    this.schedulePoll();
  }

  newRecord(client, config) {
    const options = {
      url: client.url,
      insecure: config.allowSelfSigned,
      request: this.request,
      now: this.now,
    };
    return {
      client,
      signature: signature(client, config),
      api:
        client.software === SOFTWARE.NZBGET
          ? new NzbgetClient({ ...options, username: client.username, password: client.password })
          : new SabnzbdClient({ ...options, apiKey: client.apiKey }),
      snapshot: null,
      error: null,
      failures: 0,
      down: false,
      polling: null,
      retryTimer: null,
      dropped: false,
    };
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    for (const record of this.records.values()) {
      clearTimeout(record.retryTimer);
    }
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || this.records.size === 0) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.resolved('poll');
      } catch (err) {
        this.problem('poll', 'Reading failed', err, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Devices ---------------------------------------------------------------

  async publishDevices() {
    const devices = [...this.records.values()].map((record) =>
      buildDevice(this.gladys, record.client, this.config.language),
    );
    // Even an empty list: the Discovery tab then shows no stale client.
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** "Search" in the Discovery tab: publish the devices again, read the clients. */
  async rediscover() {
    await this.publishDevices();
    await this.pollAll({ manual: true });
  }

  /** The device external ids the user added in Gladys. */
  createdIds() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  /** The user added a device: its states sent before it existed were dropped. */
  async onDeviceCreated(device) {
    const slot = slotOf(this.gladys, device.external_id);
    const record = slot === null ? null : this.records.get(slot);
    if (!record) {
      return;
    }
    this.transports.delete(device.external_id);
    await this.publishStates(record, { force: true, created: device.external_id });
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Reading the clients ---------------------------------------------------

  /**
   * Read every client. `manual`: also the clients whose key was refused (a
   * new configuration, "Test the connection", "Search").
   */
  async pollAll({ manual = false } = {}) {
    const records = [...this.records.values()];
    const changes = await Promise.all(records.map((record) => this.poll(record, { manual })));
    await this.afterChanges(changes.some(Boolean));
  }

  /** Gladys asks for a refresh (onPoll): read that client now. */
  async pollDevice(device) {
    const slot = slotOf(this.gladys, device.external_id);
    const record = slot === null ? null : this.records.get(slot);
    if (record) {
      await this.afterChanges(await this.poll(record, {}));
    }
  }

  /**
   * Read one client and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll(record, { manual = false } = {}) {
    if (!manual && record.error?.kind === ERROR_KINDS.AUTH) {
      return Promise.resolve(false); // waits for the user (see the header)
    }
    record.polling ??= this.read(record).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record) {
    let snapshot;
    try {
      snapshot = await record.api.read();
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.applyFailure(record, err);
    }
    return this.applySuccess(record, snapshot);
  }

  label(record) {
    return `${SOFTWARE_NAMES[record.client.software]} ${record.client.slot} (${clientName(record.client)})`;
  }

  async applySuccess(record, snapshot) {
    if (record.dropped) {
      return false;
    }
    const previous = record.snapshot;
    if (record.down) {
      logger.info(`${this.label(record)} answers again`);
    } else if (record.error) {
      logger.info(`${this.label(record)}: connection restored`);
    } else if (previous === null) {
      logger.info(
        `${this.label(record)}: connected${snapshot.version ? ` (version ${snapshot.version})` : ''}`,
      );
    }
    const widgetChanged =
      previous === null ||
      record.error !== null ||
      previous.status !== snapshot.status ||
      previous.queueCount !== snapshot.queueCount ||
      previous.paused !== snapshot.paused ||
      previous.limitBps !== snapshot.limitBps;
    record.failures = 0;
    record.down = false;
    record.error = null;
    clearTimeout(record.retryTimer);
    record.snapshot = snapshot;
    await this.announceJobs(record, snapshot);
    await this.publishStates(record);
    return widgetChanged;
  }

  async applyFailure(record, err) {
    if (record.dropped) {
      return false;
    }
    const wasError = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    // One warning when the problem starts (or changes), not one per reading.
    if (wasError !== err.kind) {
      logger.warn(`${this.label(record)}: ${err.message}`);
    } else {
      logger.debug(`${this.label(record)}: ${err.message} (again)`);
    }
    if (err.kind === ERROR_KINDS.AUTH) {
      record.failures = 0;
      return wasError !== err.kind;
    }
    record.failures += 1;
    if (record.failures === 1) {
      this.scheduleRetry(record);
    }
    if (!record.down && record.failures >= this.timings.downAfterFailures) {
      record.down = true;
      await this.publishStates(record);
      return true;
    }
    return wasError !== err.kind;
  }

  scheduleRetry(record) {
    clearTimeout(record.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.retryTimer = setTimeout(() => {
      this.poll(record)
        .then((changed) => this.afterChanges(changed))
        .then(() => this.resolved('retry'))
        .catch((err) => this.problem('retry', 'Retry failed', err, 'error'));
    }, this.timings.retryMs);
    record.retryTimer.unref?.();
  }

  // --- Scene events ----------------------------------------------------------

  /**
   * Fire "download completed" / "download failed" once per finished job. The
   * first reading of a client only remembers its history; after a restart,
   * the jobs finished meanwhile (within `catchUpMs`) are announced.
   */
  async announceJobs(record, snapshot) {
    const slot = String(record.client.slot);
    const key = identity(record.client);
    const entry = this.saved.seen[slot];
    const ids = snapshot.jobs.map((job) => job.id);
    if (!entry || entry.key !== key) {
      this.saved.seen[slot] = { key, ids: ids.slice(0, MAX_SEEN) };
      this.store.save(this.saved);
      return;
    }
    const seen = new Set(entry.ids);
    // Oldest first; the clients list the newest first, so jobs finished in
    // the same second keep their order once reversed.
    const fresh = snapshot.jobs
      .filter((job) => !seen.has(job.id))
      .reverse()
      .sort((a, b) => a.at - b.at);
    if (fresh.length === 0) {
      return;
    }
    entry.ids = [...ids, ...entry.ids.filter((id) => !ids.includes(id))].slice(0, MAX_SEEN);
    this.store.save(this.saved);
    for (const job of fresh) {
      if (job.at < this.now() - this.timings.catchUpMs) {
        continue;
      }
      const failed = job.outcome === OUTCOMES.FAILED;
      logger.debug(`${this.label(record)}: ${job.outcome} "${job.name}"`);
      await this.fire(failed ? TRIGGERS.FAILED : TRIGGERS.COMPLETED, record, {
        name: job.name,
        category: job.category,
        ...(failed ? { reason: job.reason } : { size_mb: Math.round(job.bytes / MB) }),
      });
    }
  }

  async fire(key, record, data) {
    try {
      await this.gladys.publishSceneEvent(key, {
        device: deviceIds(this.gladys, record.client.slot).device,
        client: clientName(record.client),
        ...data,
      });
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys --------------------------------------------------

  context(record) {
    return { language: this.config.language, lineBps: record.client.lineBps, now: this.now() };
  }

  /** The states of a client's device, if the user added it. */
  async publishStates(record, { force = false, created = null } = {}) {
    const deviceId = deviceIds(this.gladys, record.client.slot).device;
    if (created !== deviceId && !this.createdIds().has(deviceId)) {
      return;
    }
    let states;
    if (record.snapshot && !record.down) {
      states = deviceStates(this.gladys, record.client.slot, record.snapshot, this.context(record));
    } else if (record.down) {
      states = [unreachableState(this.gladys, record.client.slot, this.config.language)];
    } else {
      return;
    }
    try {
      if (force) {
        this.gladys.forgetPublishedStates(deviceId);
      }
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States of ${this.label(record)} refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged) {
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: "local", or "unreachable". */
  async publishTransports() {
    const created = this.createdIds();
    const entries = [];
    for (const record of this.records.values()) {
      const externalId = deviceIds(this.gladys, record.client.slot).device;
      if (!created.has(externalId) || (record.snapshot === null && record.error === null)) {
        continue;
      }
      const transport =
        record.error === null ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.resolved('transports');
      } catch (err) {
        this.problem('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name: connected while a client answers. */
  connectionStatus() {
    const { clients, invalidSlots } = this.config;
    if (clients.length === 0) {
      return {
        connected: false,
        message: invalidSlots.length ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noClient,
      };
    }
    const failing = [...this.records.values()].filter((record) => record.error);
    if (failing.length === 0 && invalidSlots.length === 0) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noClient)) {
      const parts = failing.map((record) =>
        labelled(
          clientName(record.client),
          pick(ERROR_TEXT[record.error.kind], language),
          language,
        ),
      );
      if (invalidSlots.length) {
        parts.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = parts.join(' · ').slice(0, 200);
    }
    return { connected: failing.length < this.records.size, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands --------------------------------------------------------------

  /**
   * The clients a command targets: one device, or every configured client.
   * @param {string|null|undefined} deviceExternalId
   */
  targets(deviceExternalId) {
    const language = this.config?.language;
    if (this.records.size === 0) {
      throw new Error(pick(ACTION_TEXT.noClient, language));
    }
    if (!deviceExternalId) {
      return [...this.records.values()];
    }
    const slot = slotOf(this.gladys, deviceExternalId);
    const record = slot === null ? null : this.records.get(slot);
    if (!record) {
      throw new Error(pick(ACTION_TEXT.unknownClient, language));
    }
    return [record];
  }

  /**
   * Run a command on the targeted clients, read them again, and resolve with
   * the number of clients that accepted it.
   * @param {string|null} deviceExternalId
   * @param {(record: object) => Promise<void>} command
   * @param {string} description for the logs ("paused for 30 min")
   */
  async command(deviceExternalId, command, description) {
    const records = this.targets(deviceExternalId);
    const errors = [];
    const results = await Promise.all(
      records.map(async (record) => {
        try {
          await command(record);
          logger.info(`${this.label(record)}: ${description}`);
          // A reading started before the command would publish the old state.
          await record.polling;
          await this.poll(record, { manual: true });
          return true;
        } catch (err) {
          if (!err.kind) {
            throw err;
          }
          logger.warn(`${this.label(record)}: command failed: ${err.message}`);
          errors.push({ record, kind: err.kind });
          if (err.kind !== ERROR_KINDS.LINE_SPEED) {
            await this.applyFailure(record, err);
          }
          return false;
        }
      }),
    );
    await this.afterChanges(true);
    const done = results.filter(Boolean).length;
    if (done === 0) {
      const language = this.config.language;
      // One reason for every client (a missing line speed, a client down):
      // say it, with the names; mixed reasons: the logs tell.
      const kinds = new Set(errors.map((error) => error.kind));
      throw new Error(
        errors.length === records.length && kinds.size === 1
          ? labelled(
              errors.map((error) => clientName(error.record.client)).join(', '),
              pick(ERROR_TEXT[errors[0].kind], language),
              language,
            )
          : pick(ACTION_TEXT.failed, language),
      );
    }
    return done;
  }

  /** Pause the downloads for `minutes` (0: until resumed). */
  pause(deviceExternalId, minutes = 0) {
    return this.command(
      deviceExternalId,
      (record) => record.api.pause(minutes),
      minutes ? `downloads paused for ${minutes} min` : 'downloads paused',
    );
  }

  resume(deviceExternalId) {
    return this.command(deviceExternalId, (record) => record.api.resume(), 'downloads resumed');
  }

  /** Limit the speed to `percent` of the line (100: no limit). */
  setSpeedLimit(deviceExternalId, percent) {
    return this.command(
      deviceExternalId,
      (record) => record.api.setSpeedLimit(percent, record.client.lineBps),
      percent >= 100 ? 'speed limit removed' : `speed limited to ${percent} %`,
    );
  }

  /** The two controls of a device: "paused" and "speed limit". */
  async setValue(device, feature, value) {
    const slot = slotOf(this.gladys, device.external_id);
    const ids = slot === null ? null : deviceIds(this.gladys, slot);
    if (ids && feature.external_id === ids.feature(FEATURE_KEYS.PAUSED)) {
      await (Number(value) === 1
        ? this.pause(device.external_id, 0)
        : this.resume(device.external_id));
      return;
    }
    if (ids && feature.external_id === ids.feature(FEATURE_KEYS.SPEED_LIMIT)) {
      await this.setSpeedLimit(device.external_id, parsePercent(value));
      return;
    }
    throw new Error(`Feature ${feature.external_id} cannot be controlled`);
  }

  // --- Reports ---------------------------------------------------------------

  /** "Test the connection": read every client now, one line each. */
  async testConnection() {
    await this.pollAll({ manual: true });
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (this.records.size === 0) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      const lines = [...this.records.values()].map((record) => {
        const name = clientName(record.client);
        if (record.error) {
          return labelled(name, pick(ERROR_TEXT[record.error.kind], language), language);
        }
        const { snapshot } = record;
        const parts = [text.ok];
        parts.push(
          `${SOFTWARE_NAMES[record.client.software]}${snapshot.version ? ` ${snapshot.version}` : ''}`,
        );
        let state = pick(STATUS_TEXT[snapshot.status], language);
        if (snapshot.speedBps > 0) {
          state += ` ${decimal(snapshot.speedBps / MB, language)} MB/s`;
        }
        parts.push(state, text.queue(snapshot.queueCount));
        const problems = recentProblems(snapshot, this.now(), ERRORS_WINDOW_MS).length;
        if (problems) {
          parts.push(text.errors(problems));
        }
        if (snapshot.limitBps && limitPercent(snapshot, record.client.lineBps) === null) {
          parts.push(text.noLimit);
        }
        return labelled(name, parts.join(', '), language);
      });
      // Addresses that could not be read are not records: say it too.
      if (this.config.invalidSlots.length) {
        lines.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = lines.join('\n');
    }
    return message;
  }

  /** What the widget shows, for one client or all of them. */
  view(deviceExternalId) {
    if (!deviceExternalId) {
      return [...this.records.values()];
    }
    const slot = slotOf(this.gladys, deviceExternalId);
    const record = slot === null ? null : this.records.get(slot);
    return record ? [record] : [];
  }
}
