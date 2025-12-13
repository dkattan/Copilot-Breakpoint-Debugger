import type { StartDebuggerInvocationOptions } from '../../testTypes';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { activeSessions } from '../../common';
import { StartDebuggerTool } from '../../startDebuggerTool';

/** Resolve extension root path. */
export function getExtensionRoot(): string {
  return (
    vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
      ?.extensionPath || path.resolve(__dirname, '../../..')
  );
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
  const workspaceFolder = opts.workspaceFolder?.trim()
    ? path.isAbsolute(opts.workspaceFolder)
      ? opts.workspaceFolder
      : path.join(extensionRoot, opts.workspaceFolder)
    : vscode.workspace.workspaceFolders[0].uri.fsPath;

  await openScriptDocument(scriptUri);

  await activateCopilotDebugger();

  const tool = new StartDebuggerTool();
  const breakpointLines = opts.breakpointLines?.length
    ? opts.breakpointLines
    : [1];
  const breakpoints = breakpointLines.map((line: number) => ({
    path: scriptUri.fsPath,
    line,
    action: 'break' as const,
    variableFilter: opts.variableFilter ?? ['PWD', 'HOME'],
  }));

  const result = await tool.invoke({
    input: {
      workspaceFolder,
      configurationName: opts.configurationName,
      breakpointConfig: { breakpoints },
    },
    toolInvocationToken: undefined,
  });

  // Diagnostic logging of first output part (best-effort)
  try {
    if (result.content && result.content.length) {
      const firstPart: unknown = result.content[0];
      let rawValue: string;
      // Use indexed access via casting to loose object type
      const loose = firstPart as { [k: string]: unknown };
      if (typeof loose.value === 'string') {
        rawValue = loose.value;
      } else if (typeof loose.text === 'string') {
        rawValue = loose.text;
      } else {
        rawValue = JSON.stringify(firstPart);
      }

      console.log('[invokeStartDebuggerTool] raw output:', rawValue);
    }
  } catch {
    /* ignore */
  }

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

/** Stop any debug sessions left running after a test. */
export async function stopAllDebugSessions(): Promise<void> {
  const sessions = [...activeSessions];
  for (const session of sessions) {
    try {
      await vscode.debug.stopDebugging(session);
    } catch (error) {
      console.warn(
        `Failed to stop debug session ${session.name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
