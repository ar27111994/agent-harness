/**
 * Lightweight deadline tracking for long-running CLI operations.
 *
 * Supports the `--timeout-seconds` global CLI flag (#402, #404). Operations
 * that may exceed reasonable wall-clock time can check the deadline
 * periodically and exit gracefully with a clear message instead of timing
 * out at the process boundary with no context.
 */

const DEFAULT_TIMEOUT_ENV = "AGENT_HARNESS_TIMEOUT_SECONDS";

/** Minimum supported timeout in seconds — prevents accidental 0-second deadlines. */
const MIN_TIMEOUT_SECONDS = 10;

/** Maximum supported timeout in seconds — caps runaway values. */
const MAX_TIMEOUT_SECONDS = 3_600; // 1 hour

/**
 * Thrown when a CLI operation exceeds its configured `--timeout-seconds` deadline.
 */
export class DeadlineExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeadlineExceededError";
  }
}

/**
 * An immutable deadline computed from a timeout in seconds.
 */
export interface Deadline {
  /** Absolute wall-clock timestamp (Date.now()) after which the deadline is exceeded. */
  readonly at: number;
  /** The original timeout in seconds that produced this deadline. */
  readonly timeoutSeconds: number;
}

/** The active deadline for the current CLI invocation, if any. */
let activeDeadline: Deadline | undefined;

/**
 * Sets the active deadline for the current CLI invocation.
 * Called once from cli.ts after parsing global options.
 */
export function setActiveDeadline(deadline: Deadline | undefined): void {
  activeDeadline = deadline;
}

/**
 * Returns the active deadline, or `undefined` when no timeout was set.
 */
export function getActiveDeadline(): Deadline | undefined {
  return activeDeadline;
}

/**
 * Creates a Deadline from a timeout in seconds.
 * Returns `undefined` when `timeoutSeconds` is falsy (no deadline set).
 * Clamps to `[MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS]`.
 */
export function createDeadline(
  timeoutSeconds: number | undefined,
): Deadline | undefined {
  if (timeoutSeconds === undefined || timeoutSeconds <= 0) return undefined;
  const clamped = Math.max(
    MIN_TIMEOUT_SECONDS,
    Math.min(timeoutSeconds, MAX_TIMEOUT_SECONDS),
  );
  return { at: Date.now() + clamped * 1000, timeoutSeconds: clamped };
}

/**
 * Reads the timeout from a CLI flag value (string), falling back to the
 * AGENT_HARNESS_TIMEOUT_SECONDS env var, then to `undefined` (no deadline).
 */
export function resolveTimeoutSeconds(
  flagValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = flagValue ?? env[DEFAULT_TIMEOUT_ENV];
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/**
 * Returns `true` when the deadline has been exceeded.
 * Always `false` when `deadline` is `undefined`.
 */
export function isDeadlineExceeded(deadline: Deadline | undefined): boolean {
  if (!deadline) return false;
  return Date.now() >= deadline.at;
}

/**
 * Throws `DeadlineExceededError` when the deadline has been exceeded.
 * No-op when `deadline` is `undefined`.
 */
export function assertNotDeadlineExceeded(
  deadline: Deadline | undefined,
  context: string,
): void {
  if (deadline && Date.now() >= deadline.at) {
    throw new DeadlineExceededError(
      `Deadline of ${deadline.timeoutSeconds}s exceeded during: ${context}`,
    );
  }
}
