// -----------------------------------------------------------------------------
// The integration against a REAL SABnzbd and/or NZBGet (npm run test:real).
// Skipped when the environment does not name one, which is the case in CI.
//
//   USENET_TEST_SABNZBD_URL       e.g. http://127.0.0.1:8080
//   USENET_TEST_SABNZBD_API_KEY   the full API key
//   USENET_TEST_NZBGET_URL        e.g. http://127.0.0.1:6789
//   USENET_TEST_NZBGET_USERNAME   (default nzbget)
//   USENET_TEST_NZBGET_PASSWORD
//   USENET_TEST_NNTP_PORT         port of the test news server (default 11119)
//
// The test starts a small news server (test/real/nntp.js) on 127.0.0.1, so
// the client must run on the same machine. It adds a server entry
// "gladys-test" to SABnzbd; NZBGet needs Server1 pointed at 127.0.0.1 and
// that port by hand (NZBGet has no API to add a server without rewriting its
// configuration). It then queues jobs, pauses, resumes, limits the speed and
// changes `bandwidth_max`: use a THROWAWAY instance, never your real one.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { FEATURE_KEYS } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { NntpServer } from './nntp.js';

process.env.LOG_LEVEL ??= 'warn';

const env = process.env;
const NNTP_PORT = Number(env.USENET_TEST_NNTP_PORT ?? 11119);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tag = Date.now().toString(36);

async function until(check, what, timeoutMs = 120_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) {
      return;
    }
    await sleep(1000);
  }
  assert.fail(`timed out waiting for ${what}`);
}

/** The integration on a fake Gladys, against the real client of slot 1. */
async function integration(t, config) {
  const gladys = createFakeGladys({ config: { language: 'en', poll_interval: '10', ...config } });
  const app = registerHandlers(gladys, {
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-usenet-real-'))),
    timers: false,
  });
  await gladys.connect();
  await app.ready;
  t.after(() => app.stop());
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  const ids = gladys.externalIds('client', '1');
  return {
    gladys,
    hub: app.hub,
    poll: () => app.hub.pollAll({ manual: true }),
    state: (key) => gladys.fake.lastState(ids.feature(key)),
    events: (key) => gladys.fake.sceneEvents.filter((event) => event.key === key),
  };
}

async function scenario(t, world, addJob) {
  await world.poll();
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });

  // A job long enough to be seen downloading, one that completes, one that fails.
  await addJob(`Gladys.Real.Big.${tag}`, 60_000_000, false, '');
  await addJob(`Gladys.Real.Small.${tag}`, 1_000_000, false, '');
  await addJob(`Gladys.Real.Broken.${tag}`, 700_000, true, '');
  await until(async () => {
    await world.poll();
    return world.state(FEATURE_KEYS.STATUS) === 'Downloading';
  }, 'the download');
  assert.ok(world.state(FEATURE_KEYS.QUEUE) >= 1);
  assert.ok(world.state(FEATURE_KEYS.SPEED) > 0);

  const paused = await world.gladys.fake.sceneAction('pause_downloads', { minutes: 30 });
  assert.equal(paused.success, true, paused.error);
  await world.poll();
  assert.equal(world.state(FEATURE_KEYS.PAUSED), 1);
  assert.equal(world.state(FEATURE_KEYS.STATUS), 'Paused');
  const record = [...world.hub.records.values()][0];
  assert.ok(record.snapshot.pauseEndsAt > Date.now() + 28 * 60_000, 'a timed pause');

  const resumed = await world.gladys.fake.sceneAction('resume_downloads', {});
  assert.equal(resumed.success, true, resumed.error);
  await world.poll();
  assert.equal(world.state(FEATURE_KEYS.PAUSED), 0);

  const limited = await world.gladys.fake.sceneAction('set_speed_limit', { percent: 25 });
  assert.equal(limited.success, true, limited.error);
  await world.poll();
  assert.equal(world.state(FEATURE_KEYS.SPEED_LIMIT), 25);
  const free = await world.gladys.fake.sceneAction('set_speed_limit', { percent: 100 });
  assert.equal(free.success, true, free.error);
  await world.poll();
  assert.equal(world.state(FEATURE_KEYS.SPEED_LIMIT), 100);

  await until(async () => {
    await world.poll();
    return (
      world.events('download_completed').length >= 2 && world.events('download_failed').length >= 1
    );
  }, 'the scene events');
  const names = world.events('download_completed').map((event) => event.data.name);
  assert.ok(names.includes(`Gladys.Real.Small.${tag}`));
  assert.equal(world.events('download_failed')[0].data.name, `Gladys.Real.Broken.${tag}`);
  assert.equal(world.state(FEATURE_KEYS.LAST), names.at(-1));

  const report = await world.gladys.fake.action('test_connection', {});
  assert.equal(report.success, true);
  assert.match(report.data.message.en, /OK/);
}

test(
  'a real SABnzbd',
  { skip: !env.USENET_TEST_SABNZBD_URL && 'USENET_TEST_SABNZBD_URL not set' },
  async (t) => {
    const nntp = new NntpServer({ bytesPerSecond: 1_500_000 });
    await nntp.listen(NNTP_PORT);
    t.after(() => nntp.close());
    const base = env.USENET_TEST_SABNZBD_URL.replace(/\/+$/, '');
    const api = async (params) => {
      const query = new URLSearchParams({
        output: 'json',
        apikey: env.USENET_TEST_SABNZBD_API_KEY,
        ...params,
      });
      return (await fetch(`${base}/api?${query}`)).json();
    };
    await api({
      mode: 'set_config',
      section: 'servers',
      keyword: 'gladys-test',
      host: '127.0.0.1',
      port: String(NNTP_PORT),
      connections: '2',
      ssl: '0',
      enable: '1',
    });
    await api({ mode: 'set_config', section: 'misc', keyword: 'bandwidth_max', value: '8M' });
    t.after(() =>
      api({ mode: 'set_config', section: 'misc', keyword: 'bandwidth_max', value: '' }),
    );
    const directory = mkdtempSync(join(tmpdir(), 'gladys-usenet-nzb-'));
    const world = await integration(t, {
      client_1_software: 'sabnzbd',
      client_1_url: base,
      client_1_api_key: env.USENET_TEST_SABNZBD_API_KEY,
    });
    await scenario(t, world, async (name, size, missing) => {
      const file = join(directory, `${name}.nzb`);
      writeFileSync(file, nntp.addJob({ name, size, missing }));
      await api({ mode: 'addlocalfile', name: file });
    });
  },
);

test(
  'a real NZBGet',
  { skip: !env.USENET_TEST_NZBGET_URL && 'USENET_TEST_NZBGET_URL not set' },
  async (t) => {
    const nntp = new NntpServer({ bytesPerSecond: 1_500_000 });
    await nntp.listen(NNTP_PORT);
    t.after(() => nntp.close());
    const base = env.USENET_TEST_NZBGET_URL.replace(/\/+$/, '');
    const username = env.USENET_TEST_NZBGET_USERNAME ?? 'nzbget';
    const password = env.USENET_TEST_NZBGET_PASSWORD ?? '';
    const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    const world = await integration(t, {
      client_1_software: 'nzbget',
      client_1_url: base,
      client_1_username: username,
      client_1_password: password,
      client_1_line_speed: 64, // 8 MB/s
    });
    await scenario(t, world, async (name, size, missing) => {
      const nzb = Buffer.from(nntp.addJob({ name, size, missing })).toString('base64');
      await fetch(`${base}/jsonrpc`, {
        method: 'POST',
        headers: { authorization },
        body: JSON.stringify({
          method: 'append',
          params: [`${name}.nzb`, nzb, '', 0, false, false, '', 0, 'SCORE', []],
          id: 1,
        }),
      });
    });
  },
);
