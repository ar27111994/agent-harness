import { rm } from "node:fs/promises";

/** Controls retry timing for transient filesystem removal failures. */
export interface RetryRemoveOptions {
  maxRetries?: number;
  retryDelayMs?: number;
}

type RemoveImplementation = (
  path: string,
  options: { force: boolean; recursive: boolean },
) => Promise<void>;
type SleepImplementation = (delayMs: number) => Promise<void>;

const RETRYABLE_REMOVE_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

/**
 * Recursively removes a tree while tolerating short-lived Windows file locks.
 * Other failures are surfaced immediately so smoke/release gates do not hide
 * genuine filesystem problems.
 */
export async function removeTreeWithRetries(
  path: string,
  options: RetryRemoveOptions = {},
  remove: RemoveImplementation = rm,
  sleep: SleepImplementation = defaultSleep,
): Promise<void> {
  const maxRetries = options.maxRetries ?? 10;
  const retryDelayMs = options.retryDelayMs ?? 50;

  let attempt = 0;
  const removeAttempt = async (): Promise<void> => {
    try {
      await remove(path, { force: true, recursive: true });
    } catch (error) {
      if (!isRetryableRemoveError(error) || attempt >= maxRetries) {
        throw error;
      }
      await sleep(retryDelayMs * (attempt + 1));
      attempt += 1;
      await removeAttempt();
    }
  };

  await removeAttempt();
}

function isRetryableRemoveError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    RETRYABLE_REMOVE_CODES.has(error.code)
  );
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Exposes removal classification helpers for focused tests. */
export const retryRemoveInternals = { isRetryableRemoveError } as const;
