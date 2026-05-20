import assert from "node:assert/strict";
import test from "node:test";

import { createEmptySignalSet } from "../domains/discovery/signals.js";
import {
  applyTechnologySignatures,
  TECHNOLOGY_SIGNATURES,
} from "../domains/discovery/technology-signatures.js";

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

void test("technology signatures avoid substring false positives in text markers", () => {
  const signals = createEmptySignalSet();

  applyTechnologySignatures(signals, {
    text: "standard TypeScript process errors with cross-platform macros",
  });

  assert.ok(!signals.concerns.includes("robotics"));
  assert.ok(!signals.tooling.includes("ros"));
});

void test("technology signatures detect Flutter and Firebase pub dependencies", () => {
  const signals = createEmptySignalSet();

  applyTechnologySignatures(signals, {
    dependencyNames: ["flutter", "firebase_core", "cloud_firestore"],
    ecosystem: "pub",
  });

  assert.ok(signals.languages.includes("dart"));
  assert.ok(signals.frameworks.includes("flutter"));
  assert.ok(signals.frameworks.includes("firebase"));
  assert.ok(signals.concerns.includes("mobile"));
  assert.ok(signals.concerns.includes("database"));
  assert.ok(signals.concerns.includes("authentication"));
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

void test("technology signatures detect finance, BI, DevOps, and network packages", () => {
  const signals = createEmptySignalSet();

  applyTechnologySignatures(signals, {
    dependencyNames: ["ccxt", "backtrader", "streamlit", "ansible", "netmiko"],
    ecosystem: "pypi",
  });

  assert.ok(signals.concerns.includes("trading"));
  assert.ok(signals.concerns.includes("market-analysis"));
  assert.ok(signals.concerns.includes("business-intelligence"));
  assert.ok(signals.concerns.includes("devops"));
  assert.ok(signals.concerns.includes("network-automation"));
  assert.ok(signals.tooling.includes("ansible"));
});

void test("technology signatures detect PHP CMS and framework packages", () => {
  const signals = createEmptySignalSet();

  applyTechnologySignatures(signals, {
    dependencyNames: [
      "laravel/framework",
      "codeigniter4/framework",
      "laminas/laminas-mvc",
      "roots/wordpress",
      "drupal/core",
      "joomla/joomla-cms",
    ],
    ecosystem: "packagist",
  });

  assert.ok(signals.languages.includes("php"));
  assert.ok(signals.frameworks.includes("backend-framework"));
  assert.ok(signals.concerns.includes("backend"));
  assert.ok(signals.concerns.includes("cms"));
  assert.ok(signals.tooling.includes("wordpress"));
  assert.ok(signals.tooling.includes("drupal"));
  assert.ok(signals.tooling.includes("joomla"));
});

void test("technology signatures classify non npm and pypi ecosystems", () => {
  const cargoSignals = createEmptySignalSet();
  const mavenSignals = createEmptySignalSet();
  const nugetSignals = createEmptySignalSet();
  const gemSignals = createEmptySignalSet();
  const packagistSignals = createEmptySignalSet();

  applyTechnologySignatures(cargoSignals, {
    dependencyNames: ["embedded-hal", "anchor-lang", "axum"],
    ecosystem: "cargo",
  });
  applyTechnologySignatures(mavenSignals, {
    dependencyNames: ["org.springframework.boot:spring-boot-starter-web"],
    ecosystem: "maven",
  });
  applyTechnologySignatures(nugetSignals, {
    dependencyNames: ["Microsoft.AspNetCore.App"],
    ecosystem: "nuget",
  });
  applyTechnologySignatures(gemSignals, {
    dependencyNames: ["rails"],
    ecosystem: "gem",
  });
  applyTechnologySignatures(packagistSignals, {
    dependencyNames: ["laravel/framework"],
    ecosystem: "packagist",
  });

  assert.ok(cargoSignals.concerns.includes("embedded"));
  assert.ok(cargoSignals.concerns.includes("blockchain"));
  assert.ok(cargoSignals.frameworks.includes("rust-backend"));
  assert.ok(mavenSignals.frameworks.includes("java-backend"));
  assert.ok(nugetSignals.frameworks.includes("dotnet-backend"));
  assert.ok(gemSignals.frameworks.includes("backend-framework"));
  assert.ok(packagistSignals.frameworks.includes("backend-framework"));
});

void test("technology signatures avoid over-classifying common technical packages", () => {
  const signals = createEmptySignalSet();

  applyTechnologySignatures(signals, {
    dependencyNames: ["next-seo", "ws", "sqlalchemy"],
    ecosystem: "npm",
  });
  applyTechnologySignatures(signals, {
    dependencyNames: ["sqlalchemy"],
    ecosystem: "pypi",
  });

  assert.ok(signals.concerns.includes("seo"));
  assert.ok(signals.concerns.includes("database"));
  assert.ok(!signals.concerns.includes("marketing"));
  assert.ok(!signals.concerns.includes("network-automation"));
  assert.ok(!signals.concerns.includes("data-mining"));
});

void test("technology signatures detect modern workspace platforms", () => {
  const signals = createEmptySignalSet();

  applyTechnologySignatures(signals, {
    dependencyNames: [
      "nx",
      "wrangler",
      "react-native",
      "expo",
      "mastra",
      "@shopify/shopify-api",
      "@temporalio/client",
      "electron",
    ],
    ecosystem: "npm",
    text: "cloudflare workers vercel edge ai agent workflow orchestration desktop app",
  });

  assert.ok(signals.concerns.includes("monorepo"));
  assert.ok(signals.concerns.includes("build-orchestration"));
  assert.ok(signals.concerns.includes("serverless"));
  assert.ok(signals.concerns.includes("edge"));
  assert.ok(signals.concerns.includes("mobile"));
  assert.ok(signals.concerns.includes("ai-agent"));
  assert.ok(signals.concerns.includes("commerce"));
  assert.ok(signals.concerns.includes("workflow-orchestration"));
  assert.ok(signals.concerns.includes("desktop"));
  assert.ok(signals.tooling.includes("cloudflare"));
  assert.ok(signals.tooling.includes("react-native"));
  assert.ok(signals.tooling.includes("shopify"));
  assert.ok(signals.tooling.includes("temporal"));
});

void test("technology signatures detect Penpot MRDS design-source evidence", () => {
  const signals = createEmptySignalSet();

  applyTechnologySignatures(signals, {
    dependencyNames: ["@penpot/mcp", "style-dictionary"],
    ecosystem: "npm",
    text: "Penpot MRDS is the machine-readable design system and canonical design-source for frontend design work.",
  });

  assert.ok(signals.concerns.includes("design-systems"));
  assert.ok(signals.concerns.includes("design-source"));
  assert.ok(signals.concerns.includes("design-mcp"));
  assert.ok(signals.concerns.includes("frontend-design"));
  assert.ok(signals.concerns.includes("penpot"));
  assert.ok(signals.concerns.includes("penpot-mrds"));
  assert.ok(signals.tooling.includes("design-system"));
});

void test("technology signatures keep generic design-system evidence separate from Penpot", () => {
  const signals = createEmptySignalSet();

  applyTechnologySignatures(signals, {
    dependencyNames: ["style-dictionary"],
    ecosystem: "npm",
    text: "design tokens style dictionary",
  });

  assert.ok(signals.concerns.includes("design-systems"));
  assert.ok(signals.concerns.includes("design-source"));
  assert.ok(!signals.concerns.includes("design-mcp"));
  assert.ok(!signals.concerns.includes("penpot"));
  assert.ok(!signals.concerns.includes("penpot-mrds"));
  assert.ok(!signals.tooling.includes("penpot"));
  assert.ok(!signals.tooling.includes("penpot-mcp"));
});

void test("technology signatures reuse delimited text marker patterns across calls", () => {
  const firstSignals = createEmptySignalSet();
  const secondSignals = createEmptySignalSet();

  applyTechnologySignatures(firstSignals, {
    text: "apify actor webhook-debugger-logger pipeline",
  });
  applyTechnologySignatures(secondSignals, {
    text: "another webhook-debugger-logger automation",
  });

  assert.ok(firstSignals.frameworks.includes("apify"));
  assert.ok(secondSignals.frameworks.includes("apify"));
});

void test("technology signatures detect MLOps, creative, security, and content stacks", () => {
  const signals = createEmptySignalSet();

  applyTechnologySignatures(signals, {
    dependencyNames: [
      "mlflow",
      "chromadb",
      "sentence-transformers",
      "pydub",
      "yara-python",
      "next-seo",
    ],
    ecosystem: "pypi",
    text: "content marketing vector search video production",
  });
  applyTechnologySignatures(signals, {
    dependencyNames: ["next-seo", "@ffmpeg/ffmpeg"],
    ecosystem: "npm",
  });

  assert.ok(signals.concerns.includes("mlops"));
  assert.ok(signals.concerns.includes("vector-search"));
  assert.ok(signals.concerns.includes("audio-production"));
  assert.ok(signals.concerns.includes("malware-analysis"));
  assert.ok(signals.concerns.includes("content-marketing"));
  assert.ok(signals.concerns.includes("video-production"));
});

void test("technology signatures ignore blank text markers and tolerate sparse signal groups", () => {
  const signals = createEmptySignalSet();
  const signature = {
    id: "test-blank-marker",
    textMarkers: ["   "],
    signals: { tooling: ["blank-marker-ignored"] },
  } satisfies (typeof TECHNOLOGY_SIGNATURES)[number];
  const sparseSignalSignature = {
    id: "test-sparse-signals",
    textMarkers: ["sparse-platform"],
    signals: { tooling: ["sparse-platform"] },
  } satisfies (typeof TECHNOLOGY_SIGNATURES)[number];

  TECHNOLOGY_SIGNATURES.push(signature, sparseSignalSignature);
  try {
    applyTechnologySignatures(signals, { text: "anything sparse-platform" });
  } finally {
    TECHNOLOGY_SIGNATURES.pop();
    TECHNOLOGY_SIGNATURES.pop();
  }

  assert.deepEqual(signals.tooling, ["sparse-platform"]);
  assert.deepEqual(signals.concerns, []);
});
