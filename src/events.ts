import type { BreakpointHitInfo } from "./common";
import type { DebugContext } from "./debugUtils";

import { useDisposable, useEventEmitter } from "reactive-vscode";
import * as vscode from "vscode";
import {
  activeSessions,
  onSessionTerminate,
  setSessionParentId,
  setSessionRunState,
} from "./common";
import { config } from "./config";
import { DAPHelpers } from "./debugUtils";
import { logger } from "./logger";

// Debug Adapter Protocol message types
interface DebugProtocolMessage {
  seq: number
  type: string
}

type DapFingerprint = string;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getRecord(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function getArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function getDapFingerprint(
  direction: DebugAdapterMessageDirection,
  message: DebugProtocolMessage,
): string {
  const type = typeof (message as unknown as { type?: unknown }).type === "string"
    ? (message as unknown as { type: string }).type
    : "message";

  const seq = typeof (message as unknown as { seq?: unknown }).seq === "number"
    ? (message as unknown as { seq: number }).seq
    : -1;

  const command = typeof (message as unknown as { command?: unknown }).command === "string"
    ? (message as unknown as { command: string }).command
    : "";

  const event = typeof (message as unknown as { event?: unknown }).event === "string"
    ? (message as unknown as { event: string }).event
    : "";

  return `${direction}|${type}|${seq}|${command}|${event}`;
}

// VS Code can attach multiple trackers for the same session (and/or invoke tracker hooks
// more than once). Maintain a per-session fingerprint cache on globalThis so we can
// de-duplicate across tracker instances.
const seenDapFingerprintsBySessionId: Map<string, Map<DapFingerprint, number>> = (() => {
  const key = "__copilotDebuggerSeenDapFingerprintsBySessionId";
  const host = globalThis as unknown as Record<string, unknown>;
  const existing = host[key];
  if (existing instanceof Map) {
    return existing as Map<string, Map<DapFingerprint, number>>;
  }
  const created = new Map<string, Map<DapFingerprint, number>>();
  host[key] = created;
  return created;
})();

function getDapMessageKind(message: DebugProtocolMessage): string {
  const type = typeof message?.type === "string" ? message.type : "message";
  switch (type) {
    case "request":
      return "REQ";
    case "response":
      return "RESP";
    case "event":
      return "EVT";
    default:
      return type.toUpperCase();
  }
}

interface DebugProtocolResponse extends DebugProtocolMessage {
  type: "response"
  command: string
  success: boolean
  body?: unknown
}

interface DebugProtocolRequest extends DebugProtocolMessage {
  type: "request"
  command: string
  arguments?: unknown
}

interface DebugProtocolEvent extends DebugProtocolMessage {
  type: "event"
  event: string
  body?: unknown
}

interface StoppedEventBody {
  reason: string
  description?: string
  threadId: number
  text?: string
}

interface OutputEventBody {
  category: "console" | "stdout" | "stderr" | "telemetry" | string
  output: string
  variablesReference?: number
  source?: { name?: string, path?: string }
  line?: number
  column?: number
}

interface ExitedEventBody {
  exitCode: number
}

export interface OutputLine {
  category: string
  text: string
  timestamp: number
}

function getCopilotDebuggerSetting<T>(key: string, defaultValue: T): T {
  try {
    const cfg = vscode.workspace.getConfiguration("copilot-debugger");
    const value = cfg.get<T>(key);
    return value === undefined ? defaultValue : value;
  }
  catch {
    return defaultValue;
  }
}

type DebugAdapterMessageDirection = "toAdapter" | "fromAdapter";

interface DebugAdapterMessageSnapshot {
  direction: DebugAdapterMessageDirection
  timestamp: number
  summary: string
}

export interface SessionExitInfo {
  sessionId: string
  exitCode?: number
  signal?: string
}

export interface TimeoutSessionSnapshot {
  id: string
  name: string
  type?: string
  workspaceFolder?: string
  configurationName?: string
  request?: string
  serverReadyAction?: unknown
  stopped: boolean
  stopError?: string
}

export interface EntryStopTimeoutDetails {
  timeoutMs: number
  sessions: TimeoutSessionSnapshot[]
}

export class EntryStopTimeoutError extends Error {
  constructor(
    message: string,
    public readonly details: EntryStopTimeoutDetails,
  ) {
    super(message);
    this.name = "EntryStopTimeoutError";
  }
}

/** Event emitter for breakpoint hit notifications */
export const breakpointEventEmitter = useEventEmitter<BreakpointHitInfo>();
export const onBreakpointHit = breakpointEventEmitter.event;

/** Event emitter for debug adapter exit notifications */
export const sessionExitEventEmitter = useEventEmitter<SessionExitInfo>();

// Per-session output buffers for DAP output events
const sessionOutputBuffers = new Map<string, OutputLine[]>();

// Per-session exit codes from DAP exited events
const sessionExitCodes = new Map<string, number>();

// Per-session capabilities from DAP initialize response
const sessionCapabilities = new Map<string, unknown>();

// Per-session ring buffer of recent DAP messages (for timeout diagnostics)
const sessionDebugAdapterMessages = new Map<
  string,
  DebugAdapterMessageSnapshot[]
>();

// VS Code may invoke tracker factories multiple times for the same session id.
// Ensure we only attach ONE tracker per session to avoid duplicate logs and
// duplicated diagnostic buffers.
const createdTrackerBySessionId: Set<string> = (() => {
  const key = "__copilotDebuggerCreatedTrackerBySessionId";
  const host = globalThis as unknown as Record<string, unknown>;
  const existing = host[key];
  if (existing instanceof Set) {
    return existing as Set<string>;
  }
  const created = new Set<string>();
  host[key] = created;
  return created;
})();

// Debug adapter tracker instances (and even tracker factories) can be created more than once
// for the same session. Keep the trace-status banner to a single line per session id.
//
// Store this on globalThis so it remains shared even if this module is loaded more than once
// within the same extension host process.
const loggedTraceStatusBySessionId: Set<string> = (() => {
  const key = "__copilotDebuggerLoggedTraceStatusBySessionId";
  const host = globalThis as unknown as Record<string, unknown>;
  const existing = host[key];
  if (existing instanceof Set) {
    return existing as Set<string>;
  }
  const created = new Set<string>();
  host[key] = created;
  return created;
})();

function safeStringify(obj: unknown, maxLength = 1000): string {
  let str: string;
  try {
    str = JSON.stringify(obj);
  }
  catch (e) {
    str = `[unstringifiable: ${e instanceof Error ? e.message : String(e)}]`;
  }
  if (str.length > maxLength) {
    const truncated = str.slice(0, maxLength);
    return `${truncated}… (truncated ${str.length - maxLength} chars)`;
  }
  return str;
}

function shortenForLog(text: string, maxLength = 160): string {
  if (text.length <= maxLength) {
    return text;
  }
  const truncated = text.slice(0, maxLength);
  return `${truncated}… (truncated ${text.length - maxLength} chars)`;
}

function looksLikeNodeInternalsSourcePath(path: string): boolean {
  return path.startsWith("<node_internals>/") || path === "<node_internals>";
}

function formatDapTraceMessage(message: DebugProtocolMessage): string {
  const msg = getRecord(message) ?? {};
  const type = getString(msg.type) ?? "message";
  const seq = getNumber(msg.seq);

  if (type === "request") {
    const command = getString(msg.command) ?? "<unknown>";
    const args = getRecord(msg.arguments);
    if (!args || Object.keys(args).length === 0) {
      return `seq=${seq ?? "?"} command=${command}`;
    }
    // Requests are usually small; keep args but aggressively bound.
    return `seq=${seq ?? "?"} command=${command} args=${safeStringify(args, 300)}`;
  }

  if (type === "response") {
    const command = getString(msg.command) ?? "<unknown>";
    const success = getBoolean(msg.success);
    const requestSeq = getNumber(msg.request_seq);
    const body = getRecord(msg.body);

    if (command === "variables") {
      const vars = getArray(body?.variables);
      const names = (vars ?? [])
        .slice(0, 8)
        .map((v) => {
          const rec = getRecord(v);
          const n = getString(rec?.name);
          const t = getString(rec?.type);
          return t ? `${n ?? "?"}:${t}` : (n ?? "?");
        })
        .join(", ");
      const count = vars?.length;
      return `request_seq=${requestSeq ?? "?"} command=variables success=${String(success)} variables=${count ?? "?"}${names ? ` [${names}${count && count > 8 ? ", …" : ""}]` : ""}`;
    }

    if (command === "stackTrace") {
      const frames = getArray(body?.stackFrames);
      const totalFrames = getNumber(body?.totalFrames);
      const top = getRecord(frames?.[0]);
      const topName = getString(top?.name);
      const topLine = getNumber(top?.line);
      const topSource = getRecord(top?.source);
      const topPath = getString(topSource?.path) ?? getString(topSource?.name);
      const loc = topPath && topLine ? `${topPath}:${topLine}` : undefined;
      return `request_seq=${requestSeq ?? "?"} command=stackTrace success=${String(success)} frames=${frames?.length ?? "?"} totalFrames=${totalFrames ?? "?"}${loc ? ` top=${loc}${topName ? ` (${topName})` : ""}` : ""}`;
    }

    if (command === "scopes") {
      const scopes = getArray(body?.scopes);
      const names = (scopes ?? [])
        .slice(0, 6)
        .map((s) => {
          const rec = getRecord(s);
          const n = getString(rec?.name) ?? "?";
          const expensive = getBoolean(rec?.expensive);
          return expensive ? `${n}*` : n;
        })
        .join(", ");
      return `request_seq=${requestSeq ?? "?"} command=scopes success=${String(success)} scopes=${scopes?.length ?? "?"}${names ? ` [${names}${scopes && scopes.length > 6 ? ", …" : ""}]` : ""}`;
    }

    if (command === "initialize") {
      const caps = body ? Object.keys(body).length : 0;
      return `request_seq=${requestSeq ?? "?"} command=initialize success=${String(success)} capabilitiesKeys=${caps}`;
    }

    // Default: keep it short; responses can be large.
    return `request_seq=${requestSeq ?? "?"} command=${command} success=${String(success)}${body ? ` body=${safeStringify(body, 300)}` : ""}`;
  }

  if (type === "event") {
    const event = getString(msg.event) ?? "<unknown>";
    const body = getRecord(msg.body);

    if (event === "loadedSource") {
      const source = getRecord(body?.source);
      const path = getString(source?.path) ?? getString(source?.name);
      const reason = getString(body?.reason);
      const hint = getString(source?.presentationHint);
      return `seq=${seq ?? "?"} event=loadedSource reason=${reason ?? "?"} source=${path ?? "?"}${hint ? ` hint=${hint}` : ""}`;
    }

    if (event === "output") {
      const category = getString(body?.category) ?? "?";
      const output = getString(body?.output) ?? "";
      const preview = output ? shortenForLog(output.replace(/\s+/g, " ").trim(), 120) : "";
      return `seq=${seq ?? "?"} event=output category=${category} len=${output.length}${preview ? ` preview=${safeStringify(preview, 140)}` : ""}`;
    }

    if (event === "stopped") {
      const reason = getString(body?.reason) ?? "?";
      const threadId = getNumber(body?.threadId);
      return `seq=${seq ?? "?"} event=stopped reason=${reason}${threadId ? ` threadId=${threadId}` : ""}`;
    }

    return `seq=${seq ?? "?"} event=${event}${body ? ` body=${safeStringify(body, 250)}` : ""}`;
  }

  // Unknown message.
  return safeStringify(message, 300);
}

function pushDebugAdapterMessage(sessionId: string, entry: DebugAdapterMessageSnapshot): void {
  const max = 25;
  if (!sessionDebugAdapterMessages.has(sessionId)) {
    sessionDebugAdapterMessages.set(sessionId, []);
  }
  const buffer = sessionDebugAdapterMessages.get(sessionId)!;
  buffer.push(entry);
  while (buffer.length > max) {
    buffer.shift();
  }
}

function formatRecentDebugAdapterMessages(sessionId: string): string | undefined {
  const buffer = sessionDebugAdapterMessages.get(sessionId);
  if (!buffer?.length) {
    return undefined;
  }
  const tail = buffer.slice(-10);
  const formatted = tail
    .map((m) => {
      const dir = m.direction === "toAdapter" ? "→" : "←";
      return `${dir} ${m.summary}`;
    })
    .join(" | ");
  return formatted ? `Recent DAP messages: ${formatted}` : undefined;
}

/**
 * Get capabilities for a session
 */
export function getSessionCapabilities(sessionId: string): unknown | undefined {
  return sessionCapabilities.get(sessionId);
}

// Register debug adapter tracker to monitor debug events
useDisposable(
  vscode.debug.registerDebugAdapterTrackerFactory("*", {
    createDebugAdapterTracker: (
      session: vscode.DebugSession,
    ): vscode.ProviderResult<vscode.DebugAdapterTracker> => {
      if (createdTrackerBySessionId.has(session.id)) {
        // Avoid duplicate trackers (and duplicate DAP logs) for the same session.
        return undefined;
      }
      createdTrackerBySessionId.add(session.id);

      // Create a class that implements the DebugAdapterTracker interface
      class DebugAdapterTrackerImpl implements vscode.DebugAdapterTracker {
        private suppressedLoadedSourceCount = 0;
        private lastSuppressedLoadedSourceSummaryAt = 0;

        private maybeSummarizeSuppressedLoadedSource(): void {
          if (!this.traceEnabled) {
            return;
          }
          if (this.suppressedLoadedSourceCount <= 0) {
            return;
          }
          const now = Date.now();
          // Rate-limit the summary to avoid adding more noise.
          if (now - this.lastSuppressedLoadedSourceSummaryAt < 2000) {
            return;
          }
          this.lastSuppressedLoadedSourceSummaryAt = now;
          const count = this.suppressedLoadedSourceCount;
          this.suppressedLoadedSourceCount = 0;
          logger.trace(
            `[DAP][EVT] adapter → editor: loadedSource (suppressed ${count} <node_internals> deemphasized sources)`,
          );
        }

        private shouldSuppressLoadedSourceEvent(message: DebugProtocolMessage): boolean {
          const msg = getRecord(message);
          if (!msg || msg.type !== "event" || msg.event !== "loadedSource") {
            return false;
          }
          const body = getRecord(msg.body);
          const source = getRecord(body?.source);
          const path = getString(source?.path);
          const hint = getString(source?.presentationHint);
          if (!path) {
            return false;
          }
          // These are overwhelmingly noisy and provide little value in our logs.
          return looksLikeNodeInternalsSourcePath(path) && hint === "deemphasize";
        }

        private shouldRecordDapMessage(
          direction: DebugAdapterMessageDirection,
          message: DebugProtocolMessage,
        ): boolean {
          const key = getDapFingerprint(direction, message);
          const now = Date.now();

          let seen = seenDapFingerprintsBySessionId.get(session.id);
          if (!seen) {
            seen = new Map<DapFingerprint, number>();
            seenDapFingerprintsBySessionId.set(session.id, seen);
          }

          if (seen.has(key)) {
            return false;
          }

          seen.set(key, now);

          // Keep memory bounded. Map iteration order is insertion order.
          const maxEntries = 1500;
          while (seen.size > maxEntries) {
            const first = seen.keys().next().value as DapFingerprint | undefined;
            if (!first) {
              break;
            }
            seen.delete(first);
          }

          return true;
        }

        private get traceEnabled(): boolean {
          return !!getCopilotDebuggerSetting<boolean>("enableTraceLogging", false);
        }

        private logTraceStatusOnce(): void {
          if (loggedTraceStatusBySessionId.has(session.id)) {
            return;
          }
          loggedTraceStatusBySessionId.add(session.id);
          const enabled = this.traceEnabled;
          const consoleLogLevel = getCopilotDebuggerSetting<string>(
            "consoleLogLevel",
            "info",
          );
          // Trace-level so it appears alongside DAP traffic and is easy to grep.
          logger.trace(
            `[DAP] tracing ${enabled ? "ENABLED" : "disabled"} for session '${session.name}' (${session.id}); copilot-debugger.enableTraceLogging=${String(
              enabled,
            )}; copilot-debugger.consoleLogLevel=${consoleLogLevel}`,
          );
        }

        onWillStartSession?(): void {
          // Ensure users see the trace status even if no DAP messages are observed
          // (or before the first message arrives).
          this.logTraceStatusOnce();
        }

        onWillReceiveMessage?(message: DebugProtocolMessage): void {
          this.logTraceStatusOnce();

          // VS Code can invoke tracker hooks more than once per message.
          // De-dup by (direction,type,seq,command/event) to avoid double-logging.
          if (!this.shouldRecordDapMessage("toAdapter", message)) {
            return;
          }

          // Track child -> parent relationships for multi-session debuggers (e.g. Node).
          // The JS debug adapter includes __parentId and __sessionId in launch arguments for child sessions.
          if (message.type === "request") {
            const req = message as DebugProtocolRequest;
            if (req.command === "launch") {
              const args = req.arguments as unknown as Record<string, unknown> | undefined;
              const parentId = typeof args?.__parentId === "string" ? args.__parentId : undefined;
              const sessionId = typeof args?.__sessionId === "string" ? args.__sessionId : undefined;
              if (parentId && sessionId) {
                setSessionParentId(sessionId, parentId);
              }
            }
          }

          // Capture minimal DAP traffic for diagnostics (e.g. the immediate response/event
          // after a 'continue' request that might explain a stop-wait timeout).
          pushDebugAdapterMessage(session.id, {
            direction: "toAdapter",
            timestamp: Date.now(),
            summary: safeStringify(message, 400),
          });

          if (!this.traceEnabled) {
            return;
          }
          logger.trace(
            `[DAP][${getDapMessageKind(message)}] editor → adapter: ${formatDapTraceMessage(
              message,
            )}`,
          );
        }

        async onDidSendMessage(message: DebugProtocolMessage): Promise<void> {
          this.logTraceStatusOnce();

          if (!this.shouldRecordDapMessage("fromAdapter", message)) {
            return;
          }

          pushDebugAdapterMessage(session.id, {
            direction: "fromAdapter",
            timestamp: Date.now(),
            summary: safeStringify(message, 400),
          });

          if (this.traceEnabled) {
            // loadedSource can be extremely noisy (especially node internals).
            // Summarize or suppress the worst offenders to keep test output usable.
            if (this.shouldSuppressLoadedSourceEvent(message)) {
              this.suppressedLoadedSourceCount++;
              this.maybeSummarizeSuppressedLoadedSource();
            }
            else {
              logger.trace(
                `[DAP][${getDapMessageKind(message)}] adapter → editor: ${formatDapTraceMessage(
                  message,
                )}`,
              );
            }
          }

          // Log all messages sent from the debug adapter to VS Code
          if (message.type === "response") {
            const response = message as DebugProtocolResponse;
            if (response.command === "initialize" && response.success) {
              sessionCapabilities.set(session.id, response.body);
            }
          }

          if (message.type !== "event") {
            return;
          }
          const event = message as DebugProtocolEvent;

          // Handle output events for stderr/stdout capture
          if (event.event === "output") {
            const body = event.body as OutputEventBody;
            const maxLines = config.maxOutputLines ?? 50;

            if (!sessionOutputBuffers.has(session.id)) {
              sessionOutputBuffers.set(session.id, []);
            }
            const buffer = sessionOutputBuffers.get(session.id)!;
            buffer.push({
              category: body.category,
              text: body.output,
              timestamp: Date.now(),
            });
            // Circular buffer: drop oldest if exceeding max
            while (buffer.length > maxLines) {
              buffer.shift();
            }
            return;
          }

          if (event.event === "continued") {
            setSessionRunState(session.id, "running");
            return;
          }

          if (event.event === "terminated") {
            setSessionRunState(session.id, "terminated");
            return;
          }

          // Handle exited events for process exit code capture
          if (event.event === "exited") {
            const body = event.body as ExitedEventBody;
            sessionExitCodes.set(session.id, body.exitCode);
            setSessionRunState(session.id, "terminated");
            logger.debug(
              `Process exited for session ${session.id}: exitCode=${body.exitCode}`,
            );
            return;
          }

          if (event.event !== "stopped") {
            return;
          }
          const body = event.body as StoppedEventBody;
          setSessionRunState(session.id, "paused");
          const validReasons = [
            "breakpoint",
            "step",
            "pause",
            "exception",
            "assertion",
            "entry",
          ];
          if (!validReasons.includes(body.reason)) {
            return;
          }

          try {
            let exceptionDetails;
            if (body.reason === "exception" && body.description) {
              exceptionDetails = {
                description: body.description || "Unknown exception",
                details: body.text || "No additional details available",
              };
            }

            // Some debug adapters may send 'stopped' before frames/threads fully available.
            // Retry a few times with incremental backoff.
            const isEntry = body.reason === "entry";
            // Entry stops often occur before the thread is fully paused; allow a few more attempts
            const retries = isEntry ? 5 : 3;
            let callStackData: DebugContext | undefined;
            for (let attempt = 0; attempt < retries; attempt++) {
              try {
                if (attempt > 0) {
                  await new Promise(r => setTimeout(r, 50 * attempt));
                }
                callStackData = await DAPHelpers.getDebugContext(
                  session,
                  body.threadId,
                );
                // Some adapters report 'stopped' before a user-code frame exists (or before source paths
                // are populated). For tool orchestration we primarily need the session id + thread id;
                // higher-level code can retry context resolution once the adapter is fully paused.
                // Success
                break;
              }
              catch (err) {
                logger.debug(
                  `getDebugContext attempt ${attempt + 1} failed for thread ${
                    body.threadId
                  }: ${err instanceof Error ? err.message : String(err)}`,
                );

                // If this was an entry stop and the thread isn't paused yet, treat it as an acceptable
                // early entry signal. We only need the session id at this stage.
                if (
                  isEntry
                  && err instanceof Error
                  && (/not paused/i.test(err.message)
                    || /Invalid thread id/i.test(err.message))
                ) {
                  callStackData = undefined;
                  break;
                }
              }
            }

            if (!callStackData) {
              // Emit a minimal stop event even without call stack info.
              // This prevents timeouts when adapters report 'stopped' before threads/frames are ready.
              const eventData: BreakpointHitInfo = {
                session,
                threadId: body.threadId,
                reason: body.reason,
                exceptionInfo: exceptionDetails,
              };
              logger.debug(
                `Firing minimal stop event (no call stack yet): ${JSON.stringify(
                  eventData,
                )}`,
              );
              breakpointEventEmitter.fire(eventData);
              return;
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
            logger.debug(
              `Firing breakpoint event: ${JSON.stringify(eventData)}`,
            );
            breakpointEventEmitter.fire(eventData);
          }
          catch (err) {
            // Fail fast locally without relying on a global unhandledRejection handler.
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(
              `[stopped-event-error] ${msg} (reason=${body.reason})`,
            );
            // Emit an error reason event so waiting logic can fail early.
            const errorEvent: BreakpointHitInfo = {
              session,
              threadId: body?.threadId ?? 0,
              reason: "error",
            };
            breakpointEventEmitter.fire(errorEvent);
          }
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
          logger.error(`[DAP] debug adapter error (session '${session.name}' ${session.id}): ${msg}`);
        }

        onExit?(code: number | undefined, signal: string | undefined): void {
          // Flush any remaining suppression summary before exit so users have context.
          this.maybeSummarizeSuppressedLoadedSource();
          logger.info(
            `[DAP] debug adapter exited for session '${session.name}' (${session.id}): code=${code}, signal=${signal}`,
          );
          sessionExitEventEmitter.fire({
            sessionId: session.id,
            exitCode: code,
            signal,
          });

          // Allow future sessions to create trackers without unbounded growth.
          createdTrackerBySessionId.delete(session.id);

          // Best-effort cleanup of fingerprint cache for this session.
          seenDapFingerprintsBySessionId.delete(session.id);
        }
      }

      return new DebugAdapterTrackerImpl();
    },
  }),
);

/**
 * Get captured output lines for a debug session
 */
export function getSessionOutput(sessionId: string): OutputLine[] {
  return sessionOutputBuffers.get(sessionId) ?? [];
}

/**
 * Get process exit code from DAP exited event for a session
 */
export function getSessionExitCode(sessionId: string): number | undefined {
  return sessionExitCodes.get(sessionId);
}

/**
 * Clear output buffer and exit code for a session (cleanup)
 */
// Legacy waitForDebuggerStop removed in favor of session id and entry specific helpers.

/**
 * Create a stop waiter that can be disposed.
 *
 * Use this when you need to set up stop listeners BEFORE issuing a DAP request
 * (e.g. continue/next) to avoid missing fast stops, while still ensuring you
 * can tear down listeners immediately if the request fails.
 */
export function createStopWaiterBySessionId(params: {
  sessionId: string
  timeout?: number
}): { promise: Promise<BreakpointHitInfo>, dispose: () => void } {
  const { sessionId, timeout = 30000 } = params;

  let terminateListener: vscode.Disposable | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let listener: vscode.Disposable | undefined;
  let settled = false;

  const dispose = () => {
    if (settled) {
      return;
    }
    settled = true;
    try {
      listener?.dispose();
    }
    catch {
      // ignore
    }
    try {
      terminateListener?.dispose();
    }
    catch {
      // ignore
    }
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }
  };

  const promise = new Promise<BreakpointHitInfo>((resolve, reject) => {
    listener = onBreakpointHit((event) => {
      if (event.session.id !== sessionId) {
        return; // ignore other sessions
      }
      dispose();
      resolve(event);
    });
    terminateListener = onSessionTerminate((endEvent) => {
      if (endEvent.session.id !== sessionId) {
        return; // ignore
      }
      dispose();
      resolve({
        session: endEvent.session,
        threadId: 0,
        reason: "terminated",
      });
    });
    timeoutHandle = setTimeout(() => {
      dispose();
      try {
        const target = activeSessions.find(s => s.id === sessionId);
        if (target) {
          void vscode.debug.stopDebugging(target);
          logger.warn(
            `Timeout waiting for debugger stop (by session id) for ${target.name} (${target.id}).`,
          );
        }
      }
      catch (e) {
        logger.warn(
          `Timeout cleanup error (by session id): ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }

      const recent = formatRecentDebugAdapterMessages(sessionId);
      reject(
        new Error(
          `Timed out waiting for breakpoint or termination for session id ${sessionId} (${timeout}ms).${
            recent ? `\n${recent}` : ""
          }`,
        ),
      );
    }, timeout);
  });

  return { promise, dispose };
}

/**
 * Wait for the first stopped event ("entry" OR any other valid stop reason such as breakpoint/step/exception)
 * for any new debug session (one whose id was not present in excludeIds).
 *
 * Some debug adapters (e.g. Azure Functions attach) ignore `stopOnEntry` and never emit an "entry" reason.
 * They will, however, emit a regular breakpoint (or other) stopped event once user code is reached. Our
 * previous logic waited strictly for `reason === 'entry'` which caused a premature timeout for these adapters.
 *
 * This updated logic treats the FIRST valid stopped event for a newly created session as the "entry" equivalent
 * for purposes of acquiring the concrete session id. Termination before any stop is still surfaced distinctly.
 */
export async function waitForEntryStop(params: {
  excludeSessionIds?: string[]
  timeout?: number
}): Promise<BreakpointHitInfo> {
  const { excludeSessionIds = [], timeout = 30000 } = params;
  return await new Promise<BreakpointHitInfo>((resolve, reject) => {
    let terminateListener: vscode.Disposable | undefined; // not strictly needed for entry but keep symmetry
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let lateStartCleanup: vscode.Disposable | undefined;
    let lateStartCleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const excludeSet = new Set(excludeSessionIds);
    const listener = onBreakpointHit((event) => {
      // Ignore events for sessions that existed before launch (excludeSet)
      if (excludeSet.has(event.session.id)) {
        return;
      }
      // Ignore internal error events; wait for a genuine stopped reason
      if (event.reason === "error") {
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
    terminateListener = onSessionTerminate((endEvent) => {
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
        reason: "terminated",
      });
    });
    timeoutHandle = setTimeout(() => {
      listener.dispose();
      terminateListener?.dispose();
      timeoutHandle = undefined;

      // Cleanup safety net: if a debug session starts shortly AFTER we time out
      // (a known race when startDebugging is slow to create the session), stop it
      // so it can't interfere with subsequent tool invocations/tests.
      // This is best-effort cleanup only and does not affect the timeout result.
      lateStartCleanup?.dispose();
      lateStartCleanupTimer && clearTimeout(lateStartCleanupTimer);
      lateStartCleanupTimer = setTimeout(() => {
        lateStartCleanup?.dispose();
        lateStartCleanup = undefined;
        lateStartCleanupTimer = undefined;
      }, 10_000);
      lateStartCleanup = vscode.debug.onDidStartDebugSession((session) => {
        if (excludeSet.has(session.id)) {
          return;
        }
        lateStartCleanup?.dispose();
        lateStartCleanup = undefined;
        lateStartCleanupTimer && clearTimeout(lateStartCleanupTimer);
        lateStartCleanupTimer = undefined;
        void vscode.debug.stopDebugging(session);
        logger.warn(
          `Stopped debug session '${session.name}' (${session.id}) that started after entry timeout.`,
        );
      });

      const candidateSessions = activeSessions.filter(
        session => !excludeSet.has(session.id),
      );
      void (async () => {
        const snapshots: TimeoutSessionSnapshot[] = [];
        for (const session of candidateSessions) {
          const snapshot: TimeoutSessionSnapshot = {
            id: session.id,
            name: session.name,
            type: session.type,
            workspaceFolder: session.workspaceFolder?.uri.fsPath,
            configurationName: session.configuration?.name,
            request: session.configuration?.request,
            serverReadyAction: session.configuration?.serverReadyAction,
            stopped: false,
          };
          try {
            const stopped = await vscode.debug.stopDebugging(session);
            snapshot.stopped = stopped ?? false;
            if (snapshot.stopped) {
              logger.warn(
                `Stopped debug session '${session.name}' (${session.id}) after entry timeout.`,
              );
            }
          }
          catch (stopErr) {
            snapshot.stopError
              = stopErr instanceof Error ? stopErr.message : String(stopErr);
            logger.warn(
              `Failed to stop session '${session.name}' (${session.id}) after entry timeout: ${snapshot.stopError}`,
            );
          }
          snapshots.push(snapshot);
        }
        const timeoutError = new EntryStopTimeoutError(
          `Timed out waiting for initial stopped event (${timeout}ms). Debug adapter did not pause (no entry/breakpoint/step/exception).`,
          {
            timeoutMs: timeout,
            sessions: snapshots,
          },
        );
        reject(timeoutError);
      })();
    }, timeout);
  });
}
