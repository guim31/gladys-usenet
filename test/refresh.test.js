// -----------------------------------------------------------------------------
// The integration refreshes on its own: the devices are published with
// should_poll: false and the hub reads the clients on its own timer, without
// Gladys ever calling onPoll (GladysAssistant/Gladys#3198). An unchanged value
// is still sent again well within the 12 hours after which the dashboard
// would end up showing "no recent value".
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { FEATURE_KEYS } from '../src/devices.js';
import { HUB_TIMINGS } from '../src/hub.js';
import {
  FakeSabnzbd,
  SAB_CONFIG,
  SAB_URL,
  createAll,
  createWorld,
  featureId,
} from './helpers/world.js';

const MINUTE = 60_000;
const START = Date.UTC(2026, 9, 14, 10);

/** Lets the timer's reads (promises on the fake network) settle. */
async function settle() {
  for (let i = 0; i < 20; i += 1) {
    await flush();
  }
}

async function timedWorld(t, config = { ...SAB_CONFIG, poll_interval: '60' }) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START });
  const clock = { now: () => Date.now() };
  const sab = new FakeSabnzbd({ now: clock.now });
  const w = await createWorld({ clock, clients: { [SAB_URL]: sab }, config, timers: true });
  t.after(() => w.app.stop());
  return w;
}

test('the hub reads the clients on its own timer, without onPoll', async (t) => {
  const w = await timedWorld(t);
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createAll(w);
  assert.ok(w.fake.discoveredDevices.every((device) => device.should_poll === false));
  const queues = () => w.sab.requests.filter((r) => r.params.mode === 'queue').length;
  const speed = featureId(w.gladys, FEATURE_KEYS.SPEED);
  for (const kbpersec of [1024, 2048, 3072]) {
    const before = queues();
    w.sab.download({ kbpersec });
    t.mock.timers.tick(MINUTE); // poll_interval: 60 s
    await settle();
    assert.equal(queues() - before, 1, 'one reading per interval');
    assert.equal(w.fake.lastState(speed), kbpersec / 1024);
  }
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('a finished job is announced by the timer alone', async (t) => {
  const w = await timedWorld(t);
  w.sab.finish('Timer.Job');
  t.mock.timers.tick(MINUTE);
  await settle();
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => event.data.name),
    ['Timer.Job'],
  );
});

test('an unchanged value is sent again at least every 12 hours', async (t) => {
  assert.ok(HUB_TIMINGS.heartbeatMs <= 12 * 3600_000);
  const w = await timedWorld(t);
  await createAll(w);
  const queue = featureId(w.gladys, FEATURE_KEYS.QUEUE);
  const sent = () =>
    w.fake.states.filter((state) => state.device_feature_external_id === queue).length;
  const first = sent();
  // Nothing changes in SABnzbd for 12 hours, read every minute.
  for (let minute = 0; minute < 12 * 60; minute += 1) {
    t.mock.timers.tick(MINUTE);
    await settle();
  }
  assert.ok(sent() - first >= 2, `queue sent ${sent() - first} time(s) in 12 h`);
  assert.ok(sent() - first <= 3, 'only the heartbeat, not every read');
});

test('a failed reading is retried sooner, and the timer stops with the integration', async (t) => {
  const w = await timedWorld(t, { ...SAB_CONFIG, poll_interval: '300' });
  const queues = () => w.sab.requests.filter((r) => r.params.mode === 'queue').length;
  w.sab.online = false;
  t.mock.timers.tick(5 * MINUTE);
  await settle();
  w.sab.online = true;
  const before = queues();
  t.mock.timers.tick(HUB_TIMINGS.retryMs);
  await settle();
  assert.equal(queues() - before, 1, 'retried after 15 s, not 5 min');

  await w.app.stop();
  const stopped = w.sab.requests.length;
  t.mock.timers.tick(60 * MINUTE);
  await settle();
  assert.equal(w.sab.requests.length, stopped);
});
