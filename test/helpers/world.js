// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake SABnzbd and NZBGet on a
// fake network, a temporary /data and a manual clock, with the integration
// wired on top through registerHandlers. No timer runs unless `timers: true`
// (with node:test mock timers): the tests read the clients with
// `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import {
  FakeNzbget,
  FakeSabnzbd,
  NZBGET_PASSWORD,
  NZBGET_USER,
  SAB_KEY,
  createNetwork,
} from './fakeClients.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const SAB_URL = 'http://192.0.2.10:8080';
export const NZBGET_URL = 'http://192.0.2.20:6789';

export const SAB_CONFIG = {
  client_1_software: 'sabnzbd',
  client_1_url: SAB_URL,
  client_1_api_key: SAB_KEY,
  client_1_name: 'SABnzbd',
  language: 'en',
};

export const BOTH_CONFIG = {
  ...SAB_CONFIG,
  client_2_software: 'nzbget',
  client_2_url: NZBGET_URL,
  client_2_username: NZBGET_USER,
  client_2_password: NZBGET_PASSWORD,
  client_2_name: 'NZBGet',
};

/** A manual clock, shared by the hub and the fake clients. */
export function createClock(start = Date.UTC(2026, 9, 14, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {Record<string, object>} [options.clients] fake clients by origin
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  clock = createClock(),
  clients,
  config = SAB_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-usenet-')),
  timings = {},
  timers = false,
} = {}) {
  const network = createNetwork(
    clients ?? {
      [SAB_URL]: new FakeSabnzbd({ now: clock.now }),
      [NZBGET_URL]: new FakeNzbget({ now: clock.now }),
    },
  );
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return {
    gladys,
    fake: gladys.fake,
    network,
    sab: network.clients.get(SAB_URL),
    nzbget: network.clients.get(NZBGET_URL),
    app,
    hub: app.hub,
    clock,
    dataDir,
  };
}

/** External id of the device of a configuration slot. */
export const deviceId = (gladys, slot = 1) => gladys.externalIds('client', String(slot)).device;
export const featureId = (gladys, key, slot = 1) =>
  gladys.externalIds('client', String(slot)).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { FakeNzbget, FakeSabnzbd };
