export interface ExtensionInstallAction {
  host: string;
  extensionId: string;
  command: string;
  verifyCommand: string;
  removeCommand: string;
}

export function buildVsCodeExtensionInstallActions(
  extensionIds: string[],
): ExtensionInstallAction[] {
  return extensionIds.map((extensionId) => ({
    host: "copilot-vscode",
    extensionId,
    command: `code --install-extension ${extensionId}`,
    verifyCommand: `code --list-extensions --show-versions | grep ${extensionId}`,
    removeCommand: `code --uninstall-extension ${extensionId}`,
  }));
}

export function formatExtensionInstallActions(
  actions: ExtensionInstallAction[],
): string[] {
  return actions.map(
    (action) =>
      `${action.host}:${action.extensionId} install='${action.command}' verify='${action.verifyCommand}' remove='${action.removeCommand}'`,
  );
}
