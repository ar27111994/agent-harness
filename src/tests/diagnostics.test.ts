import assert from "node:assert/strict";
import test from "node:test";

import {
  formatActionableDiagnostic,
  installRefreshPolicyDiagnostic,
  noNativeInstallAssetsDiagnostic,
  unknownHostDiagnostic,
  unsupportedNativeInstallDiagnostic,
} from "../lib/diagnostics.js";
import type { InstallRefreshReport } from "../types.js";

void test("actionable diagnostics include reports, next commands, and policy-block labels", () => {
  const message = formatActionableDiagnostic(
    unsupportedNativeInstallDiagnostic({
      displayName: "OpenCode",
      hostId: "opencode",
    }),
  );

  assert.match(message, /Unsupported native install capability/u);
  assert.match(message, /What happened: OpenCode does not expose/u);
  assert.match(message, /Block type: policy\/review gate/u);
  assert.match(message, /agent-harness wire opencode --preview/u);
  assert.match(message, /README.md#v2-host-support-matrix/u);
});

void test("unknown host diagnostics list setup commands and supported host aliases", () => {
  const message = formatActionableDiagnostic(unknownHostDiagnostic("unknown"));

  assert.match(message, /Unsupported host adapter/u);
  assert.match(message, /agent-harness setup hosts/u);
  assert.match(message, /agent-harness wire <.*opencode.*vscode.*> --preview/u);
});

void test("no native-install asset diagnostic points to activation and recommendation reports", () => {
  const message = formatActionableDiagnostic(
    noNativeInstallAssetsDiagnostic({
      assetKind: "extension",
      displayName: "Cursor",
      hostId: "cursor",
    }),
  );

  assert.match(message, /No native-install assets selected/u);
  assert.match(message, /agent-harness workspace cursor --intent general/u);
  assert.match(message, /state\/recommendations.json/u);
  assert.match(message, /activate\/<host>\/activation-manifest.json/u);
});

void test("install refresh policy diagnostic distinguishes review blocks from clean reports", () => {
  const cleanReport = buildReport({
    reviewRequiredCount: 0,
    quarantinedCount: 0,
    blockedCount: 0,
  });
  assert.equal(installRefreshPolicyDiagnostic(cleanReport), null);

  const blockedReport = buildReport({
    reviewRequiredCount: 2,
    quarantinedCount: 1,
    blockedCount: 3,
  });
  const diagnostic = installRefreshPolicyDiagnostic(blockedReport);
  assert.ok(diagnostic);
  const message = formatActionableDiagnostic(diagnostic);

  assert.match(message, /Install refresh blocked by review policy/u);
  assert.match(message, /2 asset\(s\) require review/u);
  assert.match(message, /state\/install\/refresh-report.json/u);
  assert.match(message, /agent-harness quarantine inspect --asset <asset-id>/u);
});

function buildReport(counts: {
  reviewRequiredCount: number;
  quarantinedCount: number;
  blockedCount: number;
}): InstallRefreshReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    policy: "apply-safe",
    refreshedMirrorState: true,
    hosts: [
      {
        host: "opencode",
        pinnedGeneration: false,
        assetCount: 3,
        staleCount: 0,
        pinnedCount: 0,
        currentCount: 0,
        stageEligibleCount: 0,
        applyEligibleCount: 0,
        assets: [],
        ...counts,
      },
    ],
  };
}
