import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const cliOutputFiles = [
  "src/activate.ts",
  "src/cli.ts",
  "src/discover.ts",
  "src/domains/discovery/ai-enrichment.ts",
  "src/domains/discovery/catalog-inspection.ts",
  "src/domains/discovery/diff.ts",
  "src/domains/discovery/environment-index.ts",
  "src/domains/discovery/source-index.ts",
  "src/install.ts",
  "src/install/*.ts",
  "src/lib/cli-output.ts",
  "src/mirror.ts",
  "src/mirror/*.ts",
  "src/quarantine.ts",
  "src/rebuild.ts",
  "src/recommend.ts",
  "src/recommend/commands.ts",
  "src/setup.ts",
  "src/wire.ts",
  "src/workspace.ts",
  "src/tests/cli-smoke.ts",
  "src/tests/detection-quality.ts",
  "src/tests/pack-smoke.ts",
  "src/tests/policy-coverage.ts",
  "src/tests/scan-benchmark.ts",
  "src/tests/workspace-smoke.ts",
];

// Keep no-magic-numbers scoped to policy/runtime hot paths where numeric
// thresholds directly affect user-visible safety, ranking, or resource limits.
// Expanding it repository-wide would add noise in fixture-heavy modules; add
// files here intentionally as they gain policy-style constants.
const magicThresholdFiles = [
  "src/activate.ts",
  "src/config/runtime.ts",
  "src/domains/discovery/ai-enrichment.ts",
  "src/domains/discovery/demand-signals.ts",
  "src/domains/discovery/official-index-harvester.ts",
  "src/domains/discovery/source-sync.ts",
  "src/install/refresh.ts",
  "src/mirror/acquire.ts",
  "src/recommend/selection.ts",
];

export default defineConfig(
  {
    ignores: [
      ".opencode/**",
      ".tmp/**",
      "activate/**",
      "discover/output/**",
      "discover/catalog.assets.jsonl",
      "dist/**",
      "install/**",
      "mirror/audit/**",
      "mirror/bundles/**",
      "mirror/index.jsonl",
      "mirror/quarantine/**",
      "mirror/raw/**",
      "node_modules/**",
      "state/**",
    ],
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: cliOutputFiles,
    rules: {
      "no-console": ["error", { allow: ["log", "warn", "error"] }],
    },
  },
  {
    files: magicThresholdFiles,
    rules: {
      "no-magic-numbers": [
        "error",
        {
          detectObjects: false,
          enforceConst: true,
          ignore: [-1, 0, 1],
          ignoreArrayIndexes: true,
          ignoreClassFieldInitialValues: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
        },
      ],
    },
  },
  prettierConfig,
);
