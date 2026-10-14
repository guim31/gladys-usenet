// -----------------------------------------------------------------------------
// The `usenet` dashboard widget: content within the core budget (checked with
// the SDK's validator), every client or one, the buttons and their actions.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { ACTIONS, formatDuration } from '../src/widgets.js';
import { BOTH_CONFIG, SAB_CONFIG, createWorld, deviceId } from './helpers/world.js';

async function world(t, config = SAB_CONFIG) {
  const w = await createWorld({ config });
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  const { content: tree } = ack.data;
  assert.deepEqual(validateWidgetContent(tree), [], 'within the core vocabulary and budget');
  return tree;
}

const ofType = (tree, type) => tree.components.filter((component) => component.type === type);

test('one client downloading: speed, queue, time left, rows, three buttons', async (t) => {
  const w = await world(t);
  w.sab.download();
  await w.hub.pollAll();
  const tree = await content(w);
  assert.ok(tree.components.length <= 8);
  assert.deepEqual(
    ofType(tree, 'value').map(({ label, value, unit }) => [label, value, unit]),
    [
      ['Speed', 2.7, 'MB/s'],
      ['Queue', 3, undefined],
      ['Time left', '1 min', undefined],
    ],
  );
  assert.deepEqual(
    ofType(tree, 'status')[0].items.map(({ label, value }) => [label, value]),
    [
      ['SABnzbd', 'Downloading'],
      ['Free space', '29.4 GB'],
      ['Last download', 'Small.Software.Update.5iet'],
    ],
  );
  const buttons = ofType(tree, 'button');
  assert.deepEqual(
    buttons.map((button) => [button.label, button.action.key, button.icon]),
    [
      ['Pause', ACTIONS.PAUSE, 'pause'],
      ['Pause 30 min', ACTIONS.PAUSE_30, 'clock'],
      ['Resume', ACTIONS.RESUME, 'check-circle'],
    ],
  );
  assert.ok(
    buttons.every((button) => button.style !== 'primary'),
    'primary is invisible in dark',
  );
  assert.equal(tree.ttl_seconds, 15, 'a download moves: sooner');
});

test('the buttons pause, pause 30 min and resume, with a toast', async (t) => {
  const w = await world(t, BOTH_CONFIG);
  const pause = await w.fake.widgetAction(WIDGET_KEY, ACTIONS.PAUSE, {}, { settings: {} });
  assert.equal(pause.data.message.fr, 'Téléchargements en pause sur 2 client(s).');
  assert.equal(w.sab.paused, true);
  assert.equal(w.nzbget.paused, true);
  let tree = await content(w, {}, 'de');
  assert.equal(ofType(tree, 'button')[0].icon, 'check-circle', 'paused everywhere');
  assert.equal(ofType(tree, 'status')[0].items[0].value, 'Pausiert');

  const short = await w.fake.widgetAction(
    WIDGET_KEY,
    ACTIONS.PAUSE_30,
    { minutes: 30 },
    {
      settings: { device: deviceId(w.gladys, 1) },
    },
  );
  assert.equal(short.data.message.en, 'Downloads paused for 30 min on 1 client(s).');
  tree = await content(w, { device: deviceId(w.gladys, 1) }, 'fr');
  // 10:00 UTC + 30 min, in the time zone of the test run.
  assert.match(ofType(tree, 'status')[0].items[0].value, /^En pause · jusqu'à \d\d:\d\d$/);

  const resume = await w.fake.widgetAction(WIDGET_KEY, ACTIONS.RESUME, {}, { settings: {} });
  assert.equal(resume.data.message.es, 'Descargas reanudadas en 2 cliente(s).');
  assert.equal(w.sab.paused, false);
});

test('two clients: summed tiles, rows named by client, a limit and errors shown', async (t) => {
  const w = await world(t, BOTH_CONFIG);
  w.sab.download({ kbpersec: 1024 });
  w.nzbget.download({ rate: 1048576 });
  w.nzbget.limit = 1048576;
  w.sab.warn('Disk full', 'ERROR');
  await w.hub.pollAll();
  const tree = await content(w);
  assert.equal(ofType(tree, 'value')[0].value, 2);
  const labels = ofType(tree, 'status')[0].items.map((item) => item.label);
  assert.ok(labels.includes('Speed limit · NZBGet'));
  assert.ok(labels.includes('Errors (24 h) · SABnzbd'));
  assert.ok(labels.length <= 10);
});

test('nothing configured, an unknown client, nobody answering', async (t) => {
  const empty = await world(t, { language: 'en' });
  assert.match((await content(empty)).components[0].text, /Enter the address/);

  const w = await world(t);
  assert.match(
    (await content(w, { device: 'ext:other:client:9' })).components[0].text,
    /no longer/,
  );
  w.sab.online = false;
  await w.hub.pollAll();
  const tree = await content(w);
  assert.match(tree.components[0].text, /No download client answers/);
  assert.equal(ofType(tree, 'status')[0].items[0].value, 'Unreachable');
});

test('durations fit a tile', () => {
  assert.equal(formatDuration(18, 'en'), '1 min');
  assert.equal(formatDuration(3_900, 'fr'), '1 h 05');
  assert.equal(formatDuration(200_000, 'fr'), '2 j 7 h');
  assert.equal(formatDuration(200_000, 'de'), '2 T 7 h');
  assert.ok(formatDuration(99_999_999, 'en').length <= 12);
});
