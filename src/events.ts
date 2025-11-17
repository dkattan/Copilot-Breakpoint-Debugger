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

// Legacy waitForDebuggerStop removed in favor of session id and entry specific helpers.

/**
 * Wait for a debugger stop event (breakpoint/step/etc.) filtering by session id instead of name.
 * This is useful after acquiring the concrete session id from an initial 'entry' stop.
 */
export const waitForDebuggerStopBySessionId = async (params: {
  sessionId: string;
  timeout?: number;
}): Promise<BreakpointHitInfo> => {
  const { sessionId, timeout = 30000 } = params;

  return await new Promise<BreakpointHitInfo>((resolve, reject) => {
    let terminateListener: vscode.Disposable | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const listener = onBreakpointHit(event => {
      if (event.session.id !== sessionId) {
        return; // ignore other sessions
      }
      listener.dispose();
      terminateListener?.dispose();
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
      resolve(event);
    });
    terminateListener = onSessionTerminate(endEvent => {
      if (endEvent.session.id !== sessionId) {
        return; // ignore
      }
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
    timeoutHandle = setTimeout(() => {
      listener.dispose();
      terminateListener?.dispose();
      timeoutHandle = undefined;
      try {
        const target = activeSessions.find(s => s.id === sessionId);
        if (target) {
          void vscode.debug.stopDebugging(target);
          logger.warn(
            `Timeout waiting for debugger stop (by session id) for ${target.name} (${target.id}).`
          );
        }
      } catch (e) {
        logger.warn(
          `Timeout cleanup error (by session id): ${e instanceof Error ? e.message : String(e)}`
        );
      }
      reject(
        new Error(
          `Timed out waiting for breakpoint or termination for session id ${sessionId} (${timeout}ms).`
        )
      );
    }, timeout);
  });
};

/**
 * Wait for the first 'entry' stopped event for any new debug session (one whose id was not present in excludeIds).
 * This lets us capture the concrete session id immediately after launch without relying on the configured name.
 */
export const waitForEntryStop = async (params: {
  excludeSessionIds?: string[];
  timeout?: number;
}): Promise<BreakpointHitInfo> => {
  const { excludeSessionIds = [], timeout = 30000 } = params;
  return await new Promise<BreakpointHitInfo>((resolve, reject) => {
    let terminateListener: vscode.Disposable | undefined; // not strictly needed for entry but keep symmetry
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const excludeSet = new Set(excludeSessionIds);
    const listener = onBreakpointHit(event => {
      if (event.reason !== 'entry') {
        return; // only care about entry stops
      }
      // Ignore events for sessions that existed before launch (excludeSet)
      if (excludeSet.has(event.session.id)) {
        return;
      }
      listener.dispose();
      terminateListener?.dispose();
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
      resolve(event);
    });
    terminateListener = onSessionTerminate(endEvent => {
      // If a new session terminates before entry stop, treat as termination
      if (excludeSet.has(endEvent.session.id)) {
        return; // old session termination unrelated to launch
      }
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
    timeoutHandle = setTimeout(() => {
      listener.dispose();
      terminateListener?.dispose();
      timeoutHandle = undefined;
      reject(new Error(`Timed out waiting for entry stop (${timeout}ms).`));
    }, timeout);
  });
};
