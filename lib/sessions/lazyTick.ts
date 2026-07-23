import { processDueAiClaims, sweepStaleSessions } from "@/lib/sessions/state";

/**
 * Module-level debounce for the lazy "tick" sweeps that customer/dashboard
 * routes used to run on every request. The widget polls some of these routes
 * every few seconds per open session, so without a debounce N concurrent
 * customers fire N x many redundant global sweeps per minute against the database.
 *
 * `/api/cron/tick` runs the same sweeps every minute as the guaranteed
 * backstop, so it is safe to skip the in-request sweep when one ran recently.
 * Module-level state is per-lambda-instance, which is acceptable given the
 * cron backstop.
 */
const SWEEP_INTERVAL_MS = 30_000;
let lastSweepAt = 0;

/**
 * Runs the stale-session sweep and AI-claim processing at most once per
 * SWEEP_INTERVAL_MS per instance. `lastSweepAt` is updated before awaiting so
 * concurrent requests within the window do not all trigger a sweep.
 */
export async function maybeLazyTick(): Promise<void> {
  const now = Date.now();
  if (now - lastSweepAt <= SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  await Promise.allSettled([sweepStaleSessions(), processDueAiClaims()]);
}
