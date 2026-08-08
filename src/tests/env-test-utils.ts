/**
 * Shared environment capture/restore helpers for the single-process test
 * suite (the coverage gate runs with `--test-isolation=none`, so env leaks
 * travel across test files and into every spawned child).
 */

/**
 * Restores one environment variable to a previously captured value.
 *
 * Restoring a previously-unset variable MUST delete the key: assigning
 * `process.env.X = undefined` coerces to the literal string "undefined"
 * (Node semantics), which poisons downstream config resolution and spawned
 * children (for example the setup-doctor host probes would hand
 * `XDG_CONFIG_HOME="undefined"` to the installed opencode CLI, which then
 * creates a bogus `undefined/opencode` directory in its working directory).
 */
export function restoreEnvVar(
  name: string,
  previous: string | undefined,
): void {
  if (previous === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = previous;
}
