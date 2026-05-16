import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_INTENTS,
  getSessionIntentConcernTerms,
  getSessionIntentKeywords,
  getSessionIntentTaskModes,
  parseSessionIntent,
  recommendationMatchesSessionIntent,
} from "../lib/session-intent.js";

void test("session intents expose the expanded supported taxonomy", () => {
  assert.deepEqual(SESSION_INTENTS, [
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
  ]);
});

void test("session intent parsing accepts common aliases for expanded workflows", () => {
  assert.equal(parseSessionIntent(undefined), "general");
  assert.equal(parseSessionIntent("   "), "general");
  assert.equal(parseSessionIntent("documentation"), "docs");
  assert.equal(parseSessionIntent("ci-cd"), "devops");
  assert.equal(parseSessionIntent("branding"), "design");
  assert.equal(parseSessionIntent("ba"), "product");
  assert.equal(parseSessionIntent("planning"), "product");
  assert.equal(parseSessionIntent("product-research"), "product");
  assert.throws(
    () => parseSessionIntent("definitely-not-valid", "--session-intent"),
    /Invalid --session-intent value 'definitely-not-valid'/u,
  );
  assert.throws(
    () => parseSessionIntent("still-not-valid", "--intent"),
    /Invalid --intent value 'still-not-valid'/u,
  );
});

void test("session intents inject domain-specific concern, keyword, and task-mode hints", () => {
  assert.deepEqual(getSessionIntentConcernTerms("devops"), [
    "devops",
    "ci-cd",
    "infrastructure",
    "platform-engineering",
  ]);
  assert.ok(getSessionIntentKeywords("design").includes("branding"));
  assert.ok(getSessionIntentKeywords("product").includes("planning"));
  assert.ok(getSessionIntentKeywords("marketing").includes("seo"));
  assert.ok(getSessionIntentTaskModes("research").includes("analysis"));
  assert.ok(getSessionIntentTaskModes("mobile").includes("mobile"));
  assert.ok(getSessionIntentTaskModes("devops").includes("operations"));
});

void test("session intent recommendation matching works for new intent families", () => {
  assert.equal(
    recommendationMatchesSessionIntent({
      intent: "general",
      coverageTags: ["frontend"],
      taskModes: ["implementation"],
    }),
    false,
  );
  assert.equal(
    recommendationMatchesSessionIntent({
      intent: "devops",
      coverageTags: ["ci-cd"],
      taskModes: ["operations"],
    }),
    true,
  );
  assert.equal(
    recommendationMatchesSessionIntent({
      intent: "design",
      coverageTags: ["design-assets"],
      taskModes: ["design"],
    }),
    true,
  );
  assert.equal(
    recommendationMatchesSessionIntent({
      intent: "product",
      coverageTags: ["business-analysis"],
      taskModes: ["analysis"],
    }),
    true,
  );
  assert.equal(
    recommendationMatchesSessionIntent({
      intent: "research",
      coverageTags: [],
      taskModes: ["analysis"],
    }),
    true,
  );
  assert.equal(
    recommendationMatchesSessionIntent({
      intent: "marketing",
      coverageTags: ["content-marketing"],
      taskModes: ["marketing"],
    }),
    true,
  );
  assert.equal(
    recommendationMatchesSessionIntent({
      intent: "backend",
      coverageTags: ["frontend"],
      taskModes: ["focused"],
    }),
    false,
  );
});
