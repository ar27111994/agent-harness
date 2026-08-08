import {
  listHostAdapters,
  resolveHostAdapter,
  type HostAdapter,
} from "./host-adapters/registry.js";
import {
  handleUnknownCommand,
  hasHelpFlag,
  printSubcommandHelp,
  hasUnknownFlag,
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
/**
 * Parses a positive integer from an environment variable string, falling back
 * to `defaultValue` when the variable is absent or not a positive integer.
 */
function parsePositiveIntegerEnv(
  value: string | undefined,
  defaultValue: number,
): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const trimmed = value.trim();
  // Use Number() instead of parseInt() to reject floats like "5.5".
  const parsed = Number(trimmed);
  // Also reject hex/octal/scientific notation by checking the string is pure digits.
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

  // Detect --help flag and show subcommand-specific help (#383).
  if (hasHelpFlag(rest)) {
    printSetupSubcommandHelp(command);
    return 0;
  }

  switch (command) {
    case "doctor":
      if (hasUnknownFlagsForSetupCommand(command, rest)) {
        return 1;
      }
      return (await runDoctor(rest, projectRoot)) ? 0 : 1;
    case "hosts":
      if (hasUnknownFlagsForSetupCommand(command, rest)) {
        return 1;
      }
      printHosts();
      return 0;
    case "login":
      if (hasUnknownFlagsForSetupCommand(command, rest)) {
        return 1;
      }
      printLoginGuidance(rest);
      return 0;
    case "help":
      printSetupHelp();
      return 0;
    default:
      return handleUnknownCommand(command, printSetupHelp);
  }
}

/**
 * Describes the known flags of a setup subcommand for the shared unknown-flag
 * guard. Collapses the previously repeated `hasUnknownFlag(rest, new Set(...),
 * new Set(...), usage)` blocks into one table (#431).
 */
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

/**
 * Rejects flags that a setup subcommand does not declare in its flag spec,
 * printing an unknown-option error with a usage pointer (#431).
 */
function hasUnknownFlagsForSetupCommand(
  command: string,
  rest: string[],
): boolean {
  const spec = SETUP_SUBCOMMAND_FLAG_SPECS[command];
  if (spec === undefined) {
    return false;
  }
  return hasUnknownFlag(
    rest,
    spec.knownFlags,
    spec.flagsWithValues,
    spec.usageHint,
  );
}

/**
 * Prints adapter metadata and preflight diagnostics, returning whether all
 * required checks passed.
 *
 * All adapter preflights run concurrently. A per-adapter wall-clock timeout
 * (default 5 s, env `AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS`) caps the
 * maximum wall time for any single adapter's check. This prevents a stalling
 * host CLI (e.g. cursor, zed waiting for IPC) from blocking the entire loop.
 */

/**
 * Runs preflight checks for a single adapter with a wall-clock timeout.
 * If the adapter stalls, a synthetic timeout diagnostic is returned instead
 * of blocking the entire doctor loop. Used by both `runDoctor` and
 * `runDoctorWithAdapters`.
 */
/**
 * Preflight functions the per-adapter runner delegates to. Exposed as an
 * injection seam so tests can force non-timeout failures deterministically.
 */
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
  // Resolve the shared optional seam to concrete functions so partial
  // test overrides fall back to the real implementations.
  const {
    runHostPreflight: runHostPreflightFn = runHostPreflight,
    runAdapterPreflight: runAdapterPreflightFn = runAdapterPreflight,
    collectActivatedAssetPrerequisiteDiagnostics:
      collectPrerequisiteDiagnosticsFn = collectActivatedAssetPrerequisiteDiagnostics,
  } = preflight;
  const signal = AbortSignal.timeout(adapterTimeoutMs);

  // Create a combined signal that fires when EITHER the per-adapter timeout
  // or the cumulative timeout fires. This ensures child processes spawned
  // during preflight checks are actually killed rather than running in the
  // background after the doctor has already returned a timeout diagnostic.
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
  if (cumulativeSignal) {
    wireSignal(cumulativeSignal);
  }

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
      // Reject when the abort signal fires so Promise.race resolves immediately.
      // AbortSignal.timeout always aborts with a TimeoutError reason, so the
      // rejection payload is that reason itself — no fallback branch exists.
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
    ]);
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return [
        {
          severity: "warning",
          code: `${adapter.id}-doctor-timeout`,
          message: `Preflight check timed out after ${adapterTimeoutMs}ms.`,
          action:
            "Increase AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS or check the host CLI for hanging processes.",
        },
      ];
    }
    // If the combined signal was already aborted (per-adapter or cumulative
    // timeout, possibly during cleanup), return a timeout diagnostic. This
    // must check the COMBINED controller: the cumulative deadline can fire
    // while the per-adapter timer is still running.
    if (combined.signal.aborted) {
      return [
        {
          severity: "warning",
          code: `${adapter.id}-doctor-timeout`,
          message: `Preflight check timed out after ${adapterTimeoutMs}ms.`,
          action:
            "Increase AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS or check the host CLI for hanging processes.",
        },
      ];
    }
    throw err;
  }
}

async function runDoctor(
  args: string[],
  projectRoot: string | undefined,
  options: {
    preflightRunner?: typeof runAdapterPreflightWithTimeout;
    preflight?: AdapterPreflightFunctions;
    // Injection seam (#428 follow-up): tests can pre-abort the cumulative
    // signal to exercise the already-aborted race branch (lazy scheduling
    // path) without waiting on a real timeout timer.
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
    console.log(`No registered host adapter matched '${hostName}'.`);
    return false;
  }

  const resolvePreflight =
    options.preflightRunner ?? runAdapterPreflightWithTimeout;

  const adapterTimeoutMs = parsePositiveIntegerEnv(
    process.env.AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS,
    DOCTOR_ADAPTER_TIMEOUT_MS,
  );

  // Derive the cumulative default from the resolved per-adapter timeout
  // plus headroom for the worst-case sequential runtime preflight budget
  // (two checks at the default hostCommands.preflightTimeoutMs of 15s each).
  // This ensures the cumulative timeout scales with any user-configured
  // per-adapter timeout rather than being pinned to a fixed constant.
  const cumulativeTimeoutMs = parsePositiveIntegerEnv(
    process.env.AGENT_HARNESS_SETUP_DOCTOR_TIMEOUT_MS,
    adapterTimeoutMs + 2 * 10_000,
  );

  // Print progress immediately so the user sees activity — a hung doctor
  // that prints nothing for 15+ seconds is indistinguishable from a crash.
  console.error(
    `Checking host readiness for ${adapters.length} adapter(s) (timeout: ${cumulativeTimeoutMs}ms)...`,
  );

  // Run all adapter preflights concurrently so one stalling CLI does not
  // block the others. Each adapter is individually guarded by a wall-clock
  // timeout; if it fires we emit a synthetic timeout diagnostic and continue.
  // A cumulative timeout at the top level prevents the overall run from
  // hanging indefinitely even when all adapters collectively exceed budget.
  const cumulativeSignal =
    options.cumulativeSignal ?? AbortSignal.timeout(cumulativeTimeoutMs);
  const adapterResults = await Promise.allSettled(
    adapters.map(async (adapter) => {
      const adapterLabel = `${adapter.displayName} (${adapter.id})`;
      console.error(`  Checking ${adapterLabel}...`);
      try {
        const result = await Promise.race([
          resolvePreflight(
            adapter,
            adapterTimeoutMs,
            projectRoot,
            cumulativeSignal,
            options.preflight,
          ),
          // Reject immediately when cumulativeSignal is already aborted,
          // then register listener with once: true so it cleans up after firing.
          // Structurally unreachable through the default AbortSignal.timeout
          // path (races are created synchronously before any timer fires);
          // exercised directly via the cumulativeSignal injection seam for
          // the future lazy-scheduling case.
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
          }).catch((): PreflightDiagnostic[] => {
            // The cumulative deadline fired before this adapter finished and
            // the race resolved through the abort path. Resolve with a
            // synthetic timeout diagnostic instead of undefined (#428 —
            // undefined here crashed the per-adapter summary with a
            // "reading 'length' of undefined" TypeError).
            return [
              {
                severity: "warning",
                code: `${adapter.id}-cumulative-timeout`,
                message: `Preflight check timed out after cumulative timeout of ${cumulativeTimeoutMs}ms.`,
                action:
                  "Increase AGENT_HARNESS_SETUP_DOCTOR_TIMEOUT_MS or check for hanging host processes.",
              },
            ];
          }),
        ]);
        return result;
      } catch (err) {
        if (err instanceof DOMException && err.name === "TimeoutError") {
          console.error(
            `    timed out after ${cumulativeTimeoutMs}ms cumulative budget`,
          );
          return [
            {
              severity: "warning",
              code: `${adapter.id}-cumulative-timeout`,
              message: `Preflight check timed out after cumulative timeout of ${cumulativeTimeoutMs}ms.`,
              action:
                "Increase AGENT_HARNESS_SETUP_DOCTOR_TIMEOUT_MS or check for hanging host processes.",
            },
          ] satisfies PreflightDiagnostic[];
        }
        throw err;
      }
    }),
  );

  let hasErrors = false;

  for (const [resultIndex, result] of adapterResults.entries()) {
    // Promise.allSettled only rejects on uncaught throws. Our inner async
    // function always resolves (the race resolves either way), so a rejection
    // here is a genuine internal error — surface it with the adapter identity.
    if (result.status === "rejected") {
      // map/allSettled keep results index-aligned with adapters, so the
      // adapter at this index is defined by construction; direct access
      // fails loudly if that invariant ever breaks.
      const adapterId = adapters[resultIndex].id;
      console.log(
        `\n# (${adapterId} — preflight threw unexpectedly)\n[error] ${String(result.reason)}`,
      );
      hasErrors = true;
      continue;
    }

    const adapter = adapters[resultIndex];
    const diagnostics = result.value;
    console.log(`\n# ${adapter.displayName} (${adapter.id})`);
    console.log(`Lifecycle host: ${adapter.lifecycleHost}`);
    console.log(`Recommendation host: ${adapter.recommendationHost}`);
    // requiresLifecycleHostPaths is optional on HostAdapter; the fallback is
    // live behavior for adapters that only declare mutatesHostPaths.
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

/**
 * Prints help for a specific setup subcommand (#383).
 */
function printSetupSubcommandHelp(subcommand: string): void {
  const helpTexts: Record<string, SubcommandHelpEntry> = {
    doctor: {
      heading: "setup doctor — Check host CLI readiness",
      lines: [
        "Usage: agent-harness setup doctor [--host <host>]",
        "",
        "Checks whether the required host CLIs are installed and accessible on",
        "PATH. Runs adapter preflights concurrently with per-adapter timeouts.",
        "",
        "Options:",
        "  --host <host>   Limit check to a specific host adapter",
        "",
        "Env: AGENT_HARNESS_SETUP_DOCTOR_HOST_TIMEOUT_MS (default: 5000)",
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

/**
 * Exposes narrow setup internals for focused concurrency and timeout tests.
 *
 * `runDoctorWithAdapters` accepts an explicit adapter list and timeout so tests
 * can inject a mock adapter with a blocking preflight without touching the
 * global adapter registry.
 */
export const setupInternals = {
  DOCTOR_ADAPTER_TIMEOUT_MS,
  parsePositiveIntegerEnv,
  runAdapterPreflightWithTimeout,
  runDoctor,
  /** Run the doctor loop over an explicit adapter list with separate timeouts. */
  async runDoctorWithAdapters(
    adapters: HostAdapter[],
    adapterTimeoutMs: number,
    projectRoot?: string,
    cumulativeTimeoutMs?: number,
    // Injection seam (#428): tests can substitute the per-adapter preflight
    // runner to exercise the aggregator's rejection/error branches without
    // relying on experimental module mocks.
    preflightRunner:
      typeof runAdapterPreflightWithTimeout | undefined = undefined,
    // Injection seam (#428 follow-up): tests can pre-abort the cumulative
    // signal to exercise the already-aborted race branch (lazy scheduling
    // path) without waiting on a real timeout timer.
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
        hasErrors = true;
        // map/allSettled keep results index-aligned with adapters, so the
        // adapter at this index is defined by construction; direct access
        // fails loudly if that invariant ever breaks.
        const adapterId = adapters[resultIndex].id;
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
