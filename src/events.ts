import * as vscode from 'vscode';
import {
  activeSessions,
  type BreakpointHitInfo,
  onSessionTerminate,
} from './common';
import { DAPHelpers, type DebugContext } from './debugUtils';
import { logger } from './logger';

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
      private readonly traceEnabled = vscode.workspace
        .getConfiguration('copilotBreakpointDebugger')
        .get<boolean>('enableTraceLogging', false);

      private safeStringify(obj: unknown, max = 1000): string {
        let str: string;
        try {
          str = JSON.stringify(obj);
        } catch (e) {
          str = `[unstringifiable: ${e instanceof Error ? e.message : String(e)}]`;
        }
        if (str.length > max) {
          const truncated = str.slice(0, max);
          return `${truncated}… (truncated ${str.length - max} chars)`;
        }
        return str;
      }

      onWillStartSession?(): void {
        logger.info(`Debug session starting: ${session.name}`);
      }

      onWillReceiveMessage?(message: DebugProtocolMessage): void {
        if (!this.traceEnabled) {
          return;
        }
        logger.trace(
          `Message received by debug adapter: ${this.safeStringify(message)}`
        );
      }

      async onDidSendMessage(message: DebugProtocolMessage): Promise<void> {
        // Log all messages sent from the debug adapter to VS Code
        if (message.type !== 'event') {
          return;
        }
        const event = message as DebugProtocolEvent;
        if (event.event !== 'stopped') {
          return;
        }
        const body = event.body as StoppedEventBody;
        const validReasons = [
          'breakpoint',
          'step',
          'pause',
          'exception',
          'assertion',
          'entry',
        ];
        if (!validReasons.includes(body.reason)) {
          return;
        }

        try {
          let exceptionDetails;
          if (body.reason === 'exception' && body.description) {
            exceptionDetails = {
              description: body.description || 'Unknown exception',
              details: body.text || 'No additional details available',
            };
          }

          // Some debug adapters may send 'stopped' before frames/threads fully available.
          // Retry a few times with incremental backoff.
          const isEntry = body.reason === 'entry';
          // Entry stops often occur before the thread is fully paused; allow a few more attempts
          const retries = isEntry ? 5 : 3;
          let lastError: unknown;
          let callStackData: DebugContext | undefined;
          for (let attempt = 0; attempt < retries; attempt++) {
            try {
              if (attempt > 0) {
                await new Promise(r => setTimeout(r, 50 * attempt));
              }
              callStackData = await DAPHelpers.getDebugContext(
                session,
                body.threadId
              );
              if (!callStackData.frame?.source?.path) {
                throw new Error(
                  `Top stack frame missing source path: ${JSON.stringify(callStackData.frame)}`
                );
              }
              // Success
              break;
            } catch (err) {
              lastError = err;
              logger.debug(
                `getDebugContext attempt ${attempt + 1} failed for thread ${body.threadId}: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }

          if (!callStackData) {
            // If this was an entry stop and the thread isn't paused yet, treat it as a transient pre-breakpoint state
            if (
              isEntry &&
              lastError instanceof Error &&
              (/not paused/i.test(lastError.message) ||
                /Invalid thread id/i.test(lastError.message))
            ) {
              logger.debug(
                `Ignoring early entry stop without call stack: ${lastError.message}`
              );
              return; // Do not emit error event; wait for a real breakpoint/step stop
            }
            throw new Error(
              `Unable to retrieve call stack after ${retries} attempts for thread ${body.threadId}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
            );
          }

          const eventData: BreakpointHitInfo = {
            session,
            threadId: body.threadId,
            reason: body.reason,
            frameId: callStackData.frame.id,
            filePath: callStackData.frame.source?.path,
            line: callStackData.frame.line,
            exceptionInfo: exceptionDetails,
          };
          logger.debug(`Firing breakpoint event: ${JSON.stringify(eventData)}`);
          breakpointEventEmitter.fire(eventData);
        } catch (err) {
          // Fail fast locally without relying on a global unhandledRejection handler.
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`[stopped-event-error] ${msg} (reason=${body.reason})`);
          // Emit an error reason event so waiting logic can fail early.
          const errorEvent: BreakpointHitInfo = {
            session,
            threadId: body?.threadId ?? 0,
            reason: 'error',
          };
          breakpointEventEmitter.fire(errorEvent);
        }
      }

      onWillSendMessage(message: DebugProtocolMessage): void {
        if (!this.traceEnabled) {
          return;
        }
        logger.trace(
          `Message sent to debug adapter: ${this.safeStringify(message)}`
        );
      }

      onDidReceiveMessage(message: DebugProtocolMessage): void {
        if (!this.traceEnabled) {
          return;
        }
        logger.trace(
          `Message received from debug adapter: ${this.safeStringify(message)}`
        );
      }

      onError?(error: Error): void {
        // VS Code's NetworkDebugAdapter fires _onError(new Error('connection closed')) on socket close (see
        // workbench/contrib/debug/node/debugAdapter.ts line ~111). This is routine and can precede any stop lifecycle.
        // We ignore ALL 'connection closed' errors to eliminate noise.
        const msg = String(error);
        if (/connection closed/i.test(msg)) {
          logger.debug(`[adapter-close ignored] ${session.name}`);
          return; // silently ignore benign close
        }
        logger.error(`Debug adapter error: ${msg}`);
      }

      onExit?(code: number | undefined, signal: string | undefined): void {
        logger.info(`Debug adapter exited: code=${code}, signal=${signal}`);
      }
    }

    return new DebugAdapterTrackerImpl();
  },
});

/**
 * Wait for a breakpoint to be hit in a debug session.
 *
 * @param params - Object containing sessionName to identify the debug session and optional timeout.
 * @param params.sessionName - Session name to identify the debug session.
 * @param params.timeout - Optional timeout in milliseconds (default: 30000).
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
      // Use ReturnType<typeof setTimeout> for cross-environment compatibility (browser vs Node types)
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      // Use the breakpointEventEmitter which is already wired up to the debug adapter tracker
      const listener = onBreakpointHit(event => {
        // Check if this event is for one of our target sessions
        logger.debug(
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
          logger.debug(
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
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = undefined;
          }
          resolve(event);
          logger.trace(
            `Breakpoint hit detected for waitForBreakpointHit: ${JSON.stringify(event)}`
          );
        }
      });

      // Optionally listen for session termination
      terminateListener = onSessionTerminate(endEvent => {
        logger.info(
          `Session termination detected for waitForBreakpointHit: ${JSON.stringify(endEvent)}`
        );
        listener.dispose();
        terminateListener?.dispose();
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
        resolve({
          session: endEvent.session,
          threadId: 0,
          reason: 'terminated',
        });
      });

      // Set a timeout so we aren't waiting forever for a breakpoint or sessionTermination
      timeoutHandle = setTimeout(() => {
        listener.dispose();
        terminateListener?.dispose();
        timeoutHandle = undefined;
        try {
          // Attempt to stop the relevant debug session(s) before rejecting
          let targetSessions = activeSessions.filter(s =>
            s.name.endsWith(sessionName)
          );
          if (targetSessions.length === 0 && activeSessions.length > 0) {
            // Last resort: use most recent session if no name match
            targetSessions = [activeSessions[activeSessions.length - 1]];
          }
          for (const s of targetSessions) {
            // Fire and forget; we don't await inside the timer callback
            void vscode.debug.stopDebugging(s);
            logger.warn(
              `Timeout reached; stopping debug session ${s.name} (${s.id}).`
            );
          }
        } catch (e) {
          logger.warn(
            `Timeout cleanup error stopping sessions: ${e instanceof Error ? e.message : String(e)}`
          );
        }
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
