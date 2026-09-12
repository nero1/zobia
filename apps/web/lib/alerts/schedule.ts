/**
 * lib/alerts/schedule.ts
 *
 * Escalation state machine for Level 1/2 alerts (the only levels that repeat
 * until resolved — everything else fires once).
 *
 * Per the spec: an hour-based backoff schedule (default 1h, 2h, 4h, 8h, 16h,
 * 32h) repeats for N cycles, then switches to once-a-day for D days, then
 * once-a-week for W weeks, then stops permanently. The alert itself stays
 * open/unresolved after escalation stops — it just no longer pages anyone
 * new until a human resolves it or the underlying INSERT (a fresh trigger)
 * bumps it back to stage 0 in a new backoff cycle via dedupe-and-reopen.
 */

export type EscalationPhase = "backoff" | "daily" | "weekly" | "stopped";

export interface EscalationPolicy {
  hoursSchedule: number[];
  cycles: number;
  dailyPhaseDays: number;
  weeklyPhaseWeeks: number;
}

export interface EscalationState {
  stage: number;
  cycle: number;
  phase: EscalationPhase;
}

export interface ScheduleResult {
  /** Next time to re-notify, or null if escalation is complete (stop paging). */
  nextAt: Date | null;
  state: EscalationState;
}

/** Initial schedule for a freshly-raised escalating alert (stage 0, cycle 0, backoff phase). */
export function computeInitialSchedule(policy: EscalationPolicy, from: Date = new Date()): ScheduleResult {
  if (policy.hoursSchedule.length === 0) {
    return { nextAt: null, state: { stage: 0, cycle: 0, phase: "stopped" } };
  }
  const nextAt = new Date(from.getTime() + policy.hoursSchedule[0] * 3_600_000);
  return { nextAt, state: { stage: 0, cycle: 0, phase: "backoff" } };
}

/**
 * Advance the escalation state machine one tick, called right after a
 * re-notification has been sent for `current`.
 */
export function computeNextSchedule(policy: EscalationPolicy, current: EscalationState, sentAt: Date = new Date()): ScheduleResult {
  if (current.phase === "backoff") {
    const nextStage = current.stage + 1;
    if (nextStage < policy.hoursSchedule.length) {
      return {
        nextAt: new Date(sentAt.getTime() + policy.hoursSchedule[nextStage] * 3_600_000),
        state: { stage: nextStage, cycle: current.cycle, phase: "backoff" },
      };
    }
    // Finished one full backoff cycle — repeat or move on.
    const nextCycle = current.cycle + 1;
    if (nextCycle < policy.cycles) {
      return {
        nextAt: new Date(sentAt.getTime() + policy.hoursSchedule[0] * 3_600_000),
        state: { stage: 0, cycle: nextCycle, phase: "backoff" },
      };
    }
    // All cycles done — move to daily phase (or stop if no daily phase configured).
    if (policy.dailyPhaseDays > 0) {
      return {
        nextAt: new Date(sentAt.getTime() + 24 * 3_600_000),
        state: { stage: 1, cycle: nextCycle, phase: "daily" },
      };
    }
    return computeWeeklyOrStop(policy, sentAt);
  }

  if (current.phase === "daily") {
    const nextDay = current.stage + 1;
    if (nextDay <= policy.dailyPhaseDays) {
      return {
        nextAt: new Date(sentAt.getTime() + 24 * 3_600_000),
        state: { stage: nextDay, cycle: current.cycle, phase: "daily" },
      };
    }
    return computeWeeklyOrStop(policy, sentAt);
  }

  if (current.phase === "weekly") {
    const nextWeek = current.stage + 1;
    if (nextWeek <= policy.weeklyPhaseWeeks) {
      return {
        nextAt: new Date(sentAt.getTime() + 7 * 24 * 3_600_000),
        state: { stage: nextWeek, cycle: current.cycle, phase: "weekly" },
      };
    }
    return { nextAt: null, state: { stage: current.stage, cycle: current.cycle, phase: "stopped" } };
  }

  // Already stopped.
  return { nextAt: null, state: current };
}

function computeWeeklyOrStop(policy: EscalationPolicy, sentAt: Date): ScheduleResult {
  if (policy.weeklyPhaseWeeks > 0) {
    return {
      nextAt: new Date(sentAt.getTime() + 7 * 24 * 3_600_000),
      state: { stage: 1, cycle: policy.cycles, phase: "weekly" },
    };
  }
  return { nextAt: null, state: { stage: 0, cycle: policy.cycles, phase: "stopped" } };
}
