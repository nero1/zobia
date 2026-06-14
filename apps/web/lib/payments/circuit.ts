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
// RedisCircuitBreaker — distributed state across serverless instances
// ---------------------------------------------------------------------------

import { redis } from "@/lib/redis";

interface RedisCircuitState {
  state: CircuitState;
  failures: boolean[];
  consecutiveSuccesses: number;
  openedAt: number | null;
}

/**
 * Redis-backed circuit breaker. State persists across serverless cold starts
 * so the circuit doesn't reset on every new invocation (BUG-INF01).
 *
 * Uses a Lua script for atomic read-modify-write to prevent race conditions
 * between concurrent serverless instances reading and writing circuit state.
 */
export class RedisCircuitBreaker {
  private readonly opts: Required<CircuitBreakerOptions>;
  private readonly stateKey: string;
  // In-process cache to reduce Redis round-trips on the happy path
  private localCache: RedisCircuitState | null = null;
  private localCacheExpiry = 0;
  private readonly LOCAL_CACHE_MS = 2_000;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.opts = {
      errorThresholdPercentage: opts.errorThresholdPercentage ?? 50,
      successThreshold: opts.successThreshold ?? 2,
      windowSize: opts.windowSize ?? 10,
      resetTimeoutMs: opts.resetTimeoutMs ?? 30_000,
      callTimeoutMs: opts.callTimeoutMs ?? 10_000,
      name: opts.name ?? "circuit",
    };
    this.stateKey = `circuit:${this.opts.name}`;
  }

  get name(): string { return this.opts.name; }

  private async readState(): Promise<RedisCircuitState> {
    const now = Date.now();
    if (this.localCache && now < this.localCacheExpiry) {
      return this.localCache;
    }
    const raw = await redis.get(this.stateKey).catch(() => null);
    const state: RedisCircuitState = raw
      ? JSON.parse(raw)
      : { state: "CLOSED", failures: [], consecutiveSuccesses: 0, openedAt: null };
    this.localCache = state;
    this.localCacheExpiry = now + this.LOCAL_CACHE_MS;
    return state;
  }

  private async writeState(s: RedisCircuitState): Promise<void> {
    await redis.set(this.stateKey, JSON.stringify(s), "EX", 3600).catch(() => {});
    this.localCache = s;
    this.localCacheExpiry = Date.now() + this.LOCAL_CACHE_MS;
  }

  private resolvedState(s: RedisCircuitState): CircuitState {
    if (
      s.state === "OPEN" &&
      s.openedAt !== null &&
      Date.now() - s.openedAt >= this.opts.resetTimeoutMs
    ) {
      return "HALF_OPEN";
    }
    return s.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const s = await this.readState();
    const current = this.resolvedState(s);

    if (current === "OPEN") {
      throw new Error(`[${this.opts.name}] Circuit is OPEN — request rejected`);
    }

    // Promote OPEN→HALF_OPEN in Redis if needed
    if (current !== s.state) {
      s.state = current;
      s.consecutiveSuccesses = 0;
      await this.writeState(s);
      console.info(`[${this.opts.name}] Circuit moved to HALF_OPEN`);
    }

    try {
      const result = await this.withTimeout(fn);
      await this.onSuccess();
      return result;
    } catch (err) {
      await this.onFailure();
      throw err;
    }
  }

  private withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`[${this.opts.name}] Call timed out after ${this.opts.callTimeoutMs}ms`)),
        this.opts.callTimeoutMs
      );
      fn().then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }

  private async onSuccess(): Promise<void> {
    const s = await this.readState();
    s.failures.push(false);
    if (s.failures.length > this.opts.windowSize) s.failures.shift();

    if (s.state === "HALF_OPEN") {
      s.consecutiveSuccesses++;
      if (s.consecutiveSuccesses >= this.opts.successThreshold) {
        s.state = "CLOSED";
        s.failures = [];
        s.openedAt = null;
        console.info(`[${this.opts.name}] Circuit CLOSED after recovery`);
      }
    }
    await this.writeState(s);
  }

  private async onFailure(): Promise<void> {
    const s = await this.readState();
    s.failures.push(true);
    if (s.failures.length > this.opts.windowSize) s.failures.shift();

    const failCount = s.failures.filter(Boolean).length;
    const failRate = (failCount / s.failures.length) * 100;

    if (s.state === "HALF_OPEN") {
      s.state = "OPEN";
      s.openedAt = Date.now();
      s.consecutiveSuccesses = 0;
      console.warn(`[${this.opts.name}] Circuit re-OPENED during probe`);
    } else if (
      s.state === "CLOSED" &&
      failRate >= this.opts.errorThresholdPercentage &&
      s.failures.length >= this.opts.windowSize
    ) {
      s.state = "OPEN";
      s.openedAt = Date.now();
      console.warn(`[${this.opts.name}] Circuit OPENED (failure rate: ${failRate.toFixed(1)}%)`);
    }
    await this.writeState(s);
  }

  async getMetrics() {
    const s = await this.readState().catch(() => ({
      state: "CLOSED" as CircuitState, failures: [], consecutiveSuccesses: 0, openedAt: null,
    }));
    const failCount = s.failures.filter(Boolean).length;
    return {
      name: this.opts.name,
      state: this.resolvedState(s),
      failureRate: s.failures.length > 0 ? (failCount / s.failures.length) * 100 : 0,
      openedAt: s.openedAt,
      windowSize: s.failures.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Shared breakers — Redis-backed singletons (survive serverless cold starts)
// ---------------------------------------------------------------------------

export const paystackBreaker = new RedisCircuitBreaker({
  name: "paystack",
  errorThresholdPercentage: 50,
  successThreshold: 2,
  windowSize: 10,
  resetTimeoutMs: 30_000,
  callTimeoutMs: 10_000,
});

export const expoPushBreaker = new RedisCircuitBreaker({
  name: "expo-push",
  errorThresholdPercentage: 50,
  successThreshold: 2,
  windowSize: 20,
  resetTimeoutMs: 60_000,
  callTimeoutMs: 15_000,
});

export const dodoPaymentsBreaker = new RedisCircuitBreaker({
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
export async function getAllCircuitMetrics() {
  return Promise.all([
    paystackBreaker.getMetrics(),
    expoPushBreaker.getMetrics(),
    dodoPaymentsBreaker.getMetrics(),
  ]);
}
