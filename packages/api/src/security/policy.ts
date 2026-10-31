import { AppError } from '../http/errors';
import { createLimiter } from './rate-limit';

export const HTTP_BODY_BYTES = 16 * 1024;
export const SOCKET_PAYLOAD_BYTES = 96 * 1024;
/** Fixed windows from the first admitted request; all counters are process-local. */
export const BUDGETS = {
  'ip.http': [300, 60_000],
  'ip.password': [30, 60_000],
  'ip.github': [60, 60_000],
  'ip.handshake': [60, 60_000],
  'account.read': [180, 60_000],
  'account.conversation': [20, 60_000],
  'account.mutation': [30, 60_000],
  'account.connect': [30, 60_000],
  'account.event': [120, 10_000],
  'account.presence': [10, 10_000],
} as const;
export type Budget = keyof typeof BUDGETS;

export class SecurityBudgets {
  private readonly limits = new Map<Budget, ReturnType<typeof createLimiter>>();
  private readonly connections = new Map<string, number>();
  private active = 0;

  constructor(private readonly now: () => number = Date.now) {
    for (const [name, [limit, window]] of Object.entries(BUDGETS))
      this.limits.set(name as Budget, createLimiter(limit, window));
  }

  take(budget: Budget, identity: string) {
    this.limits.get(budget)!(identity, this.now());
  }

  /** Bound recurring timers/leases too, not just connection arrivals. */
  connect(userId: string) {
    const count = this.connections.get(userId) ?? 0;
    if (count >= 8 || this.active >= 256) throw new AppError('RATE_LIMITED');
    this.connections.set(userId, count + 1);
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.connections.get(userId) ?? 1) - 1;
      if (remaining) this.connections.set(userId, remaining);
      else this.connections.delete(userId);
      this.active -= 1;
    };
  }
}
