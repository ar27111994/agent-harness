/**
 * Returns the value following a CLI option, failing fast when the option is
 * present without a concrete value.
 */
export function getOptionValue(
  args: readonly string[],
  optionName: string,
): string | undefined {
  const optionIndex = args.indexOf(optionName);

  if (optionIndex === -1) {
    return undefined;
  }

  const value = args[optionIndex + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for '${optionName}'.`);
  }

  return value;
}

/**
 * Returns the single value provided for a non-repeatable CLI option, rejecting
 * duplicate occurrences instead of silently choosing one.
 */
export function getSingleOptionValue(
  args: readonly string[],
  optionName: string,
): string | undefined {
  const values = getOptionValues(args, optionName);

  if (values.length === 0) {
    return undefined;
  }

  if (values.length > 1) {
    throw new Error(`Option '${optionName}' may only be provided once.`);
  }

  return values[0];
}

/**
 * Returns every value provided for a repeatable CLI option, rejecting valueless
 * occurrences instead of accidentally consuming the next flag as data.
 */
export function getOptionValues(
  args: readonly string[],
  optionName: string,
): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== optionName) {
      continue;
    }

    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for '${optionName}'.`);
    }

    values.push(value);
  }

  return values;
}

/**
 * Returns whether a CLI flag was provided, rejecting duplicate occurrences.
 */
export function hasSingleFlag(
  args: readonly string[],
  flagName: string,
): boolean {
  const count = args.filter((arg) => arg === flagName).length;

  if (count > 1) {
    throw new Error(`Flag '${flagName}' may only be provided once.`);
  }

  return count === 1;
}
