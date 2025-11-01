import * as vscode from 'vscode';
import {
  activeSessions,
  getCallStack,
  outputChannel,
  BreakpointHitInfo,
} from './common';
import { getStackFrameVariables } from './inspection';
import { DebugSessionOptions } from 'vscode';
import { waitForBreakpointHit } from './events';

/**
 * Helper function to wait for a debug session to stop and gather debug information.
 * This is used by both startDebugSession and resumeDebugSession when waitForStop is true.
 *
 * @param params - Object containing session information and options for waiting.
 * @returns A response object with debug information or error details.
 */
async function resolveBreakpointInfo(
  breakpointInfo: BreakpointHitInfo,
  variableFilter?: string[]
) {
  try {
    // Get detailed call stack information
    const callStackResult = await getCallStack({
      sessionName: breakpointInfo.sessionName,
    });
    let callStackData = null;
    if (!callStackResult.isError && 'json' in callStackResult.content[0]) {
      callStackData = callStackResult.content[0].json;
    }

    // Get variables for the top frame if we have a frameId
    let variablesData = null;
    let variablesError = null;
    if (
      breakpointInfo.frameId !== undefined &&
      breakpointInfo.sessionId &&
      breakpointInfo.threadId !== undefined
    ) {
      outputChannel.appendLine(
        `Attempting to get variables for frameId ${breakpointInfo.frameId}`
      );

      // Find the actual session by name since breakpointInfo.sessionId is the VSCode session ID
      const activeSession = activeSessions.find(
        s => s.name === breakpointInfo.sessionName
      );
      if (!activeSession) {
        variablesError = `Could not find active session with name: ${breakpointInfo.sessionName}`;
        outputChannel.appendLine(variablesError);
      } else {
        try {
          const variablesResult = await getStackFrameVariables({
            sessionId: activeSession.id,
            frameId: breakpointInfo.frameId,
            threadId: breakpointInfo.threadId,
            filter: variableFilter ? variableFilter.join('|') : undefined,
          });

          if (
            !variablesResult.isError &&
            'json' in variablesResult.content[0]
          ) {
            variablesData = variablesResult.content[0].json;
            outputChannel.appendLine(
              `Successfully retrieved variables: ${JSON.stringify(variablesData)}`
            );
          } else {
            // Capture the error message if there was one
            variablesError = variablesResult.isError
              ? 'text' in variablesResult.content[0]
                ? variablesResult.content[0].text
                : 'Unknown error'
              : 'Invalid response format';
            outputChannel.appendLine(
              `Failed to get variables: ${variablesError}`
            );
          }
        } catch (error) {
          variablesError =
            error instanceof Error ? error.message : String(error);
          outputChannel.appendLine(
            `Exception getting variables: ${variablesError}`
          );
        }
      }
    } else {
      variablesError = 'Missing required information for variable inspection';
      outputChannel.appendLine(
        `Cannot get variables: ${variablesError} - frameId: ${breakpointInfo.frameId}, sessionId: ${breakpointInfo.sessionId}, threadId: ${breakpointInfo.threadId}`
      );
    }

    // Construct a comprehensive response with all the debug information
    const debugInfo = {
      breakpoint: breakpointInfo,
      callStack: callStackData,
      variables: variablesData,
      variablesError: variablesError,
    };

    return {
      content: [
        {
          type: 'text',
          text: `Debug session ${breakpointInfo.sessionName} stopped at ${
            breakpointInfo.reason === 'breakpoint'
              ? 'a breakpoint'
              : `due to ${breakpointInfo.reason}`
          }.`,
        },
        {
          type: 'text',
          text: JSON.stringify(debugInfo),
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Debug session ${breakpointInfo.sessionName} stopped successfully.`,
        },
        {
          type: 'text',
          text: `Warning: Failed to wait for debug session to stop: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      isError: false,
    };
  }
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
 */
export const startDebuggingAndWaitForStop = async (params: {
  workspaceFolder: string;
  nameOrConfiguration:
    | string
    | { type: string; request: string; name: string; [key: string]: any };
  variableFilter?: string[];
  timeout_seconds?: number;
  breakpointConfig?: {
    disableExisting?: boolean;
    breakpoints?: Array<{ path: string; line: number }>;
  };
}) => {
  const {
    workspaceFolder,
    nameOrConfiguration,
    variableFilter,
    timeout_seconds = 60,
    breakpointConfig,
  } = params;
  // Ensure that workspace folders exist and are accessible.
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('No workspace folders are currently open.');
  }

  const folder = workspaceFolders.find(f => f.uri?.fsPath === workspaceFolder);
  if (!folder) {
    throw new Error(`Workspace folder '${workspaceFolder}' not found.`);
  }

  // Generate session name and ID based on the type of nameOrConfiguration
  const sessionName =
    typeof nameOrConfiguration === 'string'
      ? nameOrConfiguration
      : nameOrConfiguration.name;
  const sessionId =
    typeof nameOrConfiguration === 'object' && nameOrConfiguration.sessionId
      ? nameOrConfiguration.sessionId
      : `debug_${sessionName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

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
      const newBreakpoints = breakpointConfig.breakpoints.map(bp => {
        const uri = vscode.Uri.file(
          bp.path.startsWith('/') ? bp.path : `${workspaceFolder}/${bp.path}`
        );
        const location = new vscode.Position(bp.line - 1, 0); // VSCode uses 0-based line numbers
        return new vscode.SourceBreakpoint(new vscode.Location(uri, location));
      });
      vscode.debug.addBreakpoints(newBreakpoints);
    }
  }

  // Set up the listener before starting the session to avoid race condition
  outputChannel.appendLine(
    `Preparing breakpoint wait: sessionName='${sessionName}', synthetic sessionId='${sessionId}'`
  );
  const stopPromise = waitForBreakpointHit({
    sessionName,
    timeout: timeout_seconds * 1000, // Convert seconds to milliseconds
  });

  const success = await vscode.debug.startDebugging(
    folder,
    nameOrConfiguration,
    {
      id: sessionId,
    } as DebugSessionOptions
  );

  if (!success) {
    throw new Error(`Failed to start debug session '${sessionName}'.`);
  }

  outputChannel.appendLine(
    `Active sessions after start: ${activeSessions
      .map(s => `${s.name}:${s.id}`)
      .join(', ')}`
  );

  // Always wait for the debug session to stop at a breakpoint with timeout
  let breakpointHitResult;
  try {
    breakpointHitResult = await stopPromise;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Timeout')) {
      return {
        content: [
          {
            type: 'text',
            text: `Debug session '${sessionName}' timed out after ${timeout_seconds} seconds waiting for a breakpoint to be hit.`,
          },
        ],
        isError: true,
      };
    }
    throw error;
  }

  // If we got a successful breakpoint hit, resolve it to get full debug information
  if (
    !breakpointHitResult.isError &&
    breakpointHitResult.content[0].type === 'text'
  ) {
    try {
      const breakpointInfo = JSON.parse(
        breakpointHitResult.content[0].text
      ) as BreakpointHitInfo;
      // Get the full debug information including call stack and variables
      return await resolveBreakpointInfo(breakpointInfo, variableFilter);
    } catch (error) {
      // If parsing fails, return the original result
      return breakpointHitResult;
    }
  }

  return breakpointHitResult;
};

/**
 * Stop debug sessions that match the provided session name.
 *
 * @param params - Object containing the sessionName to stop.
 */
export const stopDebugSession = async (params: { sessionName: string }) => {
  const { sessionName } = params;
  // Filter active sessions to find matching sessions.
  const matchingSessions = activeSessions.filter(
    (session: vscode.DebugSession) => session.name === sessionName
  );

  if (matchingSessions.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No debug session(s) found with name '${sessionName}'.`,
        },
      ],
      isError: true,
    };
  }

  // Stop each matching debug session.
  for (const session of matchingSessions) {
    await vscode.debug.stopDebugging(session);
  }

  return {
    content: [
      {
        type: 'text',
        text: `Stopped debug session(s) with name '${sessionName}'.`,
      },
    ],
    isError: false,
  };
};
/**
 * Resume execution of a debug session that has been paused (e.g., by a breakpoint).
 *
 * @param params - Object containing the sessionId of the debug session to resume and optional waitForStop flag.
 */
export const resumeDebugSession = async (params: {
  sessionId: string;
  waitForStop?: boolean;
  breakpointConfig?: {
    disableExisting?: boolean;
    breakpoints?: Array<{ path: string; line: number }>;
  };
}) => {
  const { sessionId, waitForStop = false, breakpointConfig } = params;

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

  try {
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
          const uri = vscode.Uri.file(
            bp.path.startsWith('/') ? bp.path : `${workspaceFolder}/${bp.path}`
          );
          const location = new vscode.Position(bp.line - 1, 0); // VSCode uses 0-based line numbers
          return new vscode.SourceBreakpoint(
            new vscode.Location(uri, location)
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
      sessionId,
      includeTermination: true,
    });
    await session.customRequest('continue', { threadId: 0 }); // 0 means all threads
    if (waitForStop) {
      const stopResult = await stopPromise;
      if (!stopResult.isError && stopResult.content[0].type === 'text') {
        try {
          const info = JSON.parse(
            stopResult.content[0].text
          ) as BreakpointHitInfo;
          // If session terminated without hitting breakpoint, return termination info
          if (info.reason === 'terminated') {
            return {
              content: [
                {
                  type: 'text',
                  text: `Debug session '${session.name}' terminated before hitting another breakpoint.`,
                },
                { type: 'text', text: JSON.stringify(info) },
              ],
              isError: false,
            };
          }
          // Otherwise resolve full breakpoint info
          return await resolveBreakpointInfo(info);
        } catch (e) {
          // Fallback if parsing fails
          return stopResult;
        }
      }
      // In case of error just return it
      return stopResult;
    }

    // If not waiting for stop, return immediately
    return {
      content: [
        {
          type: 'text',
          text: `Resumed debug session '${session.name}'.`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error resuming debug session: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
};
