import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

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
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
        },
      ],
    },
  },
  prettierConfig,
);
