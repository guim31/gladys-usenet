// -----------------------------------------------------------------------------
// The two clients against the real answers recorded from SABnzbd 4.2.2 and
// 5.1.3, NZBGet 21.0 and 26.3 (test/fixtures, see their README): the snapshot
// they build, the errors, the requests their commands send.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS } from '../src/clients/errors.js';
import { GB, MB, fromUnits, limitPercent, parseClock } from '../src/clients/model.js';
import { NzbgetClient } from '../src/clients/nzbget.js';
import { SabnzbdClient } from '../src/clients/sabnzbd.js';
import { fixture } from './helpers/fakeClients.js';

const NOW = 1792006200_000;
const now = () => NOW;
const ok = (body) => ({ status: 200, headers: {}, body });

/** A SABnzbd answering from the fixtures of one version; `queue` picks the queue file. */
function sabnzbd(version, { queue = 'queue-downloading', bandwidth = 'empty', calls = [] } = {}) {
  const request = async (url) => {
    const { pathname, searchParams } = new URL(url);
    const mode = searchParams.get('mode');
    calls.push({ path: pathname, ...Object.fromEntries(searchParams) });
    if (searchParams.get('apikey') !== 'key') {
      const [status, ...body] = fixture(`sabnzbd/${version}/error-wrong-api-key.txt`).split('\n');
      return { status: Number(status.slice(5)), headers: {}, body: body.join('\n') };
    }
    if (pathname !== '/api') {
      const [status, ...body] = fixture(`sabnzbd/${version}/sabnzbd-path.txt`).split('\n');
      return { status: Number(status.slice(5)), headers: {}, body: body.join('\n') };
    }
    const files = {
      queue: `${queue}.json`,
      history: searchParams.has('last_history_update') ? 'history-unchanged.json' : 'history.json',
      warnings: 'warnings-after-wrong-key.json',
      get_config: `config-bandwidth-max-${bandwidth}.json`,
    };
    if (files[mode]) {
      return ok(fixture(`sabnzbd/${version}/${files[mode]}`));
    }
    return ok('{"status":true}');
  };
  return new SabnzbdClient({ url: 'http://192.0.2.10:8080', apiKey: 'key', request, now });
}

/** An NZBGet answering from the fixtures of one version. */
function nzbget(
  version,
  { status = 'status-downloading', groups = 'listgroups-downloading', calls = [] } = {},
) {
  const request = async (url, { method, json, headers }) => {
    calls.push({ method, rpc: json.method, params: json.params });
    if (headers.authorization !== `Basic ${Buffer.from('nzbget:secret').toString('base64')}`) {
      return { status: 401, headers: {}, body: '' };
    }
    const files = {
      status: `${status}.json`,
      listgroups: `${groups}.json`,
      history: 'history.json',
      log: version === '26.3' ? 'log-from-140.json' : 'log-last-20.json',
      version: 'version.json',
    };
    if (files[json.method]) {
      return ok(fixture(`nzbget/${version}/${files[json.method]}`));
    }
    return ok('{"version":"1.1","id":1,"result":true}');
  };
  return new NzbgetClient({
    url: 'http://192.0.2.20:6789',
    username: 'nzbget',
    password: 'secret',
    request,
    now,
  });
}

test('helpers: clock, units, limit in percent', () => {
  assert.equal(parseClock('0:00:18'), 18);
  assert.equal(parseClock('29:59'), 1799);
  assert.equal(parseClock('1:02:03:04'), 93_784);
  assert.equal(parseClock('0'), null);
  assert.equal(fromUnits('8M'), 8 * MB);
  assert.equal(fromUnits('500K'), 512_000);
  assert.equal(fromUnits(''), 0);
  assert.equal(limitPercent({ limitBps: 0, maxBps: 0 }), 100);
  assert.equal(limitPercent({ limitBps: 2 * MB, maxBps: 8 * MB }), 25);
  assert.equal(limitPercent({ limitBps: MB, maxBps: 0 }), null);
  assert.equal(limitPercent({ limitBps: 1_250_000, maxBps: 0 }, 12_500_000), 10);
});

for (const version of ['5.1.3', '4.2.2']) {
  test(`SABnzbd ${version}: a download in progress`, async () => {
    const snapshot = await sabnzbd(version).read();
    assert.equal(snapshot.version, version);
    assert.equal(snapshot.status, 'downloading');
    assert.equal(snapshot.paused, false);
    assert.equal(snapshot.queueCount, 3);
    assert.ok(snapshot.speedBps > 2.7 * MB && snapshot.speedBps < 2.8 * MB);
    assert.ok(Math.abs(snapshot.remainingBytes - 49.78 * MB) < 1);
    assert.ok(snapshot.timeLeftSec >= 17 && snapshot.timeLeftSec <= 18);
    assert.equal(snapshot.freeBytes, 29.4 * GB);
    assert.equal(snapshot.limitBps, 0);
    assert.match(snapshot.current, /^Big\.Linux\.Distribution/);
    // The history: completed and failed jobs, newest first.
    assert.ok(snapshot.jobs.some((job) => job.outcome === 'completed' && job.bytes > 0));
    const failed = snapshot.jobs.find((job) => job.outcome === 'failed');
    assert.equal(failed.category, 'tv');
    assert.match(failed.reason, /Not on your server/);
    assert.ok(
      snapshot.jobs.every((job) => job.category !== '*'),
      'the default category is empty',
    );
    // The warnings left by wrong keys.
    assert.ok(snapshot.problems.length >= 3);
    assert.ok(snapshot.problems.every((problem) => problem.level === 'warning' && problem.at > 0));
    assert.ok(snapshot.problems.every((problem) => !problem.text.includes('\n')));
  });

  test(`SABnzbd ${version}: paused, timed pause, limits`, async () => {
    const paused = await sabnzbd(version, { queue: 'queue-paused' }).read();
    assert.equal(paused.status, 'paused');
    assert.equal(paused.pauseEndsAt, null);
    assert.equal(paused.speedBps, 0);
    assert.equal(paused.timeLeftSec, 0);

    const timed = await sabnzbd(version, { queue: 'queue-paused-30-min' }).read();
    assert.equal(timed.pauseEndsAt, NOW + 1799_000);

    const absolute = await sabnzbd(version, { queue: 'queue-limit-absolute' }).read();
    assert.equal(absolute.limitBps, MB);
    assert.equal(absolute.maxBps, 0);
    assert.equal(limitPercent(absolute), null, 'no maximum known');

    const percent = await sabnzbd(version, {
      queue: 'queue-limit-25-percent',
      bandwidth: '8m',
    }).read();
    assert.equal(percent.maxBps, 8 * MB);
    assert.equal(limitPercent(percent), 25);

    const idle = await sabnzbd(version, { queue: 'queue-after-downloads' }).read();
    assert.equal(idle.status, 'idle');
    assert.equal(idle.current, null);
  });
}

test('SABnzbd: the history is not sent again while unchanged', async () => {
  const calls = [];
  const client = sabnzbd('5.1.3', { calls });
  const first = await client.read();
  const second = await client.read();
  assert.deepEqual(second.jobs, first.jobs);
  const histories = calls.filter((call) => call.mode === 'history');
  assert.equal(histories[0].last_history_update, undefined);
  assert.equal(histories[1].last_history_update, '31');
  // Warnings unchanged (same count): not read again. Line speed: once an hour.
  assert.equal(calls.filter((call) => call.mode === 'warnings').length, 1);
  assert.equal(calls.filter((call) => call.mode === 'get_config').length, 1);
});

test('SABnzbd: a wrong API key, a missing one, the /sabnzbd path of SABnzbd 5', async () => {
  const request = async (url) => {
    const params = new URL(url).searchParams;
    return params.get('apikey')
      ? { status: 403, headers: {}, body: 'API Key Incorrect' }
      : { status: 403, headers: {}, body: 'API Key Required' };
  };
  const wrong = new SabnzbdClient({ url: 'http://192.0.2.10:8080', apiKey: 'bad', request });
  await assert.rejects(wrong.read(), { kind: ERROR_KINDS.AUTH, message: 'API key refused' });
  const none = new SabnzbdClient({ url: 'http://192.0.2.10:8080', apiKey: '', request });
  await assert.rejects(none.read(), { kind: ERROR_KINDS.AUTH, message: 'API key missing' });

  const calls = [];
  const client = sabnzbd('5.1.3', { calls });
  client.base = 'http://192.0.2.10:8080/sabnzbd';
  const snapshot = await client.read();
  assert.equal(snapshot.status, 'downloading');
  assert.equal(client.base, 'http://192.0.2.10:8080', 'the root is kept');
  assert.equal(calls[0].path, '/sabnzbd/api');
  assert.ok(calls.slice(2).every((call) => call.path === '/api'));
});

test('SABnzbd: no API at the address, a network failure, a certificate', async () => {
  const html = async () => ({ status: 200, headers: {}, body: '<html>router</html>' });
  await assert.rejects(
    new SabnzbdClient({ url: 'http://192.0.2.1', apiKey: 'k', request: html }).read(),
    { kind: ERROR_KINDS.NOT_CLIENT },
  );
  const refuse = (code) => async () => {
    throw Object.assign(new Error(code), { code });
  };
  await assert.rejects(
    new SabnzbdClient({
      url: 'http://192.0.2.1',
      apiKey: 'k',
      request: refuse('ECONNREFUSED'),
    }).read(),
    { kind: ERROR_KINDS.UNREACHABLE },
  );
  await assert.rejects(
    new SabnzbdClient({
      url: 'https://192.0.2.1:9090',
      apiKey: 'k',
      request: refuse('DEPTH_ZERO_SELF_SIGNED_CERT'),
    }).read(),
    { kind: ERROR_KINDS.TLS },
  );
});

test('SABnzbd commands: pause, timed pause, resume, speed limits', async () => {
  const calls = [];
  const client = sabnzbd('5.1.3', { calls });
  await client.pause();
  await client.pause(30);
  await client.resume();
  await assert.rejects(client.setSpeedLimit(50), { kind: ERROR_KINDS.LINE_SPEED });
  await client.setSpeedLimit(50, 12_500_000); // 100 Mbit/s
  await client.setSpeedLimit(100);
  const sent = calls
    .filter((call) => call.mode !== 'get_config')
    .map(({ mode, name, value }) => [mode, name, value]);
  assert.deepEqual(sent, [
    ['pause', undefined, undefined],
    ['config', 'set_pause', '30'],
    ['resume', undefined, undefined],
    ['config', 'speedlimit', '6104K'],
    ['config', 'speedlimit', ''],
  ]);

  const withMax = [];
  const max = sabnzbd('5.1.3', { calls: withMax, bandwidth: '8m' });
  await max.setSpeedLimit(25);
  await max.setSpeedLimit(100);
  assert.deepEqual(
    withMax.filter((call) => call.mode === 'config').map((call) => call.value),
    ['25', '100'],
  );
});

for (const version of ['26.3', '21.0']) {
  test(`NZBGet ${version}: a download in progress`, async () => {
    const snapshot = await nzbget(version).read();
    assert.equal(snapshot.version, version);
    assert.equal(snapshot.status, 'downloading');
    assert.equal(snapshot.queueCount, 3);
    assert.equal(snapshot.speedBps, version === '26.3' ? 2489637 : 2489650);
    assert.ok(snapshot.remainingBytes > 51_000_000);
    assert.equal(snapshot.timeLeftSec, Math.round(snapshot.remainingBytes / snapshot.speedBps));
    assert.match(snapshot.current, /^Big\.Linux\.Distribution/);
    if (version === '26.3') {
      assert.ok(snapshot.freeBytes > 29 * GB);
    } else {
      // NZBGet 21.0 could not read the disk in the sandbox: 0xFFFFFFFF twice.
      assert.equal(snapshot.freeBytes, null);
    }
    const failed = snapshot.jobs.find((job) => job.outcome === 'failed');
    assert.equal(failed.reason, 'FAILURE/HEALTH');
    assert.equal(failed.category, 'Series');
    assert.ok(snapshot.jobs[0].at >= snapshot.jobs.at(-1).at, 'newest first');
  });

  test(`NZBGet ${version}: paused, timed pause, limit, idle`, async () => {
    const paused = await nzbget(version, { status: 'status-paused' }).read();
    assert.equal(paused.status, 'paused');
    assert.equal(paused.pauseEndsAt, null);
    const timed = await nzbget(version, { status: 'status-paused-30-min' }).read();
    assert.ok(Math.abs(timed.pauseEndsAt - (NOW + 1800_000)) <= 1000);
    const limited = await nzbget(version, { status: 'status-limit-1mb' }).read();
    assert.equal(limited.limitBps, MB);
    assert.equal(limitPercent(limited, 4 * MB), 25);
    const idle = await nzbget(version, {
      status: 'status-after-downloads',
      groups: 'listgroups-empty',
    }).read();
    assert.equal(idle.status, 'idle');
    assert.equal(idle.queueCount, 0);
    assert.equal(idle.timeLeftSec, 0);
  });
}

test('NZBGet: the log is read from the last line, the history only when something moved', async () => {
  const calls = [];
  const client = nzbget('26.3', { calls });
  const first = await client.read();
  assert.deepEqual(
    first.problems.map((problem) => problem.level),
    ['warning'],
    'one health warning in the recorded log',
  );
  await client.read();
  const logs = calls.filter((call) => call.rpc === 'log').map((call) => call.params);
  assert.deepEqual(logs, [
    [0, 100],
    [176, 0],
  ]);
  assert.equal(calls.filter((call) => call.rpc === 'history').length, 1);
  assert.ok(
    calls.every((call) => call.method === 'POST'),
    'NZBGet refuses commands sent as GET',
  );
});

test('NZBGet: wrong password, and the commands sent', async () => {
  const wrong = new NzbgetClient({
    url: 'http://192.0.2.20:6789',
    username: 'nzbget',
    password: 'bad',
    request: async () => ({ status: 401, headers: {}, body: '' }),
  });
  await assert.rejects(wrong.read(), { kind: ERROR_KINDS.AUTH });

  const calls = [];
  const client = nzbget('26.3', { calls });
  await client.pause();
  await client.pause(30);
  await client.resume();
  await assert.rejects(client.setSpeedLimit(50), { kind: ERROR_KINDS.LINE_SPEED });
  await client.setSpeedLimit(50, 12_500_000);
  await client.setSpeedLimit(100);
  assert.deepEqual(
    calls.map(({ rpc, params }) => [rpc, params]),
    [
      ['pausedownload', []],
      ['pausedownload', []],
      ['scheduleresume', [1800]],
      ['resumedownload', []],
      ['rate', [6104]],
      ['rate', [0]],
    ],
  );
});

test('NZBGet: an error of the JSON-RPC API', async () => {
  const client = new NzbgetClient({
    url: 'http://192.0.2.20:6789',
    request: async () => ok(fixture('nzbget/26.3/error-invalid-procedure.json')),
  });
  await assert.rejects(client.read(), { kind: ERROR_KINDS.HTTP, message: /Invalid procedure/ });
});
