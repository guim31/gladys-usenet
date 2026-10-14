import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hostOf, normalizeConfig, parseClientUrl } from '../src/config.js';

test('client addresses: bare host gets the default port, URL copied from the browser', () => {
  assert.equal(parseClientUrl('192.0.2.10'), 'http://192.0.2.10:8080');
  assert.equal(parseClientUrl('192.0.2.10', 'nzbget'), 'http://192.0.2.10:6789');
  assert.equal(parseClientUrl('nas.local:9090'), 'http://nas.local:9090');
  assert.equal(
    parseClientUrl(' http://192.0.2.10:8080/sabnzbd/ '),
    'http://192.0.2.10:8080/sabnzbd',
  );
  assert.equal(parseClientUrl('http://192.0.2.10:8080/api'), 'http://192.0.2.10:8080');
  assert.equal(
    parseClientUrl('http://192.0.2.20:6789/jsonrpc', 'nzbget'),
    'http://192.0.2.20:6789',
  );
  // An explicit scheme keeps the standard port (a reverse proxy).
  assert.equal(parseClientUrl('https://sab.example.org'), 'https://sab.example.org');
  assert.equal(parseClientUrl('HTTPS://198.51.100.20:9090'), 'https://198.51.100.20:9090');
  assert.equal(parseClientUrl('[2001:db8::1]'), 'http://[2001:db8::1]:8080');
  assert.equal(hostOf('https://nas.local:9090'), 'nas.local:9090');
});

test('unusable addresses are refused, credentials in the address too', () => {
  for (const raw of ['', '   ', 'ftp://192.0.2.10', 'http://', 'http://user:pass@192.0.2.10', 42]) {
    assert.equal(parseClientUrl(raw), null, String(raw));
  }
});

test('defaults: no client, 30 seconds, French', () => {
  assert.deepEqual(normalizeConfig(), {
    clients: [],
    invalidSlots: [],
    allowSelfSigned: false,
    pollIntervalMs: 30_000,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), normalizeConfig());
  assert.deepEqual(normalizeConfig(null), normalizeConfig());
});

test('clients by slot, secrets kept as typed, line speed in bytes per second', () => {
  const config = normalizeConfig({
    client_1_software: 'sabnzbd',
    client_1_url: '192.0.2.10',
    client_1_api_key: ' 0123456789abcdef0123456789abcdef ',
    client_1_name: '  NAS  ',
    client_1_line_speed: 1000,
    client_2_software: 'nzbget',
    client_2_url: 'not a url at all',
    allow_self_signed: true,
    poll_interval: '300',
    language: 'de',
  });
  assert.deepEqual(config.clients, [
    {
      slot: 1,
      software: 'sabnzbd',
      url: 'http://192.0.2.10:8080',
      apiKey: '0123456789abcdef0123456789abcdef',
      username: '',
      password: '',
      name: 'NAS',
      lineBps: 125_000_000,
    },
  ]);
  assert.deepEqual(config.invalidSlots, [2]);
  assert.equal(config.allowSelfSigned, true);
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.language, 'de');
});

test('NZBGet credentials, and values outside the lists fall back to the defaults', () => {
  const config = normalizeConfig({
    client_2_software: 'nzbget',
    client_2_url: '192.0.2.20',
    client_2_username: ' nzbget ',
    client_2_password: ' pass word ',
    client_2_line_speed: 'fast',
    poll_interval: '7',
    language: 'it',
  });
  assert.deepEqual(config.clients[0], {
    slot: 2,
    software: 'nzbget',
    url: 'http://192.0.2.20:6789',
    apiKey: '',
    username: 'nzbget',
    password: ' pass word ',
    name: null,
    lineBps: 0,
  });
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.language, 'fr');
  assert.equal(
    normalizeConfig({ client_1_url: '192.0.2.10', client_1_software: 'x' }).clients[0].software,
    'sabnzbd',
  );
});
