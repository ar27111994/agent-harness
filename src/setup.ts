import {
  listHostAdapters,
  resolveHostAdapter,
  type HostAdapter,
} from "./host-adapters/registry.js";
import { collectActivatedAssetPrerequisiteDiagnostics } from "./lib/asset-prerequisites.js";
import { printCommandHelp } from "./lib/cli-output.js";
import { getOptionValue } from "./lib/cli-options.js";
import {
  formatPreflightDiagnostics,
  runAdapterPreflight,
  runHostPreflight,
} from "./lib/preflight.js";

/**
 * Dispatches setup and doctor commands for host inventory and readiness checks.
 */
export async function runSetup(
  args: string[],
  projectRoot?: string,
): Promise<number> {
  const [command = "doctor", ...rest] = args;

  switch (command) {
    case "doctor":
      return (await runDoctor(rest, projectRoot)) ? 0 : 1;
    case "hosts":
      printHosts();
      return 0;
    case "login":
      printLoginGuidance(rest);
      return 0;
    case "help":
      printSetupHelp();
      return 0;
    default:
      printSetupHelp();
      return 1;
  }
}

/**
 * Prints adapter metadata and preflight diagnostics, returning whether all
 * required checks passed.
 */
async function runDoctor(
  args: string[],
  projectRoot: string | undefined,
): Promise<boolean> {
  const hostName = getOptionValue(args, "--host");

  const adapters = hostName
    ? [resolveHostAdapter(hostName)].filter(
        (adapter): adapter is HostAdapter => adapter !== null,
      )
    : listHostAdapters();

  if (adapters.length === 0) {
    console.log(`No registered host adapter matched '${hostName}'.`);
    return false;
  }

  let hasErrors = false;

  for (const adapter of adapters) {
    console.log(`\n# ${adapter.displayName} (${adapter.id})`);
    console.log(`Lifecycle host: ${adapter.lifecycleHost}`);
    console.log(`Recommendation host: ${adapter.recommendationHost}`);
    console.log(
      `Requires lifecycle host paths: ${adapter.requiresLifecycleHostPaths ?? adapter.mutatesHostPaths}`,
    );
    console.log(`Default bundles: ${adapter.defaultBundleIds.join(", ")}`);
    if (adapter.runtime) {
      console.log(`Runtime executable: ${adapter.runtime.executable}`);
      if (adapter.runtime.guidance) {
        console.log(`Runtime guidance: ${adapter.runtime.guidance}`);
      }
    }
    console.log("Capabilities:");
    for (const capability of adapter.capabilities) {
      console.log(
        `- ${capability.assetKind}: ${capability.behaviors.join(", ")}`,
      );
    }

    const diagnostics = [
      ...(await runHostPreflight(adapter.lifecycleHost, {
        requireHostPaths:
          adapter.requiresLifecycleHostPaths ?? adapter.mutatesHostPaths,
      })),
      ...(await runAdapterPreflight(adapter)),
      ...(projectRoot
        ? await collectActivatedAssetPrerequisiteDiagnostics(
            projectRoot,
            adapter,
            { missingEnvSeverity: "warning" },
          )
        : []),
    ];
    if (diagnostics.length > 0) {
      console.log(formatPreflightDiagnostics(diagnostics));
    }
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      hasErrors = true;
    }
  }

  return !hasErrors;
}

function printLoginGuidance(args: string[]): void {
  const provider = getOptionValue(args, "--provider") ?? args[0] ?? "github";
  const normalizedProvider = provider.toLowerCase();
  const guidanceByProvider = buildLoginGuidanceByProvider();
  const adapter = resolveHostAdapter(normalizedProvider);
  const guidance =
    guidanceByProvider[normalizedProvider] ??
    (adapter ? buildAdapterLoginGuidance(adapter) : undefined);
  if (!guidance) {
    console.log(
      `Unknown login provider '${provider}'. Known providers: ${getLoginProviderNames(guidanceByProvider).join(", ")}`,
    );
    return;
  }

  console.log(`# ${normalizedProvider} login guidance`);
  for (const line of guidance) {
    console.log(`- ${line}`);
  }
}

function buildLoginGuidanceByProvider(): Record<string, string[]> {
  return {
    github: [
      "GitHub authentication improves discovery throughput for public and private repository sources.",
      "Create a least-privileged token at https://github.com/settings/tokens?type=beta or https://github.com/settings/tokens.",
      "Set GITHUB_PERSONAL_ACCESS_TOKEN or GITHUB_TOKEN in your shell, CI secret store, or local .env file.",
    ],
    npm: [
      "npm authentication is required only for package publication.",
      "Use npm trusted publishing from GitHub Actions for releases, or run npm login locally for manual package management.",
    ],
    "copilot-vscode": [
      "VS Code/Copilot host-login prerequisites require a signed-in GitHub Copilot session in VS Code.",
      "Run code --version and code --list-extensions --show-versions to verify CLI and marketplace access.",
      "Use the VS Code Accounts menu to sign in to GitHub if Copilot or extension access is unavailable.",
    ],
    vscode: [
      "VS Code/Copilot host-login prerequisites require a signed-in GitHub Copilot session in VS Code.",
      "Run code --version and code --list-extensions --show-versions to verify CLI and marketplace access.",
      "Use the VS Code Accounts menu to sign in to GitHub if Copilot or extension access is unavailable.",
    ],
    cursor: [
      "Cursor host-login prerequisites require a signed-in Cursor session.",
      "Run cursor --version and cursor --list-extensions --show-versions to verify CLI and marketplace access.",
      "Use Cursor account settings to sign in before applying host wire-in that depends on account state.",
    ],
    opencode: [
      "OpenCode host-login prerequisites require a working OpenCode CLI session for runtime validation.",
      "Run opencode --version to verify CLI availability.",
    ],
    anthropic: [
      "Anthropic OAuth or token prerequisites require an Anthropic account or API key.",
      "Set ANTHROPIC_API_KEY for token-based assets, or complete the OAuth flow described by the asset setup URL.",
    ],
    openai: [
      "OpenAI OAuth or token prerequisites require an OpenAI account or API key.",
      "Set OPENAI_API_KEY for token-based assets, or complete the OAuth flow described by the asset setup URL.",
    ],
    sentry: [
      "Sentry OAuth or token prerequisites require access to the target Sentry organization.",
      "Set SENTRY_AUTH_TOKEN for token-based assets, or complete the OAuth flow described by the asset setup URL.",
    ],
    ai: [
      "Optional AI enrichment uses an OpenAI-compatible chat completions endpoint.",
      "Set AGENT_HARNESS_AI_ENRICHMENT_URL, AGENT_HARNESS_AI_ENRICHMENT_API_KEY, and optionally AGENT_HARNESS_AI_ENRICHMENT_MODEL.",
      "Use AGENT_HARNESS_AI_ENRICHMENT_MODE to choose one of: off, manual, after-select, after-workspace, on-ambiguity, on-input-change, or ci-only.",
      "Manual commands include 'discover enrich' and wrapper flags such as '--ai-enrich' on discover/workspace flows.",
    ],
  };
}

function buildAdapterLoginGuidance(adapter: HostAdapter): string[] {
  const runtimeGuidance = adapter.runtime?.guidance
    ? [adapter.runtime.guidance]
    : [];
  return [
    `${adapter.displayName} host-login prerequisites require a signed-in and usable host runtime when assets depend on account state.`,
    ...runtimeGuidance,
    `Run setup doctor --host ${adapter.id} to check CLI, version, and readiness diagnostics for this adapter.`,
  ];
}

function getLoginProviderNames(
  guidanceByProvider: Record<string, string[]>,
): string[] {
  return [
    ...new Set([
      ...Object.keys(guidanceByProvider),
      ...listHostAdapters().flatMap((adapter) => [
        adapter.id,
        ...adapter.aliases,
      ]),
    ]),
  ].sort((left, right) => left.localeCompare(right));
}

function printHosts(): void {
  for (const adapter of listHostAdapters()) {
    console.log(
      `${adapter.id}\t${adapter.displayName}\taliases=${adapter.aliases.join(",")}`,
    );
  }
}

function printSetupHelp(): void {
  const hostNames = listHostAdapters()
    .flatMap((adapter) => [adapter.id, ...adapter.aliases])
    .sort((left, right) => left.localeCompare(right))
    .join("|");
  const providerNames = getLoginProviderNames(
    buildLoginGuidanceByProvider(),
  ).join("|");
  printCommandHelp({
    heading: "setup commands:",
    entries: [
      {
        command: "doctor",
        description:
          "Check config, host readiness, capabilities, and guided setup notes",
      },
      {
        command: "hosts",
        description: "List registered host adapters",
      },
      {
        command: "login",
        description: "Print provider-specific login/OAuth guidance",
      },
    ],
    sections: [
      {
        title: "Options:",
        lines: [`--host <${hostNames}>`, `--provider <${providerNames}>`],
      },
    ],
  });
}
