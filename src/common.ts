import type { Variable } from "./debugUtils";
import { useEvent, useEventEmitter, useOutputChannel } from "reactive-vscode";
import * as vscode from "vscode";

// Re-export types for convenience
export type { Variable };

// Create an output channel for debugging
export const outputChannel = useOutputChannel("Debug Tools");
/** Event emitter for debug session start notifications */
export const sessionStartEventEmitter = useEventEmitter<vscode.DebugSession>();

/** Maintain a list of active debug sessions. */
export const activeSessions: vscode.DebugSession[] = [];

export type DebugSessionRunStateStatus = "paused" | "running" | "terminated";

export interface DebugSessionRunState {
  status: DebugSessionRunStateStatus
  lastChanged: number
}

/** Best-effort per-session run state derived from DAP events. */
export const sessionRunStateBySessionId = new Map<string, DebugSessionRunState>();

/** Child session id -> parent session id mapping (best-effort; derived from DAP launch args when available). */
export const sessionParentIdBySessionId = new Map<string, string>();

export function setSessionRunState(sessionId: string, status: DebugSessionRunStateStatus) {
  if (!sessionId || !sessionId.trim()) {
    return;
  }
  sessionRunStateBySessionId.set(sessionId, { status, lastChanged: Date.now() });
}

export function setSessionParentId(childSessionId: string, parentSessionId: string) {
  if (!childSessionId || !childSessionId.trim()) {
    return;
  }
  if (!parentSessionId || !parentSessionId.trim()) {
    return;
  }
  sessionParentIdBySessionId.set(childSessionId, parentSessionId);
}

/** Event emitter for debug session termination notifications */
export const sessionTerminateEventEmitter = useEventEmitter<{
  session: vscode.DebugSession
}>();
export const onSessionTerminate = sessionTerminateEventEmitter.event;

/** Store breakpoint hit information for notification */
export interface BreakpointHitInfo {
  session: vscode.DebugSession
  threadId: number
  reason: string
  frameId?: number
  filePath?: string
  line?: number
  exceptionInfo?: {
    description: string
    details: string
  }
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
  setSessionRunState(session.id, "running");
  outputChannel.appendLine(
    `Debug session started: ${session.name} (ID: ${session.id})`,
  );
  outputChannel.appendLine(`Active sessions: ${activeSessions.length}`);
  sessionStartEventEmitter.fire(session);
});

// Remove debug sessions as they terminate.
const addTerminateListener = useEvent(vscode.debug.onDidTerminateDebugSession);
addTerminateListener((session) => {
  // VS Code may provide a different object instance representing the same
  // session when it terminates. Match by id rather than reference equality.
  const index = activeSessions.findIndex(s => s.id === session.id);
  if (index >= 0) {
    activeSessions.splice(index, 1);
  }

  outputChannel.appendLine(
    `Debug session terminated: ${session.name} (ID: ${session.id})`,
  );
  outputChannel.appendLine(`Active sessions: ${activeSessions.length}`);

  setSessionRunState(session.id, "terminated");
  sessionParentIdBySessionId.delete(session.id);

  // Fire termination event for listeners waiting on session end.
  sessionTerminateEventEmitter.fire({
    session,
  });
});

const addChangeListener = useEvent(vscode.debug.onDidChangeActiveDebugSession);
addChangeListener((session) => {
  outputChannel.appendLine(
    `Active debug session changed: ${session ? session.name : "None"}`,
  );
});
