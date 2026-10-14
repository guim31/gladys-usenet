// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the state of a client, the "Test the connection"
// report, scene action errors. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks every
// table. Brand names (SABnzbd, NZBGet) are never translated.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './clients/errors.js';
import { STATUSES } from './clients/model.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noClient: {
    en: 'Enter the address of SABnzbd or NZBGet in the configuration.',
    fr: "Saisissez l'adresse de SABnzbd ou de NZBGet dans la configuration.",
    de: 'Gib die Adresse von SABnzbd oder NZBGet in der Konfiguration ein.',
    es: 'Introduzca la dirección de SABnzbd o NZBGet en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.10:8080',
    fr: 'Adresse incomprise, ex. http://192.168.1.10:8080',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.10:8080',
    es: 'Dirección no válida, p. ej. http://192.168.1.10:8080',
  },
};

// One short explanation per error kind (src/clients/errors.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key or password refused: correct it, then save',
    fr: "clé d'API ou mot de passe refusé : corrigez-le, puis enregistrez",
    de: 'API-Schlüssel oder Passwort abgelehnt: Korrigiere ihn und speichere',
    es: 'clave de API o contraseña rechazada: corríjala y guarde',
  },
  [ERROR_KINDS.NOT_CLIENT]: {
    en: 'no SABnzbd or NZBGet at this address: check the software and port',
    fr: 'pas de SABnzbd ni de NZBGet à cette adresse : vérifiez le logiciel et le port',
    de: 'kein SABnzbd oder NZBGet unter dieser Adresse: Prüfe Software und Port',
    es: 'no hay SABnzbd ni NZBGet en esta dirección: compruebe el programa y el puerto',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
  [ERROR_KINDS.LINE_SPEED]: {
    en: 'enter the line speed in the configuration to limit in %',
    fr: 'indiquez le débit de la ligne dans la configuration pour limiter en %',
    de: 'gib die Leitungsgeschwindigkeit in der Konfiguration ein, um in % zu begrenzen',
    es: 'indique la velocidad de la línea en la configuración para limitar en %',
  },
};

// The "Status" feature of a client, and its row in the widget.
export const STATUS_TEXT = {
  [STATUSES.DOWNLOADING]: {
    en: 'Downloading',
    fr: 'Téléchargement',
    de: 'Lädt herunter',
    es: 'Descargando',
  },
  [STATUSES.PAUSED]: { en: 'Paused', fr: 'En pause', de: 'Pausiert', es: 'En pausa' },
  [STATUSES.POST_PROCESSING]: {
    en: 'Post-processing',
    fr: 'Post-traitement',
    de: 'Nachbearbeitung',
    es: 'Posprocesado',
  },
  [STATUSES.QUEUED]: { en: 'Waiting', fr: 'En attente', de: 'Wartet', es: 'En espera' },
  [STATUSES.IDLE]: { en: 'Idle', fr: 'Inactif', de: 'Leerlauf', es: 'Inactivo' },
  unreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
};

// The "Test the connection" report, one line per client.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    queue: (count) => `${count} in the queue`,
    errors: (count) => `${count} error(s) or warning(s) in 24 h`,
    noLimit: 'speed limit in % unavailable: enter the line speed',
  },
  fr: {
    ok: 'OK',
    queue: (count) => `${count} en file d'attente`,
    errors: (count) => `${count} erreur(s) ou avertissement(s) en 24 h`,
    noLimit: 'limite en % indisponible : indiquez le débit de la ligne',
  },
  de: {
    ok: 'OK',
    queue: (count) => `${count} in der Warteschlange`,
    errors: (count) => `${count} Fehler oder Warnung(en) in 24 h`,
    noLimit: 'Begrenzung in % nicht verfügbar: Gib die Leitungsgeschwindigkeit ein',
  },
  es: {
    ok: 'OK',
    queue: (count) => `${count} en la cola`,
    errors: (count) => `${count} error(es) o aviso(s) en 24 h`,
    noLimit: 'límite en % no disponible: indique la velocidad de la línea',
  },
};

// Errors of the scene actions, the device controls and the widget buttons.
export const ACTION_TEXT = {
  noClient: {
    en: 'No download client is configured.',
    fr: "Aucun client de téléchargement n'est configuré.",
    de: 'Kein Download-Client ist konfiguriert.',
    es: 'No hay ningún cliente de descarga configurado.',
  },
  unknownClient: {
    en: 'This download client is no longer in the configuration.',
    fr: "Ce client de téléchargement n'est plus dans la configuration.",
    de: 'Dieser Download-Client ist nicht mehr in der Konfiguration.',
    es: 'Este cliente de descarga ya no está en la configuración.',
  },
  failed: {
    en: 'No download client accepted the command.',
    fr: "Aucun client de téléchargement n'a accepté la commande.",
    de: 'Kein Download-Client hat den Befehl angenommen.',
    es: 'Ningún cliente de descarga ha aceptado la orden.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A decimal number written the way the language writes it ("2,5" in French). */
export const decimal = (value, language, digits = 1) =>
  value.toLocaleString(language === 'en' ? 'en-US' : language, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
