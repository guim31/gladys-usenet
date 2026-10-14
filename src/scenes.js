// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// The "paused" switch and the "speed limit" slider of a device are already
// Gladys scene actions ("control a device"), but they cannot say for how long,
// nor reach every client at once. These can: pause one client or all of them
// for a number of minutes (0: until resumed), resume, limit the speed.
// Gladys applies the field defaults to scene actions.
// -----------------------------------------------------------------------------

import { parseMinutes, parsePercent } from './hub.js';

export const SCENE_ACTIONS = {
  async pause_downloads(hub, { fields = {} }) {
    const minutes = parseMinutes(fields.minutes);
    const clients = await hub.pause(fields.device || null, minutes);
    return { clients, minutes };
  },

  async resume_downloads(hub, { fields = {} }) {
    const clients = await hub.resume(fields.device || null);
    return { clients };
  },

  async set_speed_limit(hub, { fields = {} }) {
    const percent = parsePercent(fields.percent);
    const clients = await hub.setSpeedLimit(fields.device || null, percent);
    return { clients, percent };
  },
};
