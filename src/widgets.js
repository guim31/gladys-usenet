// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `usenet`.
//
// The use case: a glance at the wall tablet ("is the download still running,
// how long?"), and a pause when the line is needed (a video call, a game).
// So the widget shows the speed, the queue and the time left, one status row
// per client (its state, free space, last download, errors), and three direct
// buttons: Pause (until resumed), Pause 30 min, Resume. No form button: it
// would need Gladys 5.2.0, and the scene action covers other durations.
//
// Every client by default, or the one chosen in the widget settings.
//
// Budget (8 components, 6 tiles, 1 status, 4 buttons): three tiles, one
// status list, three buttons. The figures are sent as values, not bound to
// device features, so the widget works before the devices are added to
// Gladys and sums two clients.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { ERROR_KINDS } from './clients/errors.js';
import { GB, MB, STATUSES, recentProblems } from './clients/model.js';
import { ERRORS_WINDOW_MS, clientName, lastCompleted } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { STATUS_TEXT, decimal, pick } from './texts.js';

// Action keys of the buttons: permanent once published (unique, the core
// drops a button whose key is taken).
export const ACTIONS = Object.freeze({
  PAUSE: 'pause',
  PAUSE_30: 'pause_30',
  RESUME: 'resume',
});
export const SHORT_PAUSE_MINUTES = 30;

const ACTIVE_ICON = 'check-circle';

export const TEXT = {
  pick: {
    en: 'Enter the address of SABnzbd or NZBGet in the configuration of the integration.',
    fr: "Saisissez l'adresse de SABnzbd ou de NZBGet dans la configuration de l'intégration.",
    de: 'Gib die Adresse von SABnzbd oder NZBGet in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de SABnzbd o NZBGet en la configuración de la integración.',
  },
  unknown: {
    en: 'This client is no longer in the configuration: choose another one in the widget settings.',
    fr: "Ce client n'est plus dans la configuration : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieser Client ist nicht mehr in der Konfiguration: Wähle einen anderen in den Widget-Einstellungen.',
    es: 'Este cliente ya no está en la configuración: elija otro en la configuración del widget.',
  },
  noAnswer: {
    en: 'No download client answers: see the Configuration screen of the integration.',
    fr: "Aucun client de téléchargement ne répond : voir l'écran Configuration de l'intégration.",
    de: 'Kein Download-Client antwortet: Sieh dir die Konfiguration der Integration an.',
    es: 'Ningún cliente de descarga responde: consulte la pantalla de configuración de la integración.',
  },
  speed: { en: 'Speed', fr: 'Vitesse', de: 'Geschwindigkeit', es: 'Velocidad' },
  queue: { en: 'Queue', fr: "File d'attente", de: 'Warteschlange', es: 'Cola' },
  timeLeft: { en: 'Time left', fr: 'Temps restant', de: 'Restzeit', es: 'Tiempo restante' },
  free: { en: 'Free space', fr: 'Espace libre', de: 'Freier Speicher', es: 'Espacio libre' },
  last: {
    en: 'Last download',
    fr: 'Dernier téléchargement',
    de: 'Letzter Download',
    es: 'Última descarga',
  },
  errors: { en: 'Errors (24 h)', fr: 'Erreurs (24 h)', de: 'Fehler (24 h)', es: 'Errores (24 h)' },
  limit: { en: 'Speed limit', fr: 'Limite de vitesse', de: 'Begrenzung', es: 'Límite' },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  waiting: { en: 'Waiting…', fr: 'En attente…', de: 'Warte…', es: 'Esperando…' },
  until: { en: 'until', fr: "jusqu'à", de: 'bis', es: 'hasta' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  pause30: { en: 'Pause 30 min', fr: 'Pause 30 min', de: 'Pause 30 min', es: 'Pausa 30 min' },
  resume: { en: 'Resume', fr: 'Reprendre', de: 'Fortsetzen', es: 'Reanudar' },
};

// Toasts after a tap (≤ 200 characters).
export const DONE_TEXT = {
  en: {
    paused: (count) => `Downloads paused on ${count} client(s).`,
    pausedFor: (minutes, count) => `Downloads paused for ${minutes} min on ${count} client(s).`,
    resumed: (count) => `Downloads resumed on ${count} client(s).`,
  },
  fr: {
    paused: (count) => `Téléchargements en pause sur ${count} client(s).`,
    pausedFor: (minutes, count) =>
      `Téléchargements en pause pour ${minutes} min sur ${count} client(s).`,
    resumed: (count) => `Téléchargements repris sur ${count} client(s).`,
  },
  de: {
    paused: (count) => `Downloads auf ${count} Client(s) pausiert.`,
    pausedFor: (minutes, count) => `Downloads für ${minutes} min auf ${count} Client(s) pausiert.`,
    resumed: (count) => `Downloads auf ${count} Client(s) fortgesetzt.`,
  },
  es: {
    paused: (count) => `Descargas en pausa en ${count} cliente(s).`,
    pausedFor: (minutes, count) =>
      `Descargas en pausa durante ${minutes} min en ${count} cliente(s).`,
    resumed: (count) => `Descargas reanudadas en ${count} cliente(s).`,
  },
};

// Day letter of a long time left: "2 d 4 h", "2 j 4 h"…
const DAY = { en: 'd', fr: 'j', de: 'T', es: 'd' };

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Seconds as a short duration that fits a tile (≤ 12 characters). */
export function formatDuration(seconds, language) {
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
  }
  return fit(`${Math.floor(hours / 24)} ${DAY[language] ?? DAY.en} ${hours % 24} h`, 12);
}

/** "14:30" in the time zone of Gladys (TZ, injected by the supervisor). */
const clock = (at, language) =>
  new Date(at).toLocaleTimeString(language === 'en' ? 'en-GB' : language, {
    hour: '2-digit',
    minute: '2-digit',
  });

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The rows of one client: state, then its details when it answers. */
function clientRows(record, language, { now, prefix }) {
  const name = clientName(record.client);
  const label = (text) => fit(prefix ? `${text} · ${name}` : text, 40);
  if (record.error) {
    const unreachable = record.error.kind === ERROR_KINDS.UNREACHABLE;
    return [
      {
        label: fit(name, 40),
        icon: 'alert-triangle',
        value: t(unreachable ? STATUS_TEXT.unreachable : TEXT.error, language),
        color: WIDGET_COLORS.DANGER,
      },
    ];
  }
  const { snapshot } = record;
  if (!snapshot) {
    return [
      {
        label: fit(name, 40),
        icon: 'clock',
        value: t(TEXT.waiting, language),
        color: WIDGET_COLORS.NEUTRAL,
      },
    ];
  }
  const state = { label: fit(name, 40), value: t(STATUS_TEXT[snapshot.status], language) };
  if (snapshot.status === STATUSES.DOWNLOADING) {
    Object.assign(state, { icon: 'download', color: WIDGET_COLORS.SUCCESS });
  } else if (snapshot.status === STATUSES.PAUSED) {
    Object.assign(state, { icon: 'pause-circle', color: WIDGET_COLORS.WARNING });
    if (snapshot.pauseEndsAt) {
      state.value = `${state.value} · ${t(TEXT.until, language)} ${clock(snapshot.pauseEndsAt, language)}`;
    }
  } else if (snapshot.status === STATUSES.POST_PROCESSING) {
    Object.assign(state, { icon: 'package', color: WIDGET_COLORS.INFO });
  } else {
    Object.assign(state, { icon: 'check', color: WIDGET_COLORS.NEUTRAL });
  }
  state.value = fit(state.value, 40);
  const rows = [state];
  if (snapshot.limitBps) {
    rows.push({
      label: label(t(TEXT.limit, language)),
      icon: 'sliders',
      value: `${decimal(snapshot.limitBps / MB, language)} MB/s`,
      color: WIDGET_COLORS.WARNING,
    });
  }
  if (snapshot.freeBytes !== null) {
    rows.push({
      label: label(t(TEXT.free, language)),
      icon: 'hard-drive',
      value: `${decimal(snapshot.freeBytes / GB, language)} GB`,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  const last = lastCompleted(snapshot);
  if (last) {
    rows.push({
      label: label(t(TEXT.last, language)),
      icon: 'check-circle',
      value: fit(last.name, 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  const errors = recentProblems(snapshot, now, ERRORS_WINDOW_MS).length;
  if (errors > 0) {
    rows.push({
      label: label(t(TEXT.errors, language)),
      icon: 'alert-circle',
      value: errors,
      color: WIDGET_COLORS.WARNING,
    });
  }
  return rows;
}

export function buttons(records, language) {
  const answering = records.filter((record) => record.snapshot && !record.error);
  const allPaused =
    answering.length > 0 &&
    answering.every((record) => record.snapshot.paused && !record.snapshot.pauseEndsAt);
  const allRunning = answering.length > 0 && answering.every((record) => !record.snapshot.paused);
  // The current state shows as a check mark, never as the style (`primary`
  // is invisible in dark mode).
  return [
    {
      type: 'button',
      label: t(TEXT.pause, language),
      icon: allPaused ? ACTIVE_ICON : 'pause',
      style: 'secondary',
      action: { key: ACTIONS.PAUSE },
    },
    {
      type: 'button',
      label: t(TEXT.pause30, language),
      icon: 'clock',
      style: 'secondary',
      action: { key: ACTIONS.PAUSE_30, params: { minutes: SHORT_PAUSE_MINUTES } },
    },
    {
      type: 'button',
      label: t(TEXT.resume, language),
      icon: allRunning ? ACTIVE_ICON : 'play',
      style: 'secondary',
      action: { key: ACTIONS.RESUME },
    },
  ];
}

async function get(hub, { settings, language = 'en' }) {
  if (hub.records.size === 0) {
    return message(TEXT.pick, language);
  }
  const records = hub.view(settings?.device);
  if (records.length === 0) {
    return message(TEXT.unknown, language);
  }
  const answering = records.filter((record) => record.snapshot && !record.error);
  const components = [];
  if (answering.length) {
    const speed = answering.reduce((sum, record) => sum + record.snapshot.speedBps, 0);
    const queue = answering.reduce((sum, record) => sum + record.snapshot.queueCount, 0);
    const left = Math.max(...answering.map((record) => record.snapshot.timeLeftSec));
    components.push(
      {
        type: 'value',
        value: Math.round((speed / MB) * 10) / 10,
        unit: 'MB/s',
        label: t(TEXT.speed, language),
        icon: 'download',
        color: speed > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
      },
      { type: 'value', value: queue, label: t(TEXT.queue, language), icon: 'list' },
      {
        type: 'value',
        value: left > 0 ? formatDuration(left, language) : '—',
        label: t(TEXT.timeLeft, language),
        icon: 'clock',
      },
    );
  } else if (records.every((record) => record.error)) {
    components.push({ type: 'text', variant: 'body', text: t(TEXT.noAnswer, language) });
  }
  const now = hub.now();
  const items = records.flatMap((record) =>
    clientRows(record, language, { now, prefix: records.length > 1 }),
  );
  components.push({ type: 'status', items: items.slice(0, 10) });
  components.push(...buttons(records, language));
  const downloading = answering.some((record) => record.snapshot.speedBps > 0);
  // A download moves: refresh sooner.
  return { ttl_seconds: downloading ? 15 : 60, components };
}

async function action(hub, { actionKey, settings }) {
  const device = settings?.device || null;
  const done = (render) =>
    Object.fromEntries(Object.entries(DONE_TEXT).map(([lang, text]) => [lang, render(text)]));
  if (actionKey === ACTIONS.RESUME) {
    const count = await hub.resume(device);
    return { message: done((text) => text.resumed(count)) };
  }
  if (actionKey === ACTIONS.PAUSE) {
    const count = await hub.pause(device, 0);
    return { message: done((text) => text.paused(count)) };
  }
  if (actionKey === ACTIONS.PAUSE_30) {
    const count = await hub.pause(device, SHORT_PAUSE_MINUTES);
    return { message: done((text) => text.pausedFor(SHORT_PAUSE_MINUTES, count)) };
  }
  throw new Error(`Unknown action ${actionKey}`);
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
