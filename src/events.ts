import type { BreakpointHitInfo, ThreadData } from './common';
import * as vscode from 'vscode';
import {
  activeSessions,
  getCallStack,
  onSessionTerminate,
  outputChannel,
} from './common';

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
              try {
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
                let callStackData;
                let threadData;
                const retries = 3;

                for (let attempt = 0; attempt < retries; attempt++) {
                  if (attempt > 0) {
                    // Wait a bit before retrying
                    await new Promise(resolve =>
                      setTimeout(resolve, 50 * attempt)
                    );
                  }

                  callStackData = await getCallStack({
                    sessionName: session.name,
                  });

                  // Find the thread that triggered the event
                  threadData = callStackData.threads.find(
                    (t: ThreadData) => t.threadId === body.threadId
                  );

                  if (!threadData) {
                    throw new Error(
                      `Thread ${body.threadId} not found in call stack. Available threads: ${callStackData.threads.map((t: ThreadData) => t.threadId).join(', ')}`
                    );
                  }

                  // If we have stack frames, we're done
                  if (
                    threadData.stackFrames &&
                    threadData.stackFrames.length > 0
                  ) {
                    break;
                  }

                  // If this is the last attempt, throw
                  if (attempt === retries - 1) {
                    throw new Error(
                      `Thread ${body.threadId} has no stack frames after ${retries} attempts`
                    );
                  }
                }

                // Get the top stack frame
                const topFrame = threadData?.stackFrames[0];

                if (!topFrame?.source?.path) {
                  throw new Error(
                    `Top stack frame missing source path: ${JSON.stringify(topFrame)}`
                  );
                }

                // Emit breakpoint/exception hit event with stack frame information
                const eventData = {
                  sessionId: session.id,
                  sessionName: session.name,
                  threadId: body.threadId,
                  reason: body.reason,
                  frameId: topFrame.id,
                  filePath: topFrame.source.path,
                  line: topFrame.line,
                  exceptionInfo: exceptionDetails,
                };

                outputChannel.appendLine(
                  `Firing breakpoint event: ${JSON.stringify(eventData)}`
                );
                breakpointEventEmitter.fire(eventData);
              } catch (error) {
                console.error('Error processing debug event:', error);
                // Still emit event with basic info
                const exceptionDetails =
                  body.reason === 'exception'
                    ? {
                        description: body.description || 'Unknown exception',
                        details: body.text || 'No details available',
                      }
                    : undefined;

                breakpointEventEmitter.fire({
                  sessionId: session.id,
                  sessionName: session.name,
                  threadId: body.threadId,
                  reason: body.reason,
                  exceptionInfo: exceptionDetails,
                });
              }
            }
          }
        }
        outputChannel.appendLine(
          `Message from debug adapter: ${JSON.stringify(message)}`
        );
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
  includeTermination?: boolean;
}): Promise<BreakpointHitInfo> => {
  const { sessionName, timeout = 30000, includeTermination = true } = params; // Default timeout: 30 seconds

  // Create a promise that resolves when a breakpoint is hit
  const breakpointHitPromise = new Promise<BreakpointHitInfo>(
    (resolve, reject) => {
      // Declare terminateListener early to avoid use-before-define
      let terminateListener: vscode.Disposable | undefined;
      // Use the breakpointEventEmitter which is already wired up to the debug adapter tracker
      const listener = onBreakpointHit(event => {
        // Check if this event is for one of our target sessions
        outputChannel.appendLine(
          `Breakpoint hit detected for waitForBreakpointHit for session ${event.sessionName} with id ${event.sessionName}`
        );
        let targetSession: vscode.DebugSession | undefined;

        // Get current active sessions (not captured at promise creation time)
        const currentSessions = activeSessions;

        // Try to find target session - supports multiple matching strategies
        const session = currentSessions.find(
          s =>
            s.id === sessionName ||
            s.name === sessionName ||
            (s.configuration &&
              (s.configuration as DebugConfiguration).sessionName ===
                sessionName)
        );
        if (session) {
          targetSession = session;
        }

        // If sessionName is empty and we have no specific target, match the most recent session
        // This handles cases where session naming isn't available
        if (!sessionName && !targetSession && currentSessions.length > 0) {
          // Use the last session in the array (most recently started)
          targetSession = currentSessions[currentSessions.length - 1];
          outputChannel.appendLine(
            `Using most recent session for matching: ${targetSession.name} (${targetSession.id})`
          );
        }

        // Check if the event matches our target session by session ID or name
        const eventMatchesTarget =
          targetSession !== undefined &&
          (event.sessionName === targetSession.id ||
            event.sessionName === targetSession.name ||
            event.sessionName.startsWith(targetSession.name) ||
            targetSession.name.startsWith(event.sessionName));

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
      if (includeTermination) {
        terminateListener = onSessionTerminate(endEvent => {
          const matches = sessionName
            ? endEvent.sessionName === sessionName
            : true;
          if (matches) {
            outputChannel.appendLine(
              `Session termination detected for waitForBreakpointHit: ${JSON.stringify(endEvent)}`
            );
            listener.dispose();
            terminateListener?.dispose();
            resolve({
              sessionId: endEvent.sessionId,
              sessionName: endEvent.sessionName,
              threadId: 0,
              reason: 'terminated',
            });
          }
        });
      }

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
