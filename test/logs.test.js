// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never an API key or a password.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOTH_CONFIG, SAB_CONFIG, createAll, createWorld } from './helpers/world.js';
import { NZBGET_PASSWORD, SAB_KEY } from './helpers/fakeClients.js';

/** Capture the lines of the SDK logger at LOG_LEVEL=info. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const w = await createWorld({ config: BOTH_CONFIG, ...options });
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('connected (version 5.1.3)')),
    'the start is logged',
  );
  await createAll(w);
  logs.clear();
  for (let i = 0; i < 5; i += 1) {
    w.sab.download({ kbpersec: 1000 + i * 100 });
    w.nzbget.download({ rate: 2_000_000 + i * 1000 });
    w.sab.finish(`Job.${i}`);
    w.nzbget.finish(`Other.${i}`);
    w.clock.advance(30_000);
    await w.hub.pollAll();
  }
  assert.deepEqual(logs.texts(), []);
  assert.equal(w.fake.sceneEvents.length, 10, 'the events still fire');
});

test('a client that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.sab.online = false;
  for (let i = 0; i < 6; i += 1) {
    await w.hub.pollAll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  logs.clear();
  w.sab.online = true;
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /answers again/);
});

test('a refused key is logged once, never the key itself', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, {
    config: {
      ...BOTH_CONFIG,
      client_1_api_key: 'wrong-key-1234567890',
      client_2_password: 'wrong-pass',
    },
  });
  for (let i = 0; i < 4; i += 1) {
    await w.hub.pollAll();
    await w.fake.action('test_connection', {});
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 2, logs.texts().join('\n'));
  const text = logs.texts().join('\n');
  assert.ok(!text.includes('wrong-key-1234567890'));
  assert.ok(!text.includes('wrong-pass'));
});

test('one line per user command', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: SAB_CONFIG });
  logs.clear();
  await w.fake.sceneAction('pause_downloads', { minutes: 30 });
  await w.fake.sceneAction('resume_downloads', {});
  assert.deepEqual(
    logs.texts().map((text) => text.replace(/^.*\] /, '')),
    ['SABnzbd 1 (SABnzbd): downloads paused for 30 min', 'SABnzbd 1 (SABnzbd): downloads resumed'],
  );
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: SAB_CONFIG });
  await createAll(w);
  logs.clear();
  t.mock.method(w.gladys, 'publishStates', async () => {
    throw new Error('HTTP 500');
  });
  for (let i = 0; i < 4; i += 1) {
    w.sab.download({ kbpersec: 1000 + i });
    await w.hub.pollAll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /States of .* refused/);
});

test('LOG_LEVEL=debug shows each reading problem; never a secret of the configuration', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  w.sab.online = false;
  w.nzbget.online = false;
  await w.hub.pollAll();
  await w.hub.pollAll();
  await w.fake.action('test_connection', {});
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*again/);
  for (const secret of [
    SAB_KEY,
    NZBGET_PASSWORD,
    Buffer.from(`nzbget:${NZBGET_PASSWORD}`).toString('base64'),
  ]) {
    assert.ok(!text.includes(secret), 'no secret in the logs');
  }
});
