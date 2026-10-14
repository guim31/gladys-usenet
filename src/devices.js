// -----------------------------------------------------------------------------
// One Gladys device per configured download client (SABnzbd or NZBGet).
//
// Identity: the configuration slot (1 or 2), not the address: switching a
// slot from an IP to a host name, or from HTTP to HTTPS, keeps the device and
// its history. Neither client exposes a stable instance id to use instead.
//
// Features (category/type couples of the core table, see
// test/gladys-rules.test.js), in display order:
//   - paused: switch/binary, writable — 1 downloads paused (until resumed),
//     0 downloading;
//   - speed limit: switch/dimmer (a 1-100 slider), writable — the share of the
//     line, 100 without limit. Nothing is published when a limit is set but
//     no maximum speed is known (neither in SABnzbd nor in the configuration);
//   - download speed: datarate/rate in MB/s (binary, like both clients show);
//   - queue: counter-sensor/integer, the jobs waiting or downloading;
//   - left to download: data/size in GB;
//   - time left: duration/integer in minutes, 0 when nothing downloads;
//   - free space: data/size in GB, the download folders (the smaller of the
//     temporary and final folders);
//   - status: text/text (Downloading, Paused, Post-processing, Waiting, Idle,
//     Unreachable), in the language of the configuration;
//   - last download: text/text, the name of the last completed job;
//   - recent errors: counter-sensor/integer, the errors and warnings the
//     client reported over the last 24 hours.
//
// Published with should_poll: false: the integration reads the clients on its
// own timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { SOFTWARE, hostOf } from './config.js';
import { GB, MB, limitPercent, recentProblems } from './clients/model.js';
import { STATUS_TEXT, pick } from './texts.js';

export const DEVICE_TYPE = 'client';
export const URL_PARAM = 'URL';
export const SOFTWARE_PARAM = 'SOFTWARE';

// Window of the "recent errors" counter.
export const ERRORS_WINDOW_MS = 24 * 3600_000;

export const SOFTWARE_NAMES = Object.freeze({
  [SOFTWARE.SABNZBD]: 'SABnzbd',
  [SOFTWARE.NZBGET]: 'NZBGet',
});

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  PAUSED: 'paused',
  SPEED_LIMIT: 'speed_limit',
  SPEED: 'download_speed',
  QUEUE: 'queue_count',
  LEFT: 'queue_left',
  TIME_LEFT: 'time_left',
  FREE: 'free_space',
  STATUS: 'status',
  LAST: 'last_completed',
  ERRORS: 'recent_errors',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.PAUSED]: 'Downloads paused',
    [FEATURE_KEYS.SPEED_LIMIT]: 'Speed limit',
    [FEATURE_KEYS.SPEED]: 'Download speed',
    [FEATURE_KEYS.QUEUE]: 'Jobs in the queue',
    [FEATURE_KEYS.LEFT]: 'Left to download',
    [FEATURE_KEYS.TIME_LEFT]: 'Time left',
    [FEATURE_KEYS.FREE]: 'Free disk space',
    [FEATURE_KEYS.STATUS]: 'Status',
    [FEATURE_KEYS.LAST]: 'Last download',
    [FEATURE_KEYS.ERRORS]: 'Errors (24 h)',
  },
  fr: {
    [FEATURE_KEYS.PAUSED]: 'Téléchargements en pause',
    [FEATURE_KEYS.SPEED_LIMIT]: 'Limite de vitesse',
    [FEATURE_KEYS.SPEED]: 'Vitesse de téléchargement',
    [FEATURE_KEYS.QUEUE]: "Tâches en file d'attente",
    [FEATURE_KEYS.LEFT]: 'Reste à télécharger',
    [FEATURE_KEYS.TIME_LEFT]: 'Temps restant',
    [FEATURE_KEYS.FREE]: 'Espace disque libre',
    [FEATURE_KEYS.STATUS]: 'État',
    [FEATURE_KEYS.LAST]: 'Dernier téléchargement',
    [FEATURE_KEYS.ERRORS]: 'Erreurs (24 h)',
  },
  de: {
    [FEATURE_KEYS.PAUSED]: 'Downloads pausiert',
    [FEATURE_KEYS.SPEED_LIMIT]: 'Geschwindigkeitsbegrenzung',
    [FEATURE_KEYS.SPEED]: 'Download-Geschwindigkeit',
    [FEATURE_KEYS.QUEUE]: 'Aufträge in der Warteschlange',
    [FEATURE_KEYS.LEFT]: 'Noch herunterzuladen',
    [FEATURE_KEYS.TIME_LEFT]: 'Restzeit',
    [FEATURE_KEYS.FREE]: 'Freier Speicherplatz',
    [FEATURE_KEYS.STATUS]: 'Status',
    [FEATURE_KEYS.LAST]: 'Letzter Download',
    [FEATURE_KEYS.ERRORS]: 'Fehler (24 h)',
  },
  es: {
    [FEATURE_KEYS.PAUSED]: 'Descargas en pausa',
    [FEATURE_KEYS.SPEED_LIMIT]: 'Límite de velocidad',
    [FEATURE_KEYS.SPEED]: 'Velocidad de descarga',
    [FEATURE_KEYS.QUEUE]: 'Tareas en la cola',
    [FEATURE_KEYS.LEFT]: 'Pendiente de descargar',
    [FEATURE_KEYS.TIME_LEFT]: 'Tiempo restante',
    [FEATURE_KEYS.FREE]: 'Espacio libre en disco',
    [FEATURE_KEYS.STATUS]: 'Estado',
    [FEATURE_KEYS.LAST]: 'Última descarga',
    [FEATURE_KEYS.ERRORS]: 'Errores (24 h)',
  },
};

// Display bounds (the core never applies them on write).
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
const sensor = (category, type, extra) => ({
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  ...extra,
});

// Order = display order in Gladys. `value(snapshot, context)` returns a number,
// `{ text }` or null (nothing to publish).
const FEATURES = [
  {
    key: FEATURE_KEYS.PAUSED,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      min: 0,
      max: 1,
    },
    value: (snapshot) => (snapshot.paused ? 1 : 0),
  },
  {
    key: FEATURE_KEYS.SPEED_LIMIT,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.DIMMER,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      min: 1,
      max: 100,
    },
    value: (snapshot, { lineBps }) => limitPercent(snapshot, lineBps),
  },
  {
    key: FEATURE_KEYS.SPEED,
    definition: sensor(DEVICE_FEATURE_CATEGORIES.DATARATE, DEVICE_FEATURE_TYPES.DATARATE.RATE, {
      unit: DEVICE_FEATURE_UNITS.MEGABYTES_PER_SECOND,
      max: 10_000,
    }),
    value: (snapshot) => round(snapshot.speedBps / MB, 2),
  },
  {
    key: FEATURE_KEYS.QUEUE,
    definition: sensor(
      DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
      DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
      { max: 100_000 },
    ),
    value: (snapshot) => snapshot.queueCount,
  },
  {
    key: FEATURE_KEYS.LEFT,
    definition: sensor(DEVICE_FEATURE_CATEGORIES.DATA, DEVICE_FEATURE_TYPES.DATA.SIZE, {
      unit: DEVICE_FEATURE_UNITS.GIGABYTE,
      max: 1_000_000,
    }),
    value: (snapshot) => round(snapshot.remainingBytes / GB, 2),
  },
  {
    key: FEATURE_KEYS.TIME_LEFT,
    definition: sensor(DEVICE_FEATURE_CATEGORIES.DURATION, DEVICE_FEATURE_TYPES.DURATION.INTEGER, {
      unit: DEVICE_FEATURE_UNITS.MINUTES,
      // One year.
      max: 525_600,
    }),
    value: (snapshot) => Math.min(525_600, Math.ceil(snapshot.timeLeftSec / 60)),
  },
  {
    key: FEATURE_KEYS.FREE,
    definition: sensor(DEVICE_FEATURE_CATEGORIES.DATA, DEVICE_FEATURE_TYPES.DATA.SIZE, {
      unit: DEVICE_FEATURE_UNITS.GIGABYTE,
      max: 1_000_000,
    }),
    value: (snapshot) => (snapshot.freeBytes === null ? null : round(snapshot.freeBytes / GB, 1)),
  },
  {
    key: FEATURE_KEYS.STATUS,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: 0,
    },
    value: (snapshot, { language }) => ({ text: pick(STATUS_TEXT[snapshot.status], language) }),
  },
  {
    key: FEATURE_KEYS.LAST,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: 0,
    },
    value: (snapshot) => {
      const last = lastCompleted(snapshot);
      return last ? { text: last.name } : null;
    },
  },
  {
    key: FEATURE_KEYS.ERRORS,
    definition: sensor(
      DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
      DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
      { max: 1000 },
    ),
    value: (snapshot, { now }) =>
      Math.min(1000, recentProblems(snapshot, now, ERRORS_WINDOW_MS).length),
  },
];

/** The last job that completed (not failed), null when none is known. */
export const lastCompleted = (snapshot) =>
  snapshot.jobs.find((job) => job.outcome === 'completed' && job.name) ?? null;

/** External ids of a client's device and features. */
export const deviceIds = (gladys, slot) => gladys.externalIds(DEVICE_TYPE, String(slot));

/** The slot of a device external id, null when it is not one of ours. */
export function slotOf(gladys, externalId) {
  for (const slot of [1, 2]) {
    if (deviceIds(gladys, slot).device === externalId) {
      return slot;
    }
  }
  return null;
}

/** The name shown for a client: the one typed in the configuration, else software and address. */
export const clientName = (client) =>
  client.name ?? `${SOFTWARE_NAMES[client.software]} ${hostOf(client.url)}`;

/**
 * The discovery payload of a client.
 * @param {object} gladys SDK client
 * @param {{ slot: number, software: string, url: string, name: string|null }} client
 * @param {string} language feature names language
 */
export function buildDevice(gladys, client, language = 'en') {
  const ids = deviceIds(gladys, client.slot);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: clientName(client),
    external_id: ids.device,
    should_poll: false,
    params: [
      { name: URL_PARAM, value: client.url },
      { name: SOFTWARE_PARAM, value: SOFTWARE_NAMES[client.software] },
    ],
    features: FEATURES.map(({ key, definition }) => ({
      ...definition,
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The states of a client, in the `publishStates` format (null values left out).
 * @param {object} context { language, lineBps, now }
 */
export function deviceStates(gladys, slot, snapshot, context) {
  const ids = deviceIds(gladys, slot);
  const states = [];
  for (const { key, value } of FEATURES) {
    const result = value(snapshot, context);
    if (result === null || result === undefined) {
      continue;
    }
    const state = { device_feature_external_id: ids.feature(key) };
    if (typeof result === 'object') {
      state.text = result.text;
    } else {
      state.state = result;
    }
    states.push(state);
  }
  return states;
}

/** The single "Unreachable" status of a client that stopped answering. */
export function unreachableState(gladys, slot, language) {
  return {
    device_feature_external_id: deviceIds(gladys, slot).feature(FEATURE_KEYS.STATUS),
    text: pick(STATUS_TEXT.unreachable, language),
  };
}
