import * as vscode from 'vscode';
import * as path from 'path';

// Centralized constants & helpers for integration tests.
export const POWERSHELL_EXTENSION_ID = 'ms-vscode.powershell';

/**
 * Resolve a workspace folder path for tests. Falls back to extension root when none open.
 */
export function resolveWorkspaceFolder(extensionRoot: string): string {
  if (vscode.workspace.workspaceFolders?.length) {
    return vscode.workspace.workspaceFolders[0].uri.fsPath;
  }
  vscode.workspace.updateWorkspaceFolders(0, null, {
    uri: vscode.Uri.file(extensionRoot),
    name: 'copilot-debugger-root',
  });
  return extensionRoot;
}

/**
 * Choose a launch configuration name or provide inline JSON fallback when missing.
 * Returns either the named configuration string or a JSON serialized inline config.
 */
export function selectLaunchConfiguration(
  scriptFsPath: string,
  configName: string
): string {
  const launchConfigs =
    vscode.workspace.getConfiguration('launch').get<any[]>('configurations') ||
    [];
  const hasNamed = launchConfigs.some(c => c.name === configName);
  if (hasNamed) {
    return configName;
  }
  return JSON.stringify({
    type: 'PowerShell',
    request: 'launch',
    name: `Inline ${configName}`,
    script: scriptFsPath,
    cwd: path.dirname(scriptFsPath),
    createTemporaryIntegratedConsole: true,
  });
}
