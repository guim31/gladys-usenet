// -----------------------------------------------------------------------------
// The hub: devices, states of the added devices, scene events once per
// finished job (also after a restart), commands of the devices and of the
// scene actions, a client that stops answering, a refused key.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS } from '../src/devices.js';
import { TRIGGERS } from '../src/hub.js';
import {
  BOTH_CONFIG,
  FakeSabnzbd,
  SAB_CONFIG,
  SAB_URL,
  createAll,
  createClock,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);

test('one device per client, published with should_poll false', async (t) => {
  const w = await world(t, { config: BOTH_CONFIG });
  const devices = w.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => [device.name, device.should_poll, device.params]),
    [
      [
        'SABnzbd',
        false,
        [
          { name: 'URL', value: SAB_URL },
          { name: 'SOFTWARE', value: 'SABnzbd' },
        ],
      ],
      [
        'NZBGet',
        false,
        [
          { name: 'URL', value: 'http://192.0.2.20:6789' },
          { name: 'SOFTWARE', value: 'NZBGet' },
        ],
      ],
    ],
  );
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('states only for the added devices, all of them once added', async (t) => {
  const w = await world(t);
  w.sab.download();
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, 0, 'nothing before the device exists');
  await createAll(w);
  const value = (key) => w.fake.lastState(featureId(w.gladys, key));
  assert.equal(value(FEATURE_KEYS.PAUSED), 0);
  assert.equal(value(FEATURE_KEYS.SPEED_LIMIT), 100);
  assert.equal(value(FEATURE_KEYS.SPEED), 2.74);
  assert.equal(value(FEATURE_KEYS.QUEUE), 3);
  assert.equal(value(FEATURE_KEYS.LEFT), 0.05);
  assert.equal(value(FEATURE_KEYS.TIME_LEFT), 1);
  assert.equal(value(FEATURE_KEYS.FREE), 29.4);
  assert.equal(value(FEATURE_KEYS.STATUS), 'Downloading');
  assert.equal(value(FEATURE_KEYS.LAST), 'Small.Software.Update.5iet');
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.ok(w.fake.widgetRefreshes.length > 0, 'the widget is refreshed');
});

test('only the changes are sent', async (t) => {
  const w = await world(t);
  await createAll(w);
  const before = w.fake.states.length;
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, before, 'nothing changed, nothing sent');
  w.sab.download();
  await w.hub.pollAll();
  const sent = w.fake.states.slice(before).map((state) => state.device_feature_external_id);
  assert.deepEqual(sent.map((id) => id.split(':').at(-1)).sort(), [
    'download_speed',
    'queue_count',
    'queue_left',
    'status',
    'time_left',
  ]);
});

test('a finished job fires its scene event once, with its details', async (t) => {
  const w = await world(t, { config: BOTH_CONFIG });
  assert.equal(w.fake.sceneEvents.length, 0, 'the history read at start is not announced');
  w.sab.finish('My.Show.S01E01', { category: 'tv' });
  w.sab.finish('Broken.Movie', { failed: true, category: 'movies' });
  w.nzbget.finish('Linux.ISO', { category: 'Software' });
  w.nzbget.finish('Damaged.Job', { status: 'WARNING/DAMAGED' });
  w.nzbget.finish('Script.Warning', { status: 'WARNING/SCRIPT' });
  w.nzbget.finish('Deleted.By.Hand', { status: 'DELETED/MANUAL' });
  await w.hub.pollAll();
  await w.hub.pollAll();
  // The two clients are read at the same time: compare client by client.
  const byClient = (list) => [...list].sort((a, b) => a.device.localeCompare(b.device));
  assert.deepEqual(byClient(events(w, TRIGGERS.COMPLETED).map((event) => event.data)), [
    {
      device: deviceId(w.gladys, 1),
      client: 'SABnzbd',
      name: 'My.Show.S01E01',
      category: 'tv',
      size_mb: 700,
    },
    {
      device: deviceId(w.gladys, 2),
      client: 'NZBGet',
      name: 'Linux.ISO',
      category: 'Software',
      size_mb: 1,
    },
    {
      device: deviceId(w.gladys, 2),
      client: 'NZBGet',
      name: 'Script.Warning',
      category: 'Series',
      size_mb: 1,
    },
  ]);
  assert.deepEqual(
    byClient(events(w, TRIGGERS.FAILED).map((event) => event.data)).map((data) => [
      data.name,
      data.category,
      data.reason,
    ]),
    [
      [
        'Broken.Movie',
        'movies',
        'Download failed - Not on your server(s) - https://sabnzbd.org/not-complete',
      ],
      ['Damaged.Job', 'Series', 'WARNING/DAMAGED'],
    ],
  );
});

test('after a restart, the jobs finished meanwhile are announced, not the old ones', async (t) => {
  const clock = createClock();
  const sab = new FakeSabnzbd({ now: clock.now });
  const first = await createWorld({ clock, clients: { [SAB_URL]: sab } });
  await first.app.stop();

  sab.finish('While.Stopped');
  sab.finish('Long.Ago', { at: clock.now() - 3 * 3600_000 });
  clock.advance(5 * 60_000);
  const second = await createWorld({ clock, clients: { [SAB_URL]: sab }, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.deepEqual(
    second.fake.sceneEvents.map((event) => event.data.name),
    ['While.Stopped'],
  );
});

test('a client that stops answering: unreachable after two readings, then back', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.sab.online = false;
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.STATUS)), 'Idle');
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.STATUS)), 'Unreachable');
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(w.fake.connectionStatus.message.en, 'SABnzbd: does not answer');
  w.sab.online = true;
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.STATUS)), 'Idle');
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a refused API key is not retried by the timer (each try is a SABnzbd warning)', async (t) => {
  const w = await world(t, { config: { ...SAB_CONFIG, client_1_api_key: 'wrong' } });
  assert.equal(w.sab.warnings.length, 1);
  assert.match(w.fake.connectionStatus.message.fr, /clé d'API ou mot de passe refusé/);
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(w.sab.warnings.length, 1, 'no new try');
  // "Test the connection" tries again.
  await w.fake.action('test_connection', {});
  assert.equal(w.sab.warnings.length, 2);
  // A corrected key in the configuration: a new connection.
  await w.fake.configUpdated({ ...SAB_CONFIG });
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('the device controls: paused switch and speed limit slider', async (t) => {
  const w = await world(t, { config: { ...SAB_CONFIG, client_1_line_speed: 100 } });
  await createAll(w);
  const [device] = w.fake.discoveredDevices;
  const feature = (key) => device.features.find((f) => f.external_id === featureId(w.gladys, key));

  assert.equal((await w.fake.setValue(device, feature(FEATURE_KEYS.PAUSED), 1)).success, true);
  assert.equal(w.sab.paused, true);
  assert.equal(w.sab.pauseUntil, null, 'until resumed');
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.PAUSED)), 1);
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.STATUS)), 'Paused');
  await w.fake.setValue(device, feature(FEATURE_KEYS.PAUSED), 0);
  assert.equal(w.sab.paused, false);

  await w.fake.setValue(device, feature(FEATURE_KEYS.SPEED_LIMIT), 50);
  // 100 Mbit/s, half of it, in KB/s (SABnzbd has no maximum line speed).
  assert.equal(w.sab.speedlimitAbs, 6104 * 1024);
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.SPEED_LIMIT)), 50);
  await w.fake.setValue(device, feature(FEATURE_KEYS.SPEED_LIMIT), 100);
  assert.equal(w.sab.speedlimitAbs, 0);
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.SPEED_LIMIT)), 100);
});

test('a limit in % without any line speed: a clear error, the client is not marked down', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('set_speed_limit', { percent: 30 });
  assert.equal(ack.success, false);
  assert.match(ack.error, /line speed/);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  // With the maximum line speed set in SABnzbd, the percentage goes through.
  w.sab.bandwidthMax = '8M';
  const done = await w.fake.sceneAction('set_speed_limit', { percent: 30 });
  assert.deepEqual(done.data.outputs, { clients: 1, percent: 30 });
  assert.equal(w.sab.speedlimit, '30');
});

test('scene actions: pause for a while, on every client, then resume', async (t) => {
  const w = await world(t, { config: BOTH_CONFIG });
  const paused = await w.fake.sceneAction('pause_downloads', { minutes: 45 });
  assert.deepEqual(paused.data.outputs, { clients: 2, minutes: 45 });
  assert.equal(w.sab.pauseUntil, w.clock.now() + 45 * 60_000);
  assert.equal(w.nzbget.resumeTime, Math.floor(w.clock.now() / 1000) + 45 * 60);
  const one = await w.fake.sceneAction('resume_downloads', { device: deviceId(w.gladys, 2) });
  assert.deepEqual(one.data.outputs, { clients: 1 });
  assert.equal(w.nzbget.paused, false);
  assert.equal(w.sab.paused, true);
  const forever = await w.fake.sceneAction('pause_downloads', { device: deviceId(w.gladys, 1) });
  assert.deepEqual(forever.data.outputs, { clients: 1, minutes: 0 });
  assert.equal(w.sab.pauseUntil, null);
});

test('a command to a client that does not answer fails with its name', async (t) => {
  const w = await world(t);
  w.sab.online = false;
  const ack = await w.fake.sceneAction('resume_downloads', {});
  assert.equal(ack.success, false);
  assert.equal(ack.error, 'SABnzbd: does not answer');
});

test('no client configured: the connection status says what to do', async (t) => {
  const w = await world(t, { config: { language: 'en' } });
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /Enter the address/);
  const ack = await w.fake.sceneAction('pause_downloads', {});
  assert.equal(ack.error, 'No download client is configured.');
});
