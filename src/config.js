// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to two download clients, each in its own slot: the software (SABnzbd or
// NZBGet), its address, its credentials (an API key for SABnzbd, a user name
// and a password for NZBGet), a name and the speed of the line. The slot
// number is the device identity: changing the address of a slot (an IP for a
// name, HTTP for HTTPS) keeps the device and its history.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2];

export const SOFTWARE = Object.freeze({ SABNZBD: 'sabnzbd', NZBGET: 'nzbget' });

// Port each client listens on out of the box, added to a bare host.
export const DEFAULT_PORTS = Object.freeze({ [SOFTWARE.SABNZBD]: 8080, [SOFTWARE.NZBGET]: 6789 });

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['10', '30', '60', '120', '300'];

// Highest line speed accepted, in Mbit/s (10 Gbit/s).
export const MAX_LINE_SPEED_MBITS = 10_000;

const slotDefaults = (slot) => ({
  [`client_${slot}_software`]: SOFTWARE.SABNZBD,
  [`client_${slot}_url`]: '',
  [`client_${slot}_api_key`]: '',
  [`client_${slot}_username`]: '',
  [`client_${slot}_password`]: '',
  [`client_${slot}_name`]: '',
  [`client_${slot}_line_speed`]: 0,
});

export const DEFAULT_CONFIG = {
  ...slotDefaults(1),
  ...slotDefaults(2),
  allow_self_signed: false,
  poll_interval: '30',
  language: 'fr',
};

const MAX_NAME_LENGTH = 40;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, `nas.local:8080`), or the URL copied from the browser
 * (`http://192.0.2.10:8080/sabnzbd/`). HTTP by default; a bare host without
 * port gets the default port of the software. A path is kept (a reverse proxy
 * may serve the client under `/sabnzbd`), without a trailing `/api`,
 * `/jsonrpc` or slash.
 * @param {unknown} raw
 * @param {string} [software]
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseClientUrl(raw, software = SOFTWARE.SABNZBD) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (url.username || url.password) {
    return null;
  }
  if (!hasScheme && !url.port && DEFAULT_PORTS[software]) {
    url.port = String(DEFAULT_PORTS[software]);
  }
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/(api|jsonrpc)$/i, '')
    .replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  // Secrets are kept as typed: spaces may be part of them.
  const secret = (key) => (typeof source[key] === 'string' ? source[key] : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const clients = [];
  const invalid = [];
  for (const slot of SLOTS) {
    const typed = text(`client_${slot}_url`);
    if (!typed) {
      continue;
    }
    const software = Object.values(SOFTWARE).includes(source[`client_${slot}_software`])
      ? source[`client_${slot}_software`]
      : DEFAULT_CONFIG[`client_${slot}_software`];
    const url = parseClientUrl(typed, software);
    if (!url) {
      invalid.push(slot);
      continue;
    }
    const lineSpeed = Number(String(source[`client_${slot}_line_speed`] ?? '').replace(',', '.'));
    clients.push({
      slot,
      software,
      url,
      apiKey: secret(`client_${slot}_api_key`).trim(),
      username: text(`client_${slot}_username`),
      password: secret(`client_${slot}_password`),
      name: text(`client_${slot}_name`).slice(0, MAX_NAME_LENGTH) || null,
      // Mbit/s -> bytes per second; 0 when unknown.
      lineBps:
        Number.isFinite(lineSpeed) && lineSpeed > 0
          ? (Math.min(lineSpeed, MAX_LINE_SPEED_MBITS) * 1_000_000) / 8
          : 0,
    });
  }

  return {
    clients,
    invalidSlots: invalid,
    allowSelfSigned: source.allow_self_signed === true || source.allow_self_signed === 'true',
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
