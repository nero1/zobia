/**
 * lib/payments/circuit.ts
 *
 * SYS-04: Lightweight circuit breaker for external API calls.
 *
 * Avoids adding opossum as a dependency by implementing a minimal
 * circuit breaker with three states: CLOSED (normal), OPEN (failing),
 * HALF_OPEN (probing for recovery).
 *
 * State is kept in-process per serverless instance. For distributed
 * state across instances, use the Redis-backed variant below.
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Failure % threshold before opening (0–100). Default: 50 */
  errorThresholdPercentage?: number;
  /** Consecutive successes in HALF_OPEN before closing. Default: 2 */
  successThreshold?: number;
  /** Rolling window size (number of calls tracked). Default: 10 */
  windowSize?: number;
  /** Time in ms before moving from OPEN → HALF_OPEN. Default: 30000 */
  resetTimeoutMs?: number;
  /** Timeout for each call in ms. Default: 10000 */
  callTimeoutMs?: number;
  /** Name for logging. Default: "circuit" */
  name?: string;
}

// ---------------------------------------------------------------------------
// CircuitBreaker class
// ---------------------------------------------------------------------------

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures: boolean[] = [];
  private consecutiveSuccesses = 0;
  private openedAt: number | null = null;

  private readonly errorThreshold: number;
  private readonly successThreshold: number;
  private readonly windowSize: number;
  private readonly resetTimeoutMs: number;
  private readonly callTimeoutMs: number;
  private readonly name: string;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.errorThreshold = opts.errorThresholdPercentage ?? 50;
    this.successThreshold = opts.successThreshold ?? 2;
    this.windowSize = opts.windowSize ?? 10;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30_000;
    this.callTimeoutMs = opts.callTimeoutMs ?? 10_000;
    this.name = opts.name ?? "circuit";
  }

  get currentState(): CircuitState {
    return this.state;
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws if the circuit is OPEN.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.transitionIfNeeded();

    if (this.state === "OPEN") {
      throw new Error(`[${this.name}] Circuit is OPEN — request rejected`);
    }

    try {
      const result = await this.withTimeout(fn);
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`[${this.name}] Call timed out after ${this.callTimeoutMs}ms`)),
        this.callTimeoutMs
      );
      fn().then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }

  private transitionIfNeeded() {
    if (this.state === "OPEN" && this.openedAt !== null) {
      if (Date.now() - this.openedAt >= this.resetTimeoutMs) {
        this.state = "HALF_OPEN";
        this.consecutiveSuccesses = 0;
        console.info(`[${this.name}] Circuit moved to HALF_OPEN`);
      }
    }
  }

  private onSuccess() {
    this.failures.push(false);
    if (this.failures.length > this.windowSize) this.failures.shift();

    if (this.state === "HALF_OPEN") {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this.state = "CLOSED";
        this.failures = [];
        this.openedAt = null;
        console.info(`[${this.name}] Circuit CLOSED after recovery`);
      }
    }
  }

  private onFailure() {
    this.failures.push(true);
    if (this.failures.length > this.windowSize) this.failures.shift();

    const failCount = this.failures.filter(Boolean).length;
    const failRate = (failCount / this.failures.length) * 100;

    if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.openedAt = Date.now();
      this.consecutiveSuccesses = 0;
      console.warn(`[${this.name}] Circuit re-OPENED during probe`);
    } else if (this.state === "CLOSED" && failRate >= this.errorThreshold && this.failures.length >= this.windowSize) {
      this.state = "OPEN";
      this.openedAt = Date.now();
      console.warn(`[${this.name}] Circuit OPENED (failure rate: ${failRate.toFixed(1)}%)`);
    }
  }

  /** Returns a snapshot of current circuit health for monitoring. */
  getMetrics() {
    const failCount = this.failures.filter(Boolean).length;
    return {
      name: this.name,
      state: this.state,
      failureRate: this.failures.length > 0 ? (failCount / this.failures.length) * 100 : 0,
      openedAt: this.openedAt,
      windowSize: this.failures.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Shared breakers — singletons per process
// ---------------------------------------------------------------------------

export const paystackBreaker = new CircuitBreaker({
  name: "paystack",
  errorThresholdPercentage: 50,
  successThreshold: 2,
  windowSize: 10,
  resetTimeoutMs: 30_000,
  callTimeoutMs: 10_000,
});

export const expoPushBreaker = new CircuitBreaker({
  name: "expo-push",
  errorThresholdPercentage: 50,
  successThreshold: 2,
  windowSize: 20,
  resetTimeoutMs: 60_000,
  callTimeoutMs: 15_000,
});

export const dodoPaymentsBreaker = new CircuitBreaker({
  name: "dodopayments",
  errorThresholdPercentage: 50,
  successThreshold: 2,
  windowSize: 10,
  resetTimeoutMs: 30_000,
  callTimeoutMs: 10_000,
});

/**
 * Returns metrics for all circuit breakers — used in health-check CRON.
 */
export function getAllCircuitMetrics() {
  return [
    paystackBreaker.getMetrics(),
    expoPushBreaker.getMetrics(),
    dodoPaymentsBreaker.getMetrics(),
  ];
}
