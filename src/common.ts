import { useEvent, useEventEmitter, useOutputChannel } from "reactive-vscode";
import * as vscode from "vscode";
import type { Variable } from "./debugUtils";

// Re-export types for convenience
export type { Variable };

// Create an output channel for debugging
export const outputChannel = useOutputChannel("Debug Tools");

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
export const sessionStartEventEmitter = useEventEmitter<vscode.DebugSession>();
export const onSessionStart = sessionStartEventEmitter.event;

/** Maintain a list of active debug sessions. */
export const activeSessions: vscode.DebugSession[] = [];

/** Event emitter for debug session termination notifications */
export const sessionTerminateEventEmitter = useEventEmitter<{
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

// Track new debug sessions as they start.
const addStartListener = useEvent(vscode.debug.onDidStartDebugSession);
addStartListener((session) => {
  activeSessions.push(session);
  outputChannel.appendLine(
    `Debug session started: ${session.name} (ID: ${session.id})`
  );
  outputChannel.appendLine(`Active sessions: ${activeSessions.length}`);
  sessionStartEventEmitter.fire(session);
});

// Remove debug sessions as they terminate.
const addTerminateListener = useEvent(vscode.debug.onDidTerminateDebugSession);
addTerminateListener((session) => {
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

const addChangeListener = useEvent(vscode.debug.onDidChangeActiveDebugSession);
addChangeListener((session) => {
  outputChannel.appendLine(
    `Active debug session changed: ${session ? session.name : "None"}`
  );
});
