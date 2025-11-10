import * as vscode from 'vscode';

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
