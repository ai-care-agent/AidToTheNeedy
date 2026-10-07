import { startMorningCheckin } from './ai/briefing';
import { daytimeHoursBetween, type Care } from './care';
import { config } from './env';
import { addMinutes, withTime } from './time';

/** One pass of the time-driven rules. Exported separately so tests can drive the clock. */
export function tick(care: Care, now = new Date()): void {
  for (const r of care.remindersToFire(now)) care.fireReminder(r.id, now);

  // Escalate before expiring, so even a card left unanswered through a server restart alerts the family.
  for (const r of care.remindersToEscalate(now, config.escalateAfterMin)) care.escalateReminder(r.id, now);
  care.expireStaleDue(now);
  care.expireStaleOrders(now);

  // A long daytime silence gets a gentle "Czy wszystko w porządku?" before anyone worries.
  const last = care.lastActivity();
  const hour = now.getHours();
  if (
    last &&
    hour >= 8 &&
    hour < 20 &&
    daytimeHoursBetween(new Date(last), now) >= config.safetyCheckHours &&
    !care.openSafetyCheck(now) &&
    !care.safetyCheckAskedSince(addMinutes(now, -config.safetyCheckHours * 60))
  ) {
    care.createSafetyCheck('inactivity', now);
  }
  for (const c of care.safetyChecksToEscalate(now, config.safetyEscalateMin)) care.escalateSafetyCheck(c.id, now);

  care.health.tick(now);

  const checkinAt = withTime(now, config.checkinTime);
  if (checkinAt && now >= checkinAt && !care.checkinAskedOn(now)) {
    startMorningCheckin(care, now).catch((err) => console.error('[briefing]', err));
  }
}

export function startScheduler(care: Care, intervalMs = 5_000): NodeJS.Timeout {
  const run = () => {
    try {
      tick(care);
    } catch (err) {
      console.error('[scheduler]', err);
    }
  };
  run();
  return setInterval(run, intervalMs);
}
