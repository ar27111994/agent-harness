export interface ExtensionInstallAction {
  host: string;
  extensionId: string;
  command: string;
  verifyCommand: string;
  removeCommand: string;
}

const VS_CODE_EXTENSION_ID_PATTERN =
  /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/iu;

export function buildVsCodeExtensionInstallActions(
  extensionIds: string[],
): ExtensionInstallAction[] {
  return extensionIds.filter(isValidVsCodeExtensionId).map((extensionId) => ({
    host: "copilot-vscode",
    extensionId,
    command: `code --install-extension ${quotePowerShellArgument(extensionId)}`,
    verifyCommand: `code --list-extensions --show-versions`,
    removeCommand: `code --uninstall-extension ${quotePowerShellArgument(extensionId)}`,
  }));
}

export function isValidVsCodeExtensionId(extensionId: string): boolean {
  return VS_CODE_EXTENSION_ID_PATTERN.test(extensionId);
}

function quotePowerShellArgument(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function formatExtensionInstallActions(
  actions: ExtensionInstallAction[],
): string[] {
  return actions.map(
    (action) =>
      `${action.host}:${action.extensionId} install=${quoteFormattedCommand(action.command)} verify=${quoteFormattedCommand(action.verifyCommand)} remove=${quoteFormattedCommand(action.removeCommand)}`,
  );
}

function quoteFormattedCommand(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
