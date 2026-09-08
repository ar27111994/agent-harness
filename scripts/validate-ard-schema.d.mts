export function validateJsonSchema(
  value: unknown,
  schema: Record<string, unknown>,
  rootSchema?: Record<string, unknown>,
  path?: string,
): string[];

export function validateArdCatalogFile(
  catalogPath?: string,
  schemaPath?: string,
): Promise<string[]>;
