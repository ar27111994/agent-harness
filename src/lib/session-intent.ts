import type { SessionIntent } from "../types.js";

/**
 * Enumerates the supported session intent values accepted by the CLI and reports.
 */
export const SESSION_INTENTS = [
  "general",
  "frontend",
  "backend",
  "security",
  "docs",
  "testing",
] as const satisfies readonly SessionIntent[];

const INTENT_CONCERN_MAP: Record<SessionIntent, string[]> = {
  general: [],
  frontend: ["frontend"],
  backend: ["backend", "integration"],
  security: ["security"],
  docs: ["docs"],
  testing: ["testing"],
};

const INTENT_KEYWORD_MAP: Record<SessionIntent, string[]> = {
  general: [],
  frontend: ["frontend", "ui", "client"],
  backend: ["backend", "service", "api"],
  security: ["security", "hardening", "validation"],
  docs: ["docs", "documentation", "research"],
  testing: ["testing", "tests", "validation"],
};

const INTENT_TASK_MODE_MAP: Record<SessionIntent, string[]> = {
  general: [],
  frontend: ["implementation", "focused"],
  backend: ["implementation", "automation"],
  security: ["validation", "operations"],
  docs: ["research", "focused"],
  testing: ["validation", "focused"],
};

/**
 * Parses and validates session intent CLI/runtime values.
 */
export function parseSessionIntent(
  value: string | undefined,
  optionName = "--intent",
): SessionIntent {
  const normalizedValue = (value ?? "general").trim().toLowerCase();
  if (SESSION_INTENTS.includes(normalizedValue as SessionIntent)) {
    return normalizedValue as SessionIntent;
  }

  throw new Error(
    `Invalid ${optionName} value '${value ?? ""}'. Must be one of: ${SESSION_INTENTS.join(", ")}`,
  );
}

/**
 * Returns concern terms injected by the requested session intent.
 */
export function getSessionIntentConcernTerms(
  intent: SessionIntent,
): readonly string[] {
  return INTENT_CONCERN_MAP[intent];
}

/**
 * Returns normalized demand keywords implied by the requested session intent.
 */
export function getSessionIntentKeywords(
  intent: SessionIntent,
): readonly string[] {
  return INTENT_KEYWORD_MAP[intent];
}

/**
 * Returns task-mode hints implied by the requested session intent.
 */
export function getSessionIntentTaskModes(
  intent: SessionIntent,
): readonly string[] {
  return INTENT_TASK_MODE_MAP[intent];
}

/**
 * Returns whether one recommendation already aligns with the requested intent.
 */
export function recommendationMatchesSessionIntent(options: {
  intent: SessionIntent;
  coverageTags: readonly string[];
  taskModes: readonly string[];
}): boolean {
  if (options.intent === "general") {
    return false;
  }

  const requiredCoverage = new Set(
    getSessionIntentConcernTerms(options.intent),
  );
  const requiredTaskModes = new Set(getSessionIntentTaskModes(options.intent));

  return (
    options.coverageTags.some((tag) => requiredCoverage.has(tag)) ||
    options.taskModes.some((taskMode) => requiredTaskModes.has(taskMode))
  );
}
