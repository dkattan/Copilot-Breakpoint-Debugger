import type { BreakpointHitInfo } from './common';
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

interface ThreadData {
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
                const callStackResult = await getCallStack({
                  sessionName: session.name,
                });

                if (callStackResult.isError) {
                  // If we couldn't get call stack, emit basic event
                  breakpointEventEmitter.fire({
                    sessionId: session.id,
                    sessionName: session.name,
                    threadId: body.threadId,
                    reason: body.reason,
                    exceptionInfo: exceptionDetails,
                  });
                  return;
                }
                if (!('json' in callStackResult.content[0])) {
                  // If the content is not JSON, emit basic event
                  breakpointEventEmitter.fire({
                    sessionId: session.id,
                    sessionName: session.name,
                    threadId: body.threadId,
                    reason: body.reason,
                    exceptionInfo: exceptionDetails,
                  });
                  return;
                }
                // Extract call stack data from the result
                const callStackData =
                  callStackResult.content[0].json?.callStacks[0];
                if (!('threads' in callStackData)) {
                  // If threads are not present, emit basic event
                  breakpointEventEmitter.fire({
                    sessionId: session.id,
                    sessionName: session.name,
                    threadId: body.threadId,
                    reason: body.reason,
                    exceptionInfo: exceptionDetails,
                  });
                  return;
                }
                // If threads are present, find the one that matches the threadId
                if (!Array.isArray(callStackData.threads)) {
                  breakpointEventEmitter.fire({
                    sessionId: session.id,
                    sessionName: session.name,
                    threadId: body.threadId,
                    reason: body.reason,
                    exceptionInfo: exceptionDetails,
                  });
                  return;
                }
                // Find the thread that triggered the event
                const threadData = callStackData.threads.find(
                  (t: ThreadData) => t.threadId === body.threadId
                );

                if (
                  !threadData ||
                  !threadData.stackFrames ||
                  threadData.stackFrames.length === 0
                ) {
                  // If thread or stack frames not found, emit basic event
                  breakpointEventEmitter.fire({
                    sessionId: session.id,
                    sessionName: session.name,
                    threadId: body.threadId,
                    reason: body.reason,
                    exceptionInfo: exceptionDetails,
                  });
                  return;
                }

                // Get the top stack frame
                const topFrame = threadData.stackFrames[0];

                // Emit breakpoint/exception hit event with stack frame information
                const eventData = {
                  sessionId: session.id,
                  sessionName: session.name,
                  threadId: body.threadId,
                  reason: body.reason,
                  frameId: topFrame.id,
                  filePath: topFrame.source?.path,
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
}) => {
  const { sessionName, timeout = 30000, includeTermination = true } = params; // Default timeout: 30 seconds

  try {
    // Create a promise that resolves when a breakpoint is hit
    const breakpointHitPromise = new Promise<BreakpointHitInfo>(
      (resolve, reject) => {
        const availableSessions = activeSessions;
        // Declare terminateListener early to avoid use-before-define
        let terminateListener: vscode.Disposable | undefined;
        // Use the breakpointEventEmitter which is already wired up to the debug adapter tracker
        const listener = onBreakpointHit(event => {
          // Check if this event is for one of our target sessions
          outputChannel.appendLine(
            `Breakpoint hit detected for waitForBreakpointHit for session ${event.sessionName} with id ${event.sessionName}`
          );
          let targetSession: vscode.DebugSession | undefined;

          const session = availableSessions.find(
            s =>
              s.id === sessionName ||
              (s.configuration &&
                (s.configuration as DebugConfiguration).sessionName ===
                  sessionName)
          );
          if (session) {
            targetSession = session;
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
    const result = await breakpointHitPromise;

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result),
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error waiting for breakpoint: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
};
