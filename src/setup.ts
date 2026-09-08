import {
  listHostAdapters,
  resolveHostAdapter,
  type HostAdapter,
} from "./host-adapters/registry.js";
import {
  handleUnknownCommand,
  hasHelpFlag,
  hasUnknownFlagsForSubcommands,
  printSubcommandHelp,
  type SubcommandHelpEntry,
} from "./cli-help-format.js";
import { collectActivatedAssetPrerequisiteDiagnostics } from "./lib/asset-prerequisites.js";
import { printCommandHelp } from "./lib/cli-output.js";
import { getOptionValue } from "./lib/cli-options.js";
import {
  formatPreflightDiagnostics,
  runAdapterPreflight,
  runHostPreflight,
  type PreflightDiagnostic,
  type PreflightFunctionOverrides,
} from "./lib/preflight.js";

/** Default per-adapter wall-clock timeout for `setup doctor` (ms). */
const DOCTOR_ADAPTER_TIMEOUT_MS = 30_000;

function parsePositiveIntegerEnv(
  value: string | undefined,
  defaultValue: number,
): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (/^\d+$/.test(trimmed) && Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return defaultValue;
}

/**
 * Dispatches setup and doctor commands for host inventory and readiness checks.
 */
export async function runSetup(
  args: string[],
  projectRoot?: string,
): Promise<number> {
  const [command = "doctor", ...rest] = args;

  if (hasHelpFlag(rest)) {
    printSetupSubcommandHelp(command);
    return 0;
  }

  switch (command) {
    case "doctor": {
      const rejection = rejectUnknownSetupFlags(command, rest);
      if (rejection !== null) return rejection;
      return (await runDoctor(rest, projectRoot)) ? 0 : 1;
    }
    case "hosts": {
      const rejection = rejectUnknownSetupFlags(command, rest);
      if (rejection !== null) return rejection;
      printHosts();
      return 0;
    }
    case "login": {
      const rejection = rejectUnknownSetupFlags(command, rest);
      if (rejection !== null) return rejection;
      return printLoginGuidance(rest);
    }
    case "help":
      printSetupHelp();
      return 0;
    default:
      return handleUnknownCommand(command, printSetupHelp);
  }
}

function rejectUnknownSetupFlags(
  command: string,
  rest: string[],
): number | null {
  return hasUnknownFlagsForSetupCommand(command, rest) ? 1 : null;
}

interface SetupSubcommandFlagSpec {
  knownFlags: ReadonlySet<string>;
  flagsWithValues: ReadonlySet<string>;
  usageHint: string;
}

const SETUP_SUBCOMMAND_FLAG_SPECS: Record<string, SetupSubcommandFlagSpec> = {
  doctor: {
    knownFlags: new Set(["--host"]),
    flagsWithValues: new Set(["--host"]),
    usageHint: "agent-harness setup doctor --help",
  },
  hosts: {
    knownFlags: new Set(),
    flagsWithValues: new Set(),
    usageHint: "agent-harness setup hosts --help",
  },
  login: {
    knownFlags: new Set(["--provider"]),
    flagsWithValues: new Set(["--provider"]),
    usageHint: "agent-harness setup login --help",
  },
};

function hasUnknownFlagsForSetupCommand(
  command: string,
  rest: string[],
): boolean {
  return hasUnknownFlagsForSubcommands(
    SETUP_SUBCOMMAND_FLAG_SPECS,
    command,
    rest,
  );
}

/** Optional preflight hooks used to make setup-doctor tests deterministic. */
export type AdapterPreflightFunctions = PreflightFunctionOverrides;

async function runAdapterPreflightWithTimeout(
  adapter: HostAdapter,
  adapterTimeoutMs: number,
  projectRoot?: string,
  cumulativeSignal?: AbortSignal,
  preflight: AdapterPreflightFunctions = {
    runHostPreflight,
    runAdapterPreflight,
    collectActivatedAssetPrerequisiteDiagnostics,
  },
): Promise<PreflightDiagnostic[]> {
  const {
    runHostPreflight: runHostPreflightFn = runHostPreflight,
    runAdapterPreflight: runAdapterPreflightFn = runAdapterPreflight,
    collectActivatedAssetPrerequisiteDiagnostics:
      collectPrerequisiteDiagnosticsFn = collectActivatedAssetPrerequisiteDiagnostics,
  } = preflight;
  const signal = AbortSignal.timeout(adapterTimeoutMs);

  const combined = new AbortController();
  const wireSignal = (source: AbortSignal): void => {
    if (source.aborted) {
      combined.abort(source.reason);
      return;
    }
    source.addEventListener("abort", () => combined.abort(source.reason), {
      once: true,
    });
  };
  wireSignal(signal);
  if (cumulativeSignal) wireSignal(cumulativeSignal);

  try {
    return await Promise.race([
      (async () => [
        ...(await runHostPreflightFn(adapter.lifecycleHost, {
          requireHostPaths:
            adapter.requiresLifecycleHostPaths ?? adapter.mutatesHostPaths,
        })),
        ...(await runAdapterPreflightFn(adapter, combined.signal)),
        ...(projectRoot
          ? await collectPrerequisiteDiagnosticsFn(projectRoot, adapter, {
              missingEnvSeverity: "warning",
            })
          : []),
      ])(),
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
    ]);
  } catch (err) {
    // The outer doctor runner owns the cumulative timeout diagnostic. Do not
    // relabel a cumulative abort as an adapter-specific timeout here.
    if (cumulativeSignal?.aborted) {
      throw err;
    }
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return [doctorTimeoutDiagnostic(adapter, adapterTimeoutMs)];
    }
    // DELETED the prior `if (signal.aborted) return doctorTimeoutDiagnostic`
    // fallback: `signal` is AbortSignal.timeout(adapterTimeoutMs) and the only
    // reject source keyed on it (the race's abort listener) always rejects
    // with `signal.reason`, which IS a DOMException TimeoutError. So every
    // signal-abort lands on the DOMException arm above and this branch could
    // never be reached (verified empirically: a plain error thrown after the
    // abort still settles the race via the DOMException reason first). A plain
    // (non-timeout) error from the pipeline reaches `throw err` below.
    throw err;
  }
}

function doctorTimeoutDiagnostic(
  adapter: HostAdapter,
  adapterTimeoutMs: number,
): PreflightDiagnostic {
  return {
    severity: "warning",
    code: `${adapter.id}-doctor-timeout`,
    message: `Preflight check timed out after ${adapterTimeoutMs}ms.`,
    action:
      "Increase AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS or check the host CLI for hanging processes.",
  };
}

function cumulativeTimeoutDiagnostic(
  adapter: HostAdapter,
  cumulativeTimeoutMs: number,
  adapterTimeoutMs: number,
): PreflightDiagnostic {
  return {
    severity: "warning",
    code: `${adapter.id}-cumulative-timeout`,
    message: `Preflight check exceeded cumulative timeout of ${cumulativeTimeoutMs}ms (per-adapter timeout: ${adapterTimeoutMs}ms).`,
    action:
      "Increase AGENT_HARNESS_SETUP_DOCTOR_TIMEOUT_MS or check for hanging host processes.",
  };
}

function isAdapterReady(diagnostics: readonly PreflightDiagnostic[]): boolean {
  return !diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "warning" || diagnostic.severity === "error",
  );
}

function formatLifecycleHost(adapter: HostAdapter): string {
  if (adapter.lifecycleHost === adapter.recommendationHost) {
    return `Lifecycle host: ${adapter.lifecycleHost}`;
  }
  return `Lifecycle host: ${adapter.lifecycleHost} (reused lifecycle implementation for ${adapter.id})`;
}

async function runDoctor(
  args: string[],
  projectRoot: string | undefined,
  options: {
    preflightRunner?: typeof runAdapterPreflightWithTimeout;
    preflight?: AdapterPreflightFunctions;
    cumulativeSignal?: AbortSignal;
  } = {},
): Promise<boolean> {
  const hostName = getOptionValue(args, "--host");

  const adapters = hostName
    ? [resolveHostAdapter(hostName)].filter(
        (adapter): adapter is HostAdapter => adapter !== null,
      )
    : listHostAdapters();

  if (adapters.length === 0) {
    process.stderr.write(
      `error: No registered host adapter matched '${hostName}'.\n`,
    );
    return false;
  }

  const resolvePreflight =
    options.preflightRunner ?? runAdapterPreflightWithTimeout;

  const adapterTimeoutMs = parsePositiveIntegerEnv(
    process.env.AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS,
    DOCTOR_ADAPTER_TIMEOUT_MS,
  );
  const cumulativeTimeoutMs = parsePositiveIntegerEnv(
    process.env.AGENT_HARNESS_SETUP_DOCTOR_TIMEOUT_MS,
    adapterTimeoutMs + 2 * 10_000,
  );

  // Progress belongs on stderr; stdout is reserved for the structured human
  // report and final aggregate verdict. Label both timeout scopes explicitly.
  process.stderr.write(
    `Checking host readiness for ${adapters.length} adapter(s) (per-adapter timeout: ${adapterTimeoutMs}ms; cumulative timeout: ${cumulativeTimeoutMs}ms)...\n`,
  );

  const cumulativeSignal =
    options.cumulativeSignal ?? AbortSignal.timeout(cumulativeTimeoutMs);
  const adapterResults = await Promise.allSettled(
    adapters.map(async (adapter) => {
      const adapterLabel = `${adapter.displayName} (${adapter.id})`;
      process.stderr.write(`  Checking ${adapterLabel}...\n`);
      try {
        return await Promise.race([
          resolvePreflight(
            adapter,
            adapterTimeoutMs,
            projectRoot,
            cumulativeSignal,
            options.preflight,
          ),
          new Promise<never>((_, reject) => {
            if (cumulativeSignal.aborted) {
              reject(
                cumulativeSignal.reason ??
                  new DOMException("Timeout", "TimeoutError"),
              );
              return;
            }
            cumulativeSignal.addEventListener(
              "abort",
              () =>
                reject(
                  cumulativeSignal.reason ??
                    new DOMException("Timeout", "TimeoutError"),
                ),
              { once: true },
            );
          }).catch((): PreflightDiagnostic[] => [
            cumulativeTimeoutDiagnostic(
              adapter,
              cumulativeTimeoutMs,
              adapterTimeoutMs,
            ),
          ]),
        ]);
      } catch (err) {
        if (err instanceof DOMException && err.name === "TimeoutError") {
          process.stderr.write(
            `    timed out after ${cumulativeTimeoutMs}ms cumulative budget\n`,
          );
          return [
            cumulativeTimeoutDiagnostic(
              adapter,
              cumulativeTimeoutMs,
              adapterTimeoutMs,
            ),
          ] satisfies PreflightDiagnostic[];
        }
        throw err;
      }
    }),
  );

  let hasErrors = false;
  let readyCount = 0;

  for (const [resultIndex, result] of adapterResults.entries()) {
    const adapter = adapters[resultIndex];
    if (result.status === "rejected") {
      process.stderr.write(
        `[error] ${adapter.id}-doctor-internal-error: ${String(result.reason)}\n`,
      );
      hasErrors = true;
      continue;
    }

    const diagnostics = result.value;
    console.log(`\n# ${adapter.displayName} (${adapter.id})`);
    console.log(formatLifecycleHost(adapter));
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

    if (diagnostics.length > 0) {
      process.stderr.write(`${formatPreflightDiagnostics(diagnostics)}\n`);
    }
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      hasErrors = true;
    }
    if (isAdapterReady(diagnostics)) {
      readyCount += 1;
    }
  }

  console.log(`${readyCount}/${adapters.length} hosts ready`);
  return !hasErrors;
}

function printLoginGuidance(args: string[]): number {
  const provider = getOptionValue(args, "--provider") ?? args[0] ?? "github";
  const normalizedProvider = provider.toLowerCase();
  const guidanceByProvider = buildLoginGuidanceByProvider();
  const adapter = resolveHostAdapter(normalizedProvider);
  const guidance =
    guidanceByProvider[normalizedProvider] ??
    (adapter ? buildAdapterLoginGuidance(adapter) : undefined);
  if (!guidance) {
    process.stderr.write(
      `error: Unknown login provider '${provider}'. Known providers: ${getLoginProviderNames(guidanceByProvider).join(", ")}\n`,
    );
    process.stderr.write("Run 'agent-harness setup login --help' for usage.\n");
    return 1;
  }

  console.log(`# ${normalizedProvider} login guidance`);
  for (const line of guidance) console.log(`- ${line}`);
  return 0;
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
    const nativeInstallKinds = adapter.nativeInstall
      ? [adapter.nativeInstall.assetKind]
      : [];
    const wireKinds = adapter.capabilities
      .filter((capability) => capability.behaviors.includes("wire"))
      .map((capability) => capability.assetKind);
    const runtimeChecks = [
      adapter.runtime?.versionArgs ? "version" : undefined,
      adapter.runtime?.readinessArgs ? "readiness" : undefined,
    ].filter((check): check is string => check !== undefined);

    console.log(
      `${adapter.id}\t${adapter.displayName}\taliases=${adapter.aliases.join(",")}\tlifecycle=${adapter.lifecycleHost}\trecommendation=${adapter.recommendationHost}\tbundles=${adapter.defaultBundleIds.join(",")}\twire=${wireKinds.join(",")}\tnativeInstall=${nativeInstallKinds.join(",") || "none"}\truntime=${adapter.runtime?.executable ?? "none"}\truntimeChecks=${runtimeChecks.join(",") || "none"}`,
    );
  }
}

function printSetupSubcommandHelp(subcommand: string): void {
  const helpTexts: Record<string, SubcommandHelpEntry> = {
    doctor: {
      heading: "setup doctor — Check host CLI readiness",
      lines: [
        "Usage: agent-harness setup doctor [--host <host>]",
        "",
        "Checks required host CLIs and adapter prerequisites concurrently.",
        "Warnings mean the affected host is not ready, but are informational:",
        "exit 0 means the doctor completed without a hard error; exit 1 means a",
        "hard preflight/internal failure. The final 'N/M hosts ready' line is the",
        "readiness verdict for users and scripts.",
        "",
        "Lifecycle host reuse: Cursor reuses copilot-vscode lifecycle mechanics;",
        "Zed, Claude Code, Pi, and Codex reuse OpenCode lifecycle mechanics.",
        "",
        "Options:",
        "  --host <host>   Limit check to a specific host adapter",
        "",
        `Env: AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS (default: ${DOCTOR_ADAPTER_TIMEOUT_MS})`,
        "Env: AGENT_HARNESS_SETUP_DOCTOR_TIMEOUT_MS (cumulative run budget)",
      ],
    },
    hosts: {
      heading: "setup hosts — List registered host adapters",
      lines: [
        "Usage: agent-harness setup hosts",
        "",
        "Lists all registered host adapters with their lifecycle hosts,",
        "wire hosts, and supported asset kinds.",
      ],
    },
    login: {
      heading: "setup login — Interactive host login",
      lines: [
        "Usage: agent-harness setup login [--provider <provider>]",
        "",
        "Guides you through interactive login for host-specific",
        "authentication (API keys, OAuth, CLI auth).",
      ],
    },
  };

  printSubcommandHelp(subcommand, helpTexts, printSetupHelp);
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
      { command: "hosts", description: "List registered host adapters" },
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

/** Exposes setup-doctor helpers for focused tests. */
export const setupInternals = {
  DOCTOR_ADAPTER_TIMEOUT_MS,
  hasUnknownFlagsForSetupCommand,
  parsePositiveIntegerEnv,
  runAdapterPreflightWithTimeout,
  runDoctor,
  isAdapterReady,
  formatLifecycleHost,
  async runDoctorWithAdapters(
    adapters: HostAdapter[],
    adapterTimeoutMs: number,
    projectRoot?: string,
    cumulativeTimeoutMs?: number,
    preflightRunner:
      typeof runAdapterPreflightWithTimeout | undefined = undefined,
    cumulativeSignal: AbortSignal | undefined = undefined,
  ): Promise<{
    hasErrors: boolean;
    results: Array<{ adapterId: string; diagnostics: PreflightDiagnostic[] }>;
  }> {
    const resolvePreflight = preflightRunner ?? runAdapterPreflightWithTimeout;
    const effectiveCumulativeMs = cumulativeTimeoutMs ?? adapterTimeoutMs;
    const effectiveCumulativeSignal =
      cumulativeSignal ?? AbortSignal.timeout(effectiveCumulativeMs);
    const adapterResults = await Promise.allSettled(
      adapters.map(async (adapter) =>
        resolvePreflight(
          adapter,
          adapterTimeoutMs,
          projectRoot,
          effectiveCumulativeSignal,
        ),
      ),
    );

    let hasErrors = false;
    const results: Array<{
      adapterId: string;
      diagnostics: PreflightDiagnostic[];
    }> = [];

    for (const [resultIndex, result] of adapterResults.entries()) {
      if (result.status === "rejected") {
        const adapterId = adapters[resultIndex].id;
        if (effectiveCumulativeSignal.aborted) {
          results.push({
            adapterId,
            diagnostics: [
              cumulativeTimeoutDiagnostic(
                adapters[resultIndex],
                effectiveCumulativeMs,
                adapterTimeoutMs,
              ),
            ],
          });
          continue;
        }
        if (
          result.reason instanceof DOMException &&
          result.reason.name === "TimeoutError"
        ) {
          results.push({
            adapterId,
            diagnostics: [
              doctorTimeoutDiagnostic(adapters[resultIndex], adapterTimeoutMs),
            ],
          });
          continue;
        }
        hasErrors = true;
        results.push({
          adapterId,
          diagnostics: [
            {
              severity: "error",
              code: "internal-error",
              message: String(result.reason),
            },
          ],
        });
        continue;
      }
      const adapterId = adapters[resultIndex].id;
      results.push({ adapterId, diagnostics: result.value });
      if (result.value.some((d) => d.severity === "error")) {
        hasErrors = true;
      }
    }

    return { hasErrors, results };
  },
};
