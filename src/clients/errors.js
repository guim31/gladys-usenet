// -----------------------------------------------------------------------------
// The errors of the two clients, sorted by what the user can do about them.
// Messages are English, for the logs, and never contain a secret: the texts
// shown in Gladys come from src/texts.js, by kind.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address or port, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // API key, user name or password refused
  NOT_CLIENT: 'not_client', // something answers, not the chosen software
  REDIRECT: 'redirect', // the address redirects (usually to HTTPS or a login page)
  HTTP: 'http', // any other answer the client cannot use
  LINE_SPEED: 'line_speed', // a speed limit in % without a known maximum speed
});

export class ClientError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'ClientError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** A network failure of node:http(s), as a ClientError. */
export function networkError(err) {
  if (TLS_CODES.has(err.code)) {
    return new ClientError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
  }
  return new ClientError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
}

/** A redirect target fit for the logs: no user, password or query string. */
export function safeLocation(location) {
  if (typeof location !== 'string' || location === '') {
    return '?';
  }
  try {
    const url = new URL(location, 'http://relative.invalid');
    return url.host === 'relative.invalid' ? url.pathname : `${url.origin}${url.pathname}`;
  } catch {
    return '?';
  }
}

export function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
