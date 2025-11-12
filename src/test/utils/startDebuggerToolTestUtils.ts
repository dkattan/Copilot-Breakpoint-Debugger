import * as path from 'node:path';
import * as vscode from 'vscode';
import { StartDebuggerTool } from '../../startDebuggerTool';
import { POWERSHELL_EXTENSION_ID } from './debugTestUtils';

export interface StartDebuggerInvocationOptions {
  scriptRelativePath: string; // Path relative to extension root (e.g., 'test-workspace/test.ps1')
  timeoutSeconds?: number;
  variableFilter?: string[];
  breakpointLines?: number[]; // Breakpoints on first script path
  configurationName?: string; // Launch configuration name to use
}

/** Resolve extension root path. */
export function getExtensionRoot(): string {
  return (
    vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
      ?.extensionPath || path.resolve(__dirname, '../../..')
  );
}

/** Check if PowerShell extension is available and activate it; returns false if missing so test can skip. */
export async function ensurePowerShellExtension(): Promise<boolean> {
  const pwshExtension = vscode.extensions.getExtension(POWERSHELL_EXTENSION_ID);
  if (!pwshExtension) {
    return false;
  }
  if (!pwshExtension.isActive) {
    await pwshExtension.activate();
  }
  return true;
}

/** Ensure PowerShell extension is available and activated; throws if missing. */
export async function assertPowerShellExtension(): Promise<void> {
  const pwshExtension = vscode.extensions.getExtension(POWERSHELL_EXTENSION_ID);
  if (!pwshExtension) {
    throw new Error(`${POWERSHELL_EXTENSION_ID} is not installed`);
  }
  if (!pwshExtension.isActive) {
    await pwshExtension.activate();
  }
}

/** Activate our extension under test. */
export async function activateCopilotDebugger(): Promise<void> {
  await vscode.extensions
    .getExtension('dkattan.copilot-breakpoint-debugger')
    ?.activate();
}

/** Open a script document and show it. */
export async function openScriptDocument(scriptUri: vscode.Uri): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(scriptUri);
  await vscode.window.showTextDocument(doc);
}

/** Invoke StartDebuggerTool with supplied options and return aggregated output parts. */
export async function invokeStartDebuggerTool(
  opts: StartDebuggerInvocationOptions
) {
  const extensionRoot = getExtensionRoot();
  const scriptUri = vscode.Uri.file(
    path.join(extensionRoot, opts.scriptRelativePath)
  );

  // Get the first workspace folder from VS Code - should be set from test-workspace.code-workspace
  if (!vscode.workspace.workspaceFolders?.length) {
    throw new Error(
      'No workspace folders found. Ensure test-workspace.code-workspace is loaded.'
    );
  }
  const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;

  await openScriptDocument(scriptUri);

  // Only check for PowerShell extension if using PowerShell scripts
  if (opts.scriptRelativePath.endsWith('.ps1')) {
    const hasPowerShell = await ensurePowerShellExtension();
    if (!hasPowerShell) {
      throw new Error('pwsh-missing');
    }
  }

  await activateCopilotDebugger();

  const tool = new StartDebuggerTool();
  const breakpointLines = opts.breakpointLines?.length
    ? opts.breakpointLines
    : [1];
  const breakpoints = breakpointLines.map(line => ({
    path: scriptUri.fsPath,
    line,
  }));

  const result = await tool.invoke({
    input: {
      workspaceFolder,
      timeoutSeconds: opts.timeoutSeconds ?? 60,
      variableFilter: opts.variableFilter ?? ['PWD', 'HOME'],
      configurationName: opts.configurationName,
      breakpointConfig: { breakpoints },
    },
    toolInvocationToken: undefined,
  });

  return result;
}

/** Common assertions verifying the debug session started and breakpoint info captured. */
export function assertStartDebuggerOutput(textOutput: string): void {
  const timedOut = /timed out/i.test(textOutput);
  const startError = /Error starting debug session/i.test(textOutput);
  if (timedOut) {
    throw new Error('Debug session timed out waiting for breakpoint');
  }
  if (startError) {
    throw new Error('Encountered error starting debug session');
  }
  if (!/Debug session .* stopped|breakpoint/i.test(textOutput)) {
    throw new Error('Missing stopped-session or breakpoint descriptor');
  }
  if (!/\\?"breakpoint\\?"|breakpoint\s*:/i.test(textOutput)) {
    throw new Error('Missing breakpoint JSON info');
  }
  if (
    !(
      /"line"\s*:\s*\d+/.test(textOutput) ||
      /test\.ps1|test\.js/i.test(textOutput)
    )
  ) {
    throw new Error('Missing line number or script reference in debug info');
  }
}
