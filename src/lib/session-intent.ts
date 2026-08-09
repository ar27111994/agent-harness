import type { SessionIntent } from "../types.js";
import { replaceRunsWithDash } from "./safe-paths.js";

/**
 * Enumerates the supported session intent values accepted by the CLI and reports.
 */
export const SESSION_INTENTS = [
  "general",
  "frontend",
  "backend",
  "mobile",
  "devops",
  "security",
  "docs",
  "testing",
  "research",
  "data",
  "design",
  "product",
  "marketing",
] as const satisfies readonly SessionIntent[];

/**
 * Renders the supported canonical session intents for CLI help text.
 */
export const SESSION_INTENT_CHOICES = SESSION_INTENTS.join("|");

const INTENT_ALIASES: Record<string, SessionIntent> = {
  default: "general",
  ui: "frontend",
  client: "frontend",
  api: "backend",
  service: "backend",
  server: "backend",
  app: "mobile",
  ios: "mobile",
  android: "mobile",
  flutter: "mobile",
  infra: "devops",
  infrastructure: "devops",
  cicd: "devops",
  "ci-cd": "devops",
  operations: "devops",
  ops: "devops",
  sre: "devops",
  platform: "devops",
  "platform-engineering": "devops",
  documentation: "docs",
  doc: "docs",
  knowledge: "docs",
  "knowledge-base": "docs",
  writing: "docs",
  test: "testing",
  qa: "testing",
  validation: "testing",
  discovery: "research",
  "product-research": "product",
  planning: "product",
  roadmap: "product",
  requirements: "product",
  prd: "product",
  spec: "product",
  ba: "product",
  "business-analysis": "product",
  branding: "design",
  brand: "design",
  ux: "design",
  creative: "design",
  content: "marketing",
  seo: "marketing",
};

const INTENT_CONCERN_MAP: Record<SessionIntent, string[]> = {
  general: [],
  frontend: ["frontend"],
  backend: ["backend", "integration"],
  mobile: ["mobile", "ios", "android"],
  devops: ["devops", "ci-cd", "infrastructure", "platform-engineering"],
  security: ["security", "policy-as-code", "vulnerability-management"],
  docs: ["documentation", "knowledge-base", "writing"],
  testing: ["testing", "debugging"],
  research: ["research", "publishing", "writing", "knowledge-base"],
  data: [
    "data",
    "data-engineering",
    "analytics",
    "business-intelligence",
    "reporting",
  ],
  design: ["design-systems", "design-assets", "creative-production"],
  product: ["business-analysis", "documentation", "research", "knowledge-base"],
  marketing: [
    "marketing",
    "content-creation",
    "content-marketing",
    "seo",
    "campaigns",
    "lead-generation",
    "cms",
    "blog",
  ],
};

const INTENT_KEYWORD_MAP: Record<SessionIntent, string[]> = {
  general: [],
  frontend: ["frontend", "ui", "client", "react", "vue", "svelte"],
  backend: ["backend", "service", "api", "integration", "webhook"],
  mobile: [
    "mobile",
    "ios",
    "android",
    "flutter",
    "dart",
    "swift",
    "kotlin",
    "xcode",
    "pub",
  ],
  devops: [
    "devops",
    "ci-cd",
    "infra",
    "infrastructure",
    "platform-engineering",
    "terraform",
    "kubernetes",
    "docker",
    "helm",
    "ansible",
    "pulumi",
  ],
  security: [
    "security",
    "hardening",
    "validation",
    "sast",
    "secret-scanning",
    "policy-as-code",
    "pentesting",
    "vulnerability-management",
  ],
  docs: [
    "docs",
    "documentation",
    "guide",
    "reference",
    "readme",
    "knowledge-base",
    "writing",
  ],
  testing: ["testing", "tests", "validation", "qa", "debugging", "playwright"],
  research: [
    "research",
    "discovery",
    "notebooks",
    "paper",
    "publishing",
    "latex",
    "writing",
    "market-analysis",
  ],
  data: [
    "data",
    "analytics",
    "business-intelligence",
    "reporting",
    "dashboarding",
    "sql",
    "etl",
    "data-engineering",
  ],
  design: [
    "design",
    "branding",
    "brand",
    "ux",
    "ui",
    "design-systems",
    "design-assets",
    "creative-production",
    "penpot",
  ],
  product: [
    "product",
    "planning",
    "roadmap",
    "requirements",
    "prd",
    "spec",
    "business-analysis",
    "research",
    "discovery",
  ],
  marketing: [
    "marketing",
    "seo",
    "content-marketing",
    "content",
    "content-creation",
    "campaigns",
    "lead-generation",
    "cms",
    "blog",
  ],
};

const INTENT_TASK_MODE_MAP: Record<SessionIntent, string[]> = {
  general: [],
  frontend: ["implementation", "focused"],
  backend: ["implementation", "automation"],
  mobile: ["implementation", "focused", "mobile"],
  devops: ["operations", "automation"],
  security: ["validation", "operations", "security"],
  docs: ["research", "focused"],
  testing: ["validation", "focused"],
  research: ["research", "analysis", "focused"],
  data: ["analysis", "focused"],
  design: ["design", "focused"],
  product: ["analysis", "research", "focused"],
  marketing: ["marketing", "analysis", "focused"],
};

/**
 * Parses and validates session intent CLI/runtime values.
 */
export function parseSessionIntent(
  value: string | undefined,
  optionName = "--intent",
): SessionIntent {
  const normalizedValue = normalizeSessionIntentValue(value);
  if (SESSION_INTENTS.includes(normalizedValue as SessionIntent)) {
    return normalizedValue as SessionIntent;
  }

  const aliasedIntent = INTENT_ALIASES[normalizedValue];
  if (aliasedIntent) {
    return aliasedIntent;
  }

  throw new Error(
    `Invalid ${optionName} value '${value}'. Must be one of: ${SESSION_INTENTS.join(", ")}`,
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

function normalizeSessionIntentValue(value: string | undefined): string {
  const trimmedValue = (value ?? "general").trim().toLowerCase();
  if (trimmedValue.length === 0) {
    return "general";
  }

  // Linear run-collapse (a `+` over a negated class is a CodeQL
  // polynomial-reDoS risk on adversarial input; the one-pass scan is not).
  return replaceRunsWithDash(trimmedValue, isIntentValueCharacter).replace(
    /^-+|-+$/gu,
    "",
  );
}

/**
 * Returns whether the character is safe to keep verbatim in a normalized
 * session intent value.
 */
function isIntentValueCharacter(character: string): boolean {
  return /[a-z0-9]/u.test(character);
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
