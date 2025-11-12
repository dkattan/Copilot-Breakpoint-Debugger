import type { BreakpointHitInfo } from './common';
import type { DebugContext } from './debugUtils';
import * as vscode from 'vscode';
import { activeSessions, onSessionTerminate, outputChannel } from './common';
import { DAPHelpers } from './debugUtils';

// Debug Adapter Protocol message types
interface DebugProtocolMessage {
  seq: number;
  type: string;
}

interface DebugProtocolEvent extends DebugProtocolMessage {
  type: 'event';
  event: string;
  body?: unknown;
}

interface StoppedEventBody {
  reason: string;
  description?: string;
  threadId: number;
  text?: string;
  allThreadsStopped?: boolean;
  preserveFocusHint?: boolean;
}

interface DebugConfiguration extends vscode.DebugConfiguration {
  sessionName?: string;
}

/** Event emitter for breakpoint hit notifications */
export const breakpointEventEmitter =
  new vscode.EventEmitter<BreakpointHitInfo>();
export const onBreakpointHit = breakpointEventEmitter.event;

// Register debug adapter tracker to monitor debug events
vscode.debug.registerDebugAdapterTrackerFactory('*', {
  createDebugAdapterTracker: (
    session: vscode.DebugSession
  ): vscode.ProviderResult<vscode.DebugAdapterTracker> => {
    // Create a class that implements the DebugAdapterTracker interface
    class DebugAdapterTrackerImpl implements vscode.DebugAdapterTracker {
      onWillStartSession?(): void {
        outputChannel.appendLine(`Debug session starting: ${session.name}`);
      }

      onWillReceiveMessage?(message: DebugProtocolMessage): void {
        // Optional: Log messages being received by the debug adapter
        outputChannel.appendLine(
          `Message received by debug adapter: ${JSON.stringify(message)}`
        );
      }

      async onDidSendMessage(message: DebugProtocolMessage): Promise<void> {
        // Log all messages sent from the debug adapter to VS Code
        if (message.type === 'event') {
          const event = message as DebugProtocolEvent;
          // The 'stopped' event is fired when execution stops (e.g., at a breakpoint or exception)
          if (event.event === 'stopped') {
            const body = event.body as StoppedEventBody;
            // Process any stop event - including breakpoints, exceptions, and other stops
            const validReasons = [
              'breakpoint',
              'step',
              'pause',
              'exception',
              'assertion',
              'entry',
            ];

            if (validReasons.includes(body.reason)) {
              // Use existing getCallStack function to get thread and stack information
              // Collect exception details if this is an exception
              let exceptionDetails;
              if (body.reason === 'exception' && body.description) {
                exceptionDetails = {
                  description: body.description || 'Unknown exception',
                  details: body.text || 'No additional details available',
                };
              }

              // Get call stack information for the session
              // Some debug adapters (especially PowerShell) may send the stopped event before
              // stack frames are populated. Retry a few times with small delays.
              let callStackData: DebugContext;
              let threadData;
              const retries = 3;

              for (let attempt = 0; attempt < retries; attempt++) {
                if (attempt > 0) {
                  // Wait a bit before retrying
                  await new Promise(resolve =>
                    setTimeout(resolve, 50 * attempt)
                  );
                }
                try {
                  callStackData = await DAPHelpers.getDebugContext(
                    session,
                    body.threadId
                  );

                  if (!callStackData.frame?.source?.path) {
                    throw new Error(
                      `Top stack frame missing source path: ${JSON.stringify(callStackData.frame)}`
                    );
                  }

                  // Emit breakpoint/exception hit event with stack frame information
                  const eventData = {
                    session,
                    threadId: body.threadId,
                    reason: body.reason,
                    frameId: callStackData.frame.id,
                    filePath: callStackData.frame.source.path,
                    line: callStackData.frame.line,
                    exceptionInfo: exceptionDetails,
                  } as BreakpointHitInfo;

                  outputChannel.appendLine(
                    `Firing breakpoint event: ${JSON.stringify(eventData)}`
                  );
                  breakpointEventEmitter.fire(eventData);
                } catch (error) {
                  // If this is the last attempt, throw
                  if (attempt === retries - 1) {
                    throw new Error(
                      `Thread ${body.threadId} has no stack frames after ${retries} attempts`
                    );
                  }
                  outputChannel.appendLine(
                    `Retrying getDebugContext for thread ${body.threadId} (attempt ${
                      attempt + 1
                    }/${retries})`
                  );
                }
              }
              outputChannel.appendLine(
                `Message from debug adapter: ${JSON.stringify(message)}`
              );
            }
          }
        }
      }

      onWillSendMessage(message: DebugProtocolMessage): void {
        // Log all messages sent to the debug adapter
        outputChannel.appendLine(
          `Message sent to debug adapter: ${JSON.stringify(message)}`
        );
      }

      onDidReceiveMessage(message: DebugProtocolMessage): void {
        // Log all messages received from the debug adapter
        outputChannel.appendLine(
          `Message received from debug adapter: ${JSON.stringify(message)}`
        );
      }

      onError?(error: Error): void {
        outputChannel.appendLine(`Debug adapter error: ${error.message}`);
      }

      onExit?(code: number | undefined, signal: string | undefined): void {
        outputChannel.appendLine(
          `Debug adapter exited: code=${code}, signal=${signal}`
        );
      }
    }

    return new DebugAdapterTrackerImpl();
  },
});

/**
 * Wait for a breakpoint to be hit in a debug session.
 *
 * @param params - Object containing sessionName or sessionName to identify the debug session, and optional timeout.
 * @param params.sessionName - Optional session ID to identify the debug session.
 * @param params.timeout - Optional timeout in milliseconds (default: 30000).
 * @param params.includeTermination - Optional flag to include session termination events (default: true).
 */
export const waitForBreakpointHit = async (params: {
  sessionName: string;
  timeout?: number;
}): Promise<BreakpointHitInfo> => {
  const { sessionName, timeout = 30000 } = params; // Default timeout: 30 seconds

  // Create a promise that resolves when a breakpoint is hit
  const breakpointHitPromise = new Promise<BreakpointHitInfo>(
    (resolve, reject) => {
      // Declare terminateListener early to avoid use-before-define
      let terminateListener: vscode.Disposable | undefined;
      // Use the breakpointEventEmitter which is already wired up to the debug adapter tracker
      const listener = onBreakpointHit(event => {
        // Check if this event is for one of our target sessions
        outputChannel.appendLine(
          `Breakpoint hit detected for waitForBreakpointHit for session ${event.session.name} with id ${event.session.id}`
        );

        // Get current active sessions (not captured at promise creation time)
        const currentSessions = activeSessions;
        if (currentSessions.length === 0) {
          throw new Error(
            `No active debug sessions found while waiting for breakpoint hit.`
          );
        }
        // Try to find target session - supports multiple matching strategies
        let targetSession = currentSessions.find(
          s => s.name.endsWith(sessionName) && s.parentSession //||
          // (s.configuration &&
          //   (s.configuration as DebugConfiguration).sessionName ===
          //     sessionName)
        );

        // If sessionName is empty and we have no specific target, match the most recent session
        // This handles cases where session naming isn't available
        if (!targetSession) {
          // Use the last session in the array (most recently started)
          targetSession = currentSessions[currentSessions.length - 1];
          outputChannel.appendLine(
            `Using most recent session for matching: ${targetSession.name} (${targetSession.id})`
          );
        }

        // Check if the event matches our target session by session ID or name
        const eventMatchesTarget =
          // event.sessionName === targetSession.id ||
          event.session.name === targetSession.name ||
          event.session.name.startsWith(targetSession.name) ||
          targetSession.name.startsWith(event.session.name);

        if (eventMatchesTarget) {
          listener.dispose();
          terminateListener?.dispose();
          resolve(event);
          outputChannel.appendLine(
            `Breakpoint hit detected for waitForBreakpointHit: ${JSON.stringify(event)}`
          );
        }
      });

      // Optionally listen for session termination
      terminateListener = onSessionTerminate(endEvent => {
        outputChannel.appendLine(
          `Session termination detected for waitForBreakpointHit: ${JSON.stringify(endEvent)}`
        );
        listener.dispose();
        terminateListener?.dispose();
        resolve({
          session: endEvent.session,
          threadId: 0,
          reason: 'terminated',
        });
      });

      // Set a timeout to prevent blocking indefinitely
      setTimeout(() => {
        listener.dispose();
        terminateListener?.dispose();
        reject(
          new Error(
            `Timed out waiting for breakpoint or termination (${timeout}ms).`
          )
        );
      }, timeout);
    }
  );

  // Wait for the breakpoint to be hit or timeout
  return await breakpointHitPromise;
};
