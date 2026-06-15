/**
 * Circuit breaker for database connections.
 * After N consecutive failures within a window, opens the circuit.
 */

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitConfig {
  failureThreshold: number;
  successThreshold: number;
  cooldownMs: number;
}

const DEFAULT_CONFIG: CircuitConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  cooldownMs: 15_000,
};

class DatabaseCircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private config: CircuitConfig;

  constructor(config: Partial<CircuitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getState(): CircuitState {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.config.cooldownMs) {
        this.state = 'half-open';
        this.successes = 0;
      }
    }
    return this.state;
  }

  recordSuccess(): void {
    this.failures = 0;
    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = 'closed';
      }
    }
  }

  recordFailure(): void {
    this.lastFailureTime = Date.now();
    this.failures++;
    if (this.failures >= this.config.failureThreshold) {
      this.state = 'open';
    }
  }

  isOpen(): boolean {
    return this.getState() === 'open';
  }
}

export const dbCircuit = new DatabaseCircuitBreaker();

export async function withCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
  if (dbCircuit.isOpen()) {
    throw new Error('Database circuit breaker is open — service unavailable');
  }
  try {
    const result = await fn();
    dbCircuit.recordSuccess();
    return result;
  } catch (err) {
    dbCircuit.recordFailure();
    throw err;
  }
}
