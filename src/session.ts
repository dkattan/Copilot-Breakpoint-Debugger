import type { BreakpointHitInfo } from './common';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { activeSessions, outputChannel } from './common';
import { DAPHelpers, type Variable } from './debugUtils';
import { waitForBreakpointHit } from './events';

const normalizeFsPath = (value: string) =>
  path.normalize(value).replace(/\\/g, '/').replace(/\/+$/, '');

/**
 * Variables grouped by scope
 */
export interface ScopeVariables {
  scopeName: string;
  variables: Variable[];
  error?: string;
}

/**
 * Call stack information for a debug session
 */
export interface CallStackInfo {
  callStacks: Array<{
    sessionId: string;
    sessionName: string;
    threads?: Array<{
      threadId: number;
      threadName: string;
      stackFrames?: Array<{
        id: number;
        name: string;
        source?: {
          name?: string;
          path?: string;
        };
        line: number;
        column: number;
      }>;
      error?: string;
    }>;
    error?: string;
  }>;
}

/**
 * Structured debug information returned when a breakpoint is hit
 */
export interface DebugInfo {
  breakpoint: BreakpointHitInfo;
  callStack: CallStackInfo | null;
  variables: ScopeVariables[] | null;
  variablesError: string | null;
}

/**
 * Result from starting a debug session
 */
export interface StartDebugSessionResult {
  content: Array<{
    type: 'text' | 'json';
    text?: string;
    json?: DebugInfo;
  }>;
  isError: boolean;
}

/**
 * List all active debug sessions in the workspace.
 *
 * Exposes debug session information, including each session's ID, name, and associated launch configuration.
 */
export const listDebugSessions = () => {
  // Retrieve all active debug sessions using the activeSessions array.
  const sessions = activeSessions.map((session: vscode.DebugSession) => ({
    id: session.id,
    name: session.name,
    configuration: session.configuration,
  }));

  // Return session list
  return {
    content: [
      {
        type: 'json',
        json: { sessions },
      },
    ],
    isError: false,
  };
};

/**
 * Start a new debug session using either a named configuration from .vscode/launch.json or a direct configuration object,
 * then wait until a breakpoint is hit before returning with detailed debug information.
 *
 * @param params - Object containing workspaceFolder, nameOrConfiguration, and optional variableFilter.
 * @param params.sessionName - Name to assign to the debug session.
 * @param params.workspaceFolder - Absolute path to the workspace folder where the debug session will run.
 * @param params.nameOrConfiguration - Either a string name of a launch configuration or a DebugConfiguration object.
 * @param params.variableFilter - Optional array of variable name patterns to filter which variables are returned.
 * @param params.timeoutSeconds - Optional timeout in seconds to wait for a breakpoint hit (default: 60).
 * @param params.breakpointConfig - Optional configuration for managing breakpoints during the debug session.
 * @param params.breakpointConfig.disableExisting - If true, removes all existing breakpoints before starting the session.
 * @param params.breakpointConfig.breakpoints - Array of breakpoint configurations to set before starting the session.
 */
export const startDebuggingAndWaitForStop = async (params: {
  sessionName: string;
  workspaceFolder: string;
  nameOrConfiguration: string;
  variableFilter?: string[];
  timeoutSeconds?: number;
  breakpointConfig: {
    disableExisting?: boolean;
    breakpoints: Array<{
      path: string;
      line: number;
      condition?: string;
      hitCondition?: string;
      logMessage?: string;
    }>;
  };
}) => {
  const {
    sessionName,
    workspaceFolder,
    nameOrConfiguration,
    timeoutSeconds = 60,
    breakpointConfig,
  } = params;
  const extensionRoot = vscode.extensions.getExtension(
    'dkattan.copilot-breakpoint-debugger'
  )?.extensionPath;
  const resolvedWorkspaceFolder = path.isAbsolute(workspaceFolder)
    ? workspaceFolder
    : extensionRoot
      ? path.resolve(extensionRoot, workspaceFolder)
      : path.resolve(workspaceFolder);
  const normalizedRequestedFolder = normalizeFsPath(resolvedWorkspaceFolder);
  // Ensure that workspace folders exist and are accessible.
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('No workspace folders are currently open.');
  }

  outputChannel.appendLine(
    `Available workspace folders: ${workspaceFolders.map(f => `${f.name} -> ${f.uri.fsPath}`).join(', ')}`
  );
  outputChannel.appendLine(
    `Looking for workspace folder (resolved): ${resolvedWorkspaceFolder}`
  );

  const normalizedFolders = workspaceFolders.map(f => ({
    folder: f,
    normalized: normalizeFsPath(f.uri.fsPath),
  }));
  // Try exact match first (supporting relative -> absolute resolution)
  let folderEntry = normalizedFolders.find(
    f => f.normalized === normalizedRequestedFolder
  );

  // If no exact match, we might have been given a parent folder (repo root) while only a child (e.g. test-workspace) is opened,
  // OR we might have been given a child while only the parent is opened. Support both directions.
  if (!folderEntry) {
    // Case 1: Requested path is parent of an opened workspace folder
    const childOfRequested = normalizedFolders.find(f =>
      f.normalized.startsWith(`${normalizedRequestedFolder}/`)
    );
    if (childOfRequested) {
      folderEntry = childOfRequested;
      outputChannel.appendLine(
        `Requested parent folder '${resolvedWorkspaceFolder}' not open; using child workspace folder '${folderEntry.folder.uri.fsPath}'.`
      );
    }
  }
  if (!folderEntry) {
    // Case 2: Requested path is a subfolder of an opened workspace folder
    const parentOfRequested = normalizedFolders.find(f =>
      normalizedRequestedFolder.startsWith(`${f.normalized}/`)
    );
    if (parentOfRequested) {
      folderEntry = parentOfRequested;
      outputChannel.appendLine(
        `Requested subfolder '${resolvedWorkspaceFolder}' not open; using parent workspace folder '${folderEntry.folder.uri.fsPath}'.`
      );
    }
  }

  const folder = folderEntry?.folder;
  if (!folder) {
    throw new Error(
      `Workspace folder '${workspaceFolder}' not found. Available folders: ${workspaceFolders.map(f => f.uri.fsPath).join(', ')}`
    );
  }
  const folderFsPath = folder.uri.fsPath;
  // Automatic backup & isolation of existing breakpoints (no extra params required)
  const originalBreakpoints = [...vscode.debug.breakpoints];
  if (originalBreakpoints.length) {
    outputChannel.appendLine(
      `Backing up and removing ${originalBreakpoints.length} existing breakpoint(s) for isolated debug session.`
    );
    vscode.debug.removeBreakpoints(originalBreakpoints);
  }

  const seen = new Set<string>();
  const validated: vscode.SourceBreakpoint[] = [];
  for (const bp of breakpointConfig.breakpoints) {
    const absolutePath = path.isAbsolute(bp.path)
      ? bp.path
      : path.join(folderFsPath, bp.path);
    try {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(absolutePath)
      );
      const lineCount = doc.lineCount;
      if (bp.line < 1 || bp.line > lineCount) {
        outputChannel.appendLine(
          `Skipping breakpoint ${absolutePath}:${bp.line} (out of range, file has ${lineCount} lines).`
        );
        continue;
      }
      const key = `${absolutePath}:${bp.line}`;
      if (seen.has(key)) {
        outputChannel.appendLine(`Skipping duplicate breakpoint ${key}.`);
        continue;
      }
      seen.add(key);
      const uri = vscode.Uri.file(absolutePath);
      const location = new vscode.Position(bp.line - 1, 0);
      validated.push(
        new vscode.SourceBreakpoint(
          new vscode.Location(uri, location),
          true,
          bp.condition,
          bp.hitCondition,
          bp.logMessage
        )
      );
    } catch (e) {
      outputChannel.appendLine(
        `Failed to open file for breakpoint path ${absolutePath}: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  }
  if (validated.length) {
    vscode.debug.addBreakpoints(validated);
    outputChannel.appendLine(
      `Added ${validated.length} validated breakpoint(s).`
    );
    await new Promise(resolve => setTimeout(resolve, 500));
  } else {
    outputChannel.appendLine('No valid breakpoints to add after validation.');
  }

  // Resolve launch configuration: always inject stopOnEntry=true to ensure early pause, but never synthesize a generic config.
  const launchConfig = vscode.workspace.getConfiguration('launch', folder.uri);
  const allConfigs =
    (launchConfig.get<unknown>(
      'configurations'
    ) as vscode.DebugConfiguration[]) || [];
  const found = allConfigs.find(c => c.name === nameOrConfiguration);
  if (!found) {
    throw new Error(
      `Launch configuration '${nameOrConfiguration}' not found in ${folder.uri.fsPath}. Add it to .vscode/launch.json.`
    );
  }
  const resolvedConfig = { ...found };
  // Inject stopOnEntry if not already present (harmless if adapter ignores it)
  if (!('stopOnEntry' in resolvedConfig)) {
    (resolvedConfig as Record<string, unknown>).stopOnEntry = true;
  } else {
    (resolvedConfig as Record<string, unknown>).stopOnEntry = true; // force true
  }

  const effectiveSessionName = sessionName || resolvedConfig.name || '';
  outputChannel.appendLine(
    `Starting debugger with configuration '${resolvedConfig.name}' (stopOnEntry forced to true). Waiting for first stop event.`
  );
  // Set up listener BEFORE starting to avoid race with fast 'entry' events.
  const stopPromise = waitForBreakpointHit({
    sessionName: effectiveSessionName,
    timeout: timeoutSeconds * 1000,
  });
  const success = await vscode.debug.startDebugging(folder, resolvedConfig);
  if (!success) {
    throw new Error(`Failed to start debug session '${effectiveSessionName}'.`);
  }
  let remainingMs = timeoutSeconds * 1000;
  const t0 = Date.now();

  let stopInfo: BreakpointHitInfo | undefined;
  let debugContext:
    | Awaited<ReturnType<typeof DAPHelpers.getDebugContext>>
    | undefined;
  try {
    stopInfo = await stopPromise;

    const elapsed = Date.now() - t0;
    remainingMs = Math.max(0, remainingMs - elapsed);
    // Entry stop handling: only auto-continue if entry location is NOT a user breakpoint line.
    try {
      const isEntry = stopInfo.reason === 'entry';
      // Convert to 0-based line number for comparison with VSCode positions
      const entryLineZeroBased =
        stopInfo.line !== undefined ? stopInfo.line - 1 : -1;
      validated.some(bp => bp.location.range.start.line === entryLineZeroBased);
      if (isEntry) {
        outputChannel.appendLine(
          'Entry stop at non-breakpoint location; continuing to reach first user breakpoint.'
        );

        try {
          await stopInfo.session.customRequest('continue', {
            threadId: stopInfo.threadId,
          });
          stopInfo = await waitForBreakpointHit({
            sessionName: effectiveSessionName,
            timeout: remainingMs,
          });
        } catch (contErr) {
          outputChannel.appendLine(
            `Failed to continue after entry: ${contErr instanceof Error ? contErr.message : String(contErr)}`
          );
        }
      }
    } catch (parseErr) {
      outputChannel.appendLine(
        `Failed to parse first stop JSON for entry evaluation: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
      );
    }

    if (!success) {
      throw new Error(`Failed to start debug session '${sessionName}'.`);
    }

    outputChannel.appendLine(
      `Active sessions after start: ${activeSessions
        .map(s => `${s.name}:${s.id}`)
        .join(', ')}`
    );

    // If the session terminated without hitting a breakpoint, return termination stopInfo
    if (stopInfo.reason === 'terminated') {
      throw new Error(
        `Debug session '${effectiveSessionName}' terminated before hitting a breakpoint.`
      );
    }
    debugContext = await DAPHelpers.getDebugContext(
      stopInfo.session,
      stopInfo.threadId
    );
    return debugContext;
  } finally {
    // Restore original breakpoints, removing any added ones first
    const current = vscode.debug.breakpoints;
    if (current.length) {
      vscode.debug.removeBreakpoints(current);
      outputChannel.appendLine(
        `Removed ${current.length} session breakpoint(s) before restoring originals.`
      );
    }
    if (originalBreakpoints.length) {
      vscode.debug.addBreakpoints(originalBreakpoints);
      outputChannel.appendLine(
        `Restored ${originalBreakpoints.length} original breakpoint(s).`
      );
    } else {
      outputChannel.appendLine('No original breakpoints to restore.');
    }
  }
};

/**
 * Stop debug sessions that match the provided session name.
 *
 * @param params - Object containing the sessionName to stop.
 * @param params.sessionName - Name of the debug session(s) to stop.
 */
export const stopDebugSession = async (params: { sessionName: string }) => {
  const { sessionName } = params;
  // Filter active sessions to find matching sessions.
  const matchingSessions = activeSessions.filter(
    (session: vscode.DebugSession) => session.name === sessionName
  );

  if (matchingSessions.length === 0) {
    throw new Error(`No debug session(s) found with name '${sessionName}'.`);
  }

  // Stop each matching debug session.
  for (const session of matchingSessions) {
    await vscode.debug.stopDebugging(session);
  }
};
/**
 * Resume execution of a debug session that has been paused (e.g., by a breakpoint).
 *
 * @param params - Object containing the sessionId of the debug session to resume and optional waitForStop flag.
 * @param params.sessionId - ID of the debug session to resume.
 * @param params.breakpointConfig - Optional configuration for managing breakpoints when resuming.
 * @param params.breakpointConfig.disableExisting - If true, removes all existing breakpoints before resuming.
 * @param params.breakpointConfig.breakpoints - Array of breakpoint configurations to set before resuming.
 */
export const resumeDebugSession = async (params: {
  sessionId: string;
  breakpointConfig?: {
    disableExisting?: boolean;
    breakpoints?: Array<{
      path: string;
      line: number;
      condition?: string;
      hitCondition?: string;
      logMessage?: string;
    }>;
  };
}) => {
  const { sessionId, breakpointConfig } = params;

  // Find the session with the given ID
  let session = activeSessions.find(s => s.id === sessionId);

  // If not found by ID, try to find by name pattern (VSCode creates child sessions with modified names)
  if (!session) {
    // Look for a session whose name contains the session ID
    session = activeSessions.find(s => s.name.includes(sessionId));
  }

  if (!session) {
    return {
      content: [
        {
          type: 'text',
          text: `No debug session found with ID '${sessionId}'.`,
        },
      ],
      isError: true,
    };
  }

  // Handle breakpoint configuration if provided
  if (breakpointConfig) {
    // Disable existing breakpoints if requested
    if (breakpointConfig.disableExisting) {
      const allBreakpoints = vscode.debug.breakpoints;
      if (allBreakpoints.length > 0) {
        vscode.debug.removeBreakpoints(allBreakpoints);
      }
    }

    // Add new breakpoints if provided
    if (
      breakpointConfig.breakpoints &&
      breakpointConfig.breakpoints.length > 0
    ) {
      // Get workspace folder from session configuration
      const workspaceFolder =
        session.workspaceFolder?.uri.fsPath ||
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) {
        throw new Error(
          'Cannot determine workspace folder for breakpoint paths'
        );
      }

      const newBreakpoints = breakpointConfig.breakpoints.map(bp => {
        const absolutePath = path.isAbsolute(bp.path)
          ? bp.path
          : path.join(workspaceFolder, bp.path);
        const uri = vscode.Uri.file(absolutePath);
        const location = new vscode.Position(bp.line - 1, 0); // VSCode uses 0-based line numbers
        return new vscode.SourceBreakpoint(
          new vscode.Location(uri, location),
          true, // enabled
          bp.condition,
          bp.hitCondition,
          bp.logMessage
        );
      });
      vscode.debug.addBreakpoints(newBreakpoints);
    }
  }

  // Send the continue request to the debug adapter
  outputChannel.appendLine(
    `Resuming debug session '${session.name}' (ID: ${sessionId})`
  );
  const stopPromise = waitForBreakpointHit({
    sessionName: session.name,
  });
  await session.customRequest('continue', { threadId: 0 }); // 0 means all threads
  const stopInfo = await stopPromise;
  // If session terminated without hitting breakpoint, return termination stopInfo
  if (stopInfo.reason === 'terminated') {
    throw new Error(
      `Debug session '${session.name}' terminated before hitting a breakpoint.`
    );
  }
  // Otherwise resolve full breakpoint stopInfo
  return await DAPHelpers.getDebugContext(stopInfo.session, stopInfo.threadId);
};
