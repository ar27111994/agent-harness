import assert from "node:assert/strict";
import test from "node:test";

import { createEmptySignalSet } from "../domains/discovery/signals.js";
import { applyTechnologySignatures } from "../domains/discovery/technology-signatures.js";

void test("technology signatures detect third-party vendors without bespoke code paths", () => {
  const signals = createEmptySignalSet();

  applyTechnologySignatures(signals, {
    dependencyNames: [
      "@apify/client",
      "@azure/storage-blob",
      "@google-cloud/storage",
      "hardhat",
      "ethers",
      "react",
    ],
    ecosystem: "npm",
    text: "lead generation marketing automation",
  });

  assert.ok(signals.frameworks.includes("apify"));
  assert.ok(signals.frameworks.includes("react"));
  assert.ok(signals.concerns.includes("cloud"));
  assert.ok(signals.concerns.includes("blockchain"));
  assert.ok(signals.concerns.includes("marketing"));
  assert.ok(signals.tooling.includes("azure"));
  assert.ok(signals.tooling.includes("gcp"));
  assert.ok(signals.tooling.includes("web3"));
});

void test("technology signatures detect AI, robotics, security, and data packages", () => {
  const signals = createEmptySignalSet();

  applyTechnologySignatures(signals, {
    dependencyNames: [
      "torch",
      "stable-baselines3",
      "scapy",
      "pymavlink",
      "pandas",
    ],
    ecosystem: "pypi",
  });

  assert.ok(signals.concerns.includes("machine-learning"));
  assert.ok(signals.concerns.includes("reinforcement-learning"));
  assert.ok(signals.concerns.includes("security"));
  assert.ok(signals.concerns.includes("pentesting"));
  assert.ok(signals.concerns.includes("robotics"));
  assert.ok(signals.concerns.includes("data-engineering"));
  assert.ok(signals.tooling.includes("ros"));
});
