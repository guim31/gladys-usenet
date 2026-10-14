// -----------------------------------------------------------------------------
// The snapshot both clients produce, so the rest of the integration never
// knows which software it reads:
//
//   version         software version, e.g. "4.5.1" or "24.8"
//   status          'downloading' | 'paused' | 'post_processing' | 'queued' | 'idle'
//   paused          downloads paused
//   pauseEndsAt     ms epoch when a timed pause ends, null otherwise
//   speedBps        download speed, bytes per second
//   queueCount      jobs waiting or downloading (post-processing excluded)
//   remainingBytes  left to download
//   timeLeftSec     time left at the current speed, 0 when nothing downloads
//   freeBytes       free space of the download folders (the smaller), null if unknown
//   limitBps        speed limit, bytes per second, 0 without limit
//   maxBps          maximum line speed known by the software (SABnzbd), 0 otherwise
//   current         name of the job downloading, null otherwise
//   jobs            finished jobs, newest first: { id, name, category, outcome, at, bytes, reason }
//   problems        errors and warnings the software reported: { at, level, text }
//
// Sizes are binary (1 MB = 1024 × 1024 bytes), like both clients show them.
// -----------------------------------------------------------------------------

export const KB = 1024;
export const MB = 1024 * 1024;
export const GB = 1024 * 1024 * 1024;

export const STATUSES = Object.freeze({
  DOWNLOADING: 'downloading',
  PAUSED: 'paused',
  POST_PROCESSING: 'post_processing',
  QUEUED: 'queued',
  IDLE: 'idle',
});

export const OUTCOMES = Object.freeze({ COMPLETED: 'completed', FAILED: 'failed' });

/** A number from a JSON field that may be a string ("12.50"); null when not one. */
export function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value.trim());
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

/** "1:02:03" or "2:01:02:03" (days first) -> seconds; null when not understood. */
export function parseClock(text) {
  if (typeof text !== 'string' || !/^\d+(:\d+){1,3}$/.test(text.trim())) {
    return null;
  }
  const parts = text.trim().split(':').map(Number);
  const factors = [86_400, 3600, 60, 1].slice(-parts.length);
  return parts.reduce((total, part, index) => total + part * factors[index], 0);
}

/**
 * A SABnzbd size with an optional unit ("8M", "500K", "1.5G", "1048576"),
 * powers of 1024 like SABnzbd itself; 0 when empty or not understood.
 */
export function fromUnits(text) {
  const match = String(text ?? '')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*([KMGT]?)B?$/i);
  if (!match) {
    return 0;
  }
  const power = ['', 'K', 'M', 'G', 'T'].indexOf(match[2].toUpperCase());
  return Math.round(Number(match[1]) * KB ** power);
}

/** A 64-bit value NZBGet sends as two 32-bit halves. */
export const join64 = (lo, hi) => (toNumber(hi) ?? 0) * 2 ** 32 + (toNumber(lo) ?? 0);

/**
 * The speed limit as a percentage of the line: 100 without limit, null when no
 * maximum speed is known (neither the software's nor the configured one).
 */
export function limitPercent(snapshot, lineBps = 0) {
  if (!snapshot.limitBps) {
    return 100;
  }
  const max = snapshot.maxBps || lineBps;
  if (!max) {
    return null;
  }
  return Math.min(100, Math.max(1, Math.round((100 * snapshot.limitBps) / max)));
}

/** The errors and warnings reported within the last `windowMs`. */
export const recentProblems = (snapshot, now, windowMs) =>
  snapshot.problems.filter((problem) => problem.at >= now - windowMs);
