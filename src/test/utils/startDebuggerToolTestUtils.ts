import type { StartDebuggerInvocationOptions } from "../../testTypes";
import * as path from "node:path";
import * as vscode from "vscode";
import { activeSessions } from "../../common";
import { StartDebuggerTool } from "../../startDebuggerTool";

/** Resolve extension root path. */
export function getExtensionRoot(): string {
  return (
    vscode.extensions.getExtension("dkattan.copilot-breakpoint-debugger")
      ?.extensionPath || path.resolve(__dirname, "../../..")
  );
}

/** Activate our extension under test. */
export async function activateCopilotDebugger(): Promise<void> {
  await vscode.extensions
    .getExtension("dkattan.copilot-breakpoint-debugger")
    ?.activate();
}

/** Open a script document and show it. */
export async function openScriptDocument(scriptUri: vscode.Uri): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(scriptUri);
  await vscode.window.showTextDocument(doc);
}

/** Invoke StartDebuggerTool with supplied options and return aggregated output parts. */
export async function invokeStartDebuggerTool(
  opts: StartDebuggerInvocationOptions,
) {
  const extensionRoot = getExtensionRoot();
  const scriptUri = vscode.Uri.file(
    path.join(extensionRoot, opts.scriptRelativePath),
  );

  // Get the first workspace folder from VS Code - should be set from test-workspace.code-workspace
  if (!vscode.workspace.workspaceFolders?.length) {
    throw new Error(
      "No workspace folders found. Ensure test-workspace.code-workspace is loaded.",
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
  const breakpointSnippets = opts.breakpointSnippets?.length
    ? opts.breakpointSnippets
    : ["console.log("];
  const breakpoints = breakpointSnippets.map((code: string) => ({
    path: scriptUri.fsPath,
    code,
    onHit: "break" as const,
    variable: opts.variable ?? "PWD",
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
      if (typeof loose.value === "string") {
        rawValue = loose.value;
      }
      else if (typeof loose.text === "string") {
        rawValue = loose.text;
      }
      else {
        rawValue = JSON.stringify(firstPart);
      }

      console.log("[invokeStartDebuggerTool] raw output:", rawValue);
    }
  }
  catch {
    /* ignore */
  }

  return result;
}

/** Stop any debug sessions left running after a test. */
export async function stopAllDebugSessions(): Promise<void> {
  // Best-effort: stop all sessions first (covers sessions not tracked in activeSessions).
  try {
    await vscode.debug.stopDebugging();
  }
  catch (error) {
    console.warn(
      `Failed to stop all debug sessions: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Give VS Code + debug adapter time to fully terminate sessions.
  // This reduces teardown races that can crash the extension host in CI.
  const timeoutMs = 10_000;
  const start = Date.now();
  while (
    (activeSessions.length > 0 || vscode.debug.activeDebugSession)
    && Date.now() - start < timeoutMs
  ) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // If sessions remain, attempt a second, targeted stop on the remaining sessions.
  const remaining = [...activeSessions];
  for (const session of remaining) {
    try {
      await vscode.debug.stopDebugging(session);
    }
    catch (error) {
      console.warn(
        `Failed to stop debug session ${session.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
