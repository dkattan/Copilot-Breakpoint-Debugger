import type { Variable } from './debugUtils';
import * as vscode from 'vscode';

// Re-export types for convenience
export type { Variable };

// Create an output channel for debugging
export const outputChannel = vscode.window.createOutputChannel('Debug Tools');

/** Debug Adapter Protocol StackFrame interface */
interface DAPStackFrame {
  id: number;
  name: string;
  source?: {
    name?: string;
    path?: string;
  };
  line: number;
  column: number;
}
export interface ThreadData {
  threadId: number;
  threadName: string;
  stackFrames: Array<{
    id: number;
    name: string;
    source?: {
      name: string;
      path: string;
    };
    line: number;
    column: number;
  }>;
}
/** Event emitter for debug session start notifications */
export const sessionStartEventEmitter =
  new vscode.EventEmitter<vscode.DebugSession>();
export const onSessionStart = sessionStartEventEmitter.event;

/** Maintain a list of active debug sessions. */
export const activeSessions: vscode.DebugSession[] = [];

/** Event emitter for debug session termination notifications */
export const sessionTerminateEventEmitter = new vscode.EventEmitter<{
  session: vscode.DebugSession;
}>();
export const onSessionTerminate = sessionTerminateEventEmitter.event;

/** Store breakpoint hit information for notification */
export interface BreakpointHitInfo {
  session: vscode.DebugSession;
  threadId: number;
  reason: string;
  frameId?: number;
  filePath?: string;
  line?: number;
  exceptionInfo?: {
    description: string;
    details: string;
  };
}

/**
 * Get the current call stack information for an active debug session.
 *
 * @param params - Object containing the sessionName to get call stack for.
 * @param params.sessionName - Optional name of the debug session to get call stack for. If not provided, returns call stacks for all active sessions.
 */
export const getCallStack = async (params: {
  sessionName?: string;
}): Promise<{
  sessionId: string;
  sessionName: string;
  threads: Array<ThreadData>;
}> => {
  const { sessionName } = params;

  // Get all active debug sessions or filter by name if provided
  if (activeSessions.length === 0) {
    throw new Error('No active debug sessions found.');
  }
  let sessions = activeSessions;
  if (sessionName) {
    sessions = activeSessions.filter(session => session.name === sessionName);
    if (sessions.length === 0) {
      throw new Error(`No debug session found with name '${sessionName}'.`);
    }
    if (sessions.length > 1) {
      throw new Error(
        `Multiple debug sessions found with name '${sessionName}'. Please specify a unique session name.`
      );
    }
  }
  const session = sessions[0];

  // Get all threads for the session
  const threads = await session.customRequest('threads');

  // Get stack traces for each thread
  const stackTraces = await Promise.all(
    threads.threads.map(async (thread: { id: number; name: string }) => {
      const stackTrace = await session.customRequest('stackTrace', {
        threadId: thread.id,
      });

      return {
        threadId: thread.id,
        threadName: thread.name,
        stackFrames: stackTrace.stackFrames.map((frame: DAPStackFrame) => ({
          id: frame.id,
          name: frame.name,
          source: frame.source
            ? {
                name: frame.source.name,
                path: frame.source.path,
              }
            : undefined,
          line: frame.line,
          column: frame.column,
        })),
      };
    })
  );

  return {
    sessionId: session.id,
    sessionName: session.name,
    threads: stackTraces,
  };
};

// Track new debug sessions as they start.
vscode.debug.onDidStartDebugSession(session => {
  activeSessions.push(session);
  outputChannel.appendLine(
    `Debug session started: ${session.name} (ID: ${session.id})`
  );
  outputChannel.appendLine(`Active sessions: ${activeSessions.length}`);
  sessionStartEventEmitter.fire(session);
});

// Remove debug sessions as they terminate.
vscode.debug.onDidTerminateDebugSession(session => {
  const index = activeSessions.indexOf(session);
  if (index >= 0) {
    activeSessions.splice(index, 1);
    outputChannel.appendLine(
      `Debug session terminated: ${session.name} (ID: ${session.id})`
    );
    outputChannel.appendLine(`Active sessions: ${activeSessions.length}`);
    // Fire termination event for listeners waiting on session end
    sessionTerminateEventEmitter.fire({
      session,
    });
  }
});

vscode.debug.onDidChangeActiveDebugSession(session => {
  outputChannel.appendLine(
    `Active debug session changed: ${session ? session.name : 'None'}`
  );
});
