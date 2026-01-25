import type { Buffer } from "node:buffer";
import type {
  BreakpointDefinition,
  FunctionBreakpointDefinition,
} from "./BreakpointDefinition";
import type { BreakpointHitInfo } from "./common";
import type { DebugContext, VariableInfo } from "./debugUtils";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import * as process from "node:process";
import stripAnsi from "strip-ansi";
import * as vscode from "vscode";
import { activeSessions } from "./common";
import { config } from "./config";
import { DAPHelpers } from "./debugUtils";
import {
  createStopWaiterBySessionId,
  EntryStopTimeoutError,
  getSessionCapabilities,
  getSessionExitCode,
  getSessionOutput,
  waitForEntryStop,
} from "./events";
import { logger } from "./logger";

const typescriptCliPath = (() => {
  try {
    return require.resolve("typescript/lib/tsc.js");
  }
  catch {
    return undefined;
  }
})();

function normalizeFsPath(value: string) {
  // Normalize path, convert backslashes, strip trailing slashes.
  // On Windows, make comparison case-insensitive by lowercasing drive letter + entire path.
  const normalized = path
    .normalize(value)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function reorderScopesForCapture<T extends { name?: string }>(scopes: T[]): T[] {
  const locals: T[] = [];
  const others: T[] = [];
  for (const scope of scopes) {
    const name = scope?.name?.trim();
    if (name && /^locals?$/i.test(name)) {
      locals.push(scope);
    }
    else {
      others.push(scope);
    }
  }
  return [...locals, ...others];
}

async function captureScopeVariables(params: {
  session: vscode.DebugSession
  scopes: Array<{ name?: string, variablesReference: number }>
}): Promise<ScopeVariables[]> {
  const { session, scopes } = params;
  const scopeVariables: ScopeVariables[] = [];
  for (const scope of scopes) {
    const variables = await DAPHelpers.getVariablesFromReference(
      session,
      scope.variablesReference,
    );
    scopeVariables.push({ scopeName: scope.name ?? "Scope", variables });
  }
  return scopeVariables;
}

async function customRequestAndWaitForStop(params: {
  session: vscode.DebugSession
  sessionId: string
  command: "continue" | "next"
  threadId: number
  timeout: number
  failureMessage: string
}): Promise<BreakpointHitInfo> {
  const { session, sessionId, command, threadId, timeout, failureMessage }
    = params;
  const waiter = createStopWaiterBySessionId({ sessionId, timeout });
  try {
    await session.customRequest(command, { threadId });
    return await waiter.promise;
  }
  catch (e) {
    waiter.dispose();
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${failureMessage}: ${msg}`);
  }
}

/**
 * Resume execution without awaiting the next stop.
 *
 * This is intentionally used for onHit=captureAndContinue, where the tool returns
 * immediately while the debuggee keeps running. Any subsequent stop is handled by
 * later tool calls.
 */
async function tryContinueWithoutWaiting(params: {
  session: vscode.DebugSession
  threadId: number
  failureContext: string
}): Promise<void> {
  const { session, threadId, failureContext } = params;
  try {
    logger.debug(
      `Continuing debug session ${session.id} (${session.name}) without waiting (${failureContext}).`,
    );
    await session.customRequest("continue", { threadId });
  }
  catch (continueErr) {
    logger.warn(
      `Failed to continue ${failureContext}: ${
        continueErr instanceof Error ? continueErr.message : String(continueErr)
      }`,
    );
  }
}

async function waitForSessionCapabilities(params: {
  sessionId: string
  timeoutMs: number
}): Promise<Record<string, unknown> | undefined> {
  const { sessionId, timeoutMs } = params;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const caps = getSessionCapabilities(sessionId);
    if (caps && typeof caps === "object") {
      return caps as Record<string, unknown>;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const caps = getSessionCapabilities(sessionId);
  return caps && typeof caps === "object" ? (caps as Record<string, unknown>) : undefined;
}

async function startDebuggingWithTimeout(params: {
  folder: vscode.WorkspaceFolder
  resolvedConfig: vscode.DebugConfiguration
  timeoutMs: number
  failureContext: string
}): Promise<boolean> {
  const { folder, resolvedConfig, timeoutMs, failureContext } = params;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<boolean>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for VS Code to start debugging (${timeoutMs}ms) (${failureContext}). This can happen if a debug adapter is stuck or a UI prompt is blocking the extension host.`,
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      vscode.debug.startDebugging(folder, resolvedConfig),
      timeoutPromise,
    ]);
  }
  finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Variables grouped by scope
 */
export interface ScopeVariables {
  scopeName: string
  variables: VariableInfo[]
  error?: string
}

export type ServerReadyPhase = "entry" | "late" | "immediate";

export type ServerReadyPatternSource = "debugOutput" | "terminal";

export interface ServerReadyPhaseInfo {
  phase: ServerReadyPhase
  timestamp: number
}

export interface ServerReadyInfo {
  configured: boolean
  triggerMode: "pattern" | "breakpoint" | "immediate" | "disabled"
  phases: ServerReadyPhaseInfo[]
  triggerSummary?: string
}

export type DebuggerStateStatus = "paused" | "running" | "terminated";

export type CopilotDebuggerToolAction
  = | "startDebugSessionWithBreakpoints"
    | "resumeDebugSession"
    | "stopDebugSession"
    | "getVariables"
    | "expandVariable"
    | "evaluateExpression"
    | "externalHttpRequest"
    | "externalShellCommand"
    | "browserNavigation"
    | "fetchWebpage";

export interface CopilotDebuggerProtocol {
  /**
   * Explicit allowlist/denylist that the model can pattern-match.
   *
   * - When paused: only debugger operations are allowed.
   * - When running: external probes may be okay.
   */
  allowedNextActions: CopilotDebuggerToolAction[]
  forbiddenNextActions: CopilotDebuggerToolAction[]
  nextStepSuggestion: string
}

export interface DebuggerStateSnapshot {
  status: DebuggerStateStatus
  sessionId?: string
  sessionName?: string
}

export interface RuntimeOutputPreview {
  lines: string[]
  totalLines: number
  truncated: boolean
}

/**
 * Call stack information for a debug session
 */
export interface CallStackInfo {
  callStacks: Array<{
    sessionId: string
    sessionName: string
    threads?: Array<{
      threadId: number
      threadName: string
      stackFrames?: Array<{
        id: number
        name: string
        source?: {
          name?: string
          path?: string
        }
        line: number
        column: number
      }>
      error?: string
    }>
    error?: string
  }>
}

/**
 * Structured debug information returned when a breakpoint is hit
 */
export interface DebugInfo {
  breakpoint: BreakpointHitInfo
  callStack: CallStackInfo | null
  variables: ScopeVariables[] | null
  variablesError: string | null
}

/**
 * Result from starting a debug session
 */
export interface StartDebugSessionResult {
  content: Array<{
    type: "text" | "json"
    text?: string
    json?: DebugInfo
  }>
  isError: boolean
}

export interface StartDebuggerStopInfo extends DebugContext {
  scopeVariables: ScopeVariables[]
  stepOverCapture?: {
    performed: boolean
    fromLine?: number
    toLine?: number
    before: ScopeVariables[]
    after: ScopeVariables[]
  }
  hitBreakpoint?: BreakpointDefinition
  hitFunctionBreakpoint?: FunctionBreakpointDefinition
  capturedLogMessages?: string[]
  serverReadyInfo: ServerReadyInfo
  debuggerState: DebuggerStateSnapshot
  protocol: CopilotDebuggerProtocol
  runtimeOutput: RuntimeOutputPreview
  reason?: string
  exceptionInfo?: {
    description: string
    details: string
  }
}

function buildProtocol(state: DebuggerStateSnapshot): CopilotDebuggerProtocol {
  const sessionId = state.sessionId ?? "unknown";
  if (state.status === "paused") {
    return {
      allowedNextActions: [
        "evaluateExpression",
        "getVariables",
        "expandVariable",
        "resumeDebugSession",
        "stopDebugSession",
      ],
      forbiddenNextActions: [
        "externalHttpRequest",
        "externalShellCommand",
        "browserNavigation",
        "fetchWebpage",
      ],
      nextStepSuggestion: `Session is paused. Inspect state using debugger tools, then resume. Suggested next call: resumeDebugSession(sessionId='${sessionId}').`,
    };
  }
  if (state.status === "running") {
    return {
      allowedNextActions: [
        "resumeDebugSession",
        "stopDebugSession",
        "externalHttpRequest",
        "externalShellCommand",
        "browserNavigation",
        "fetchWebpage",
      ],
      forbiddenNextActions: [],
      nextStepSuggestion:
        "Session is running. You may run external probes if needed, or use resumeDebugSession to add more breakpoints and wait for the next stop.",
    };
  }
  return {
    allowedNextActions: ["startDebugSessionWithBreakpoints"],
    forbiddenNextActions: [
      "resumeDebugSession",
      "getVariables",
      "expandVariable",
      "evaluateExpression",
      "externalHttpRequest",
      "externalShellCommand",
      "browserNavigation",
      "fetchWebpage",
    ],
    nextStepSuggestion:
      "Session is terminated. Start a new session with startDebugSessionWithBreakpoints.",
  };
}

/**
 * List all active debug sessions in the workspace.
 *
 * Exposes debug session information, including each session's ID, name, and associated launch configuration.
 */
export function listDebugSessions() {
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
        type: "json",
        json: { sessions },
      },
    ],
    isError: false,
  };
}

export interface DebugSessionListItem {
  /**
   * 1-based stable identifier within the current listing.
   *
   * Intended for LLM ergonomics: you can pass this value to stopDebugSession(sessionId)
   * as an alternative to the VS Code session UUID.
   */
  toolId: number
  /**
   * Stop-compatible identifier.
   *
   * IMPORTANT: This must be usable as input to stopDebugSession(sessionId).
   */
  id: string
  name: string
  isActive: boolean
  configurationType?: string
  request?: string
}

export function mapDebugSessionsForTool(params: {
  sessions: Array<{ id?: string, name?: string, configuration?: unknown }>
  activeSessionId?: string
}): DebugSessionListItem[] {
  const { sessions, activeSessionId } = params;
  return sessions
    .map((session, index) => {
      const id = typeof session.id === "string" ? session.id : "";
      const name = typeof session.name === "string" ? session.name : "";
      const configuration
        = session.configuration && typeof session.configuration === "object"
          ? (session.configuration as Record<string, unknown>)
          : undefined;

      const configurationType
        = typeof configuration?.type === "string"
          ? configuration.type
          : undefined;
      const request
        = typeof configuration?.request === "string"
          ? configuration.request
          : undefined;

      return {
        toolId: index + 1,
        id,
        name,
        isActive: !!activeSessionId && id === activeSessionId,
        configurationType,
        request,
      } satisfies DebugSessionListItem;
    })
    .filter(item => item.id.trim().length > 0);
}

/**
 * Session listing intended for LLM consumption.
 *
 * This returns ONLY ids that are valid inputs to stopDebugSession(sessionId).
 */
export function listDebugSessionsForTool(): string {
  const activeId = vscode.debug.activeDebugSession?.id;
  const items = mapDebugSessionsForTool({
    sessions: activeSessions,
    activeSessionId: activeId,
  });
  return JSON.stringify({ sessions: items }, null, 2);
}

function collectBuildDiagnostics(workspaceUri: vscode.Uri, maxErrors: number): vscode.Diagnostic[] {
  const allDiagnostics = vscode.languages.getDiagnostics();
  const errors: vscode.Diagnostic[] = [];
  for (const [uri, diagnostics] of allDiagnostics) {
    if (!uri.fsPath.startsWith(workspaceUri.fsPath)) {
      continue;
    }
    for (const diag of diagnostics) {
      if (diag.severity === vscode.DiagnosticSeverity.Error) {
        errors.push(diag);
        if (errors.length >= maxErrors) {
          return errors;
        }
      }
    }
  }
  return errors;
}

function formatBuildErrors(diagnostics: vscode.Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return "";
  }
  const formatted = diagnostics
    .map((diag) => {
      const line = diag.range.start.line + 1;
      const msg
        = diag.message.length > 80
          ? `${diag.message.slice(0, 80)}...`
          : diag.message;
      return `Line ${line}: ${msg}`;
    })
    .join(", ");
  return `Build errors: [${formatted}]. `;
}

const MAX_CAPTURED_TASK_OUTPUT_LINES = 200;
const MAX_RETURNED_DEBUG_OUTPUT_LINES = 10;

function stripAnsiEscapeCodes(value: string): string {
  return value ? stripAnsi(value) : "";
}

function fireAndForgetHttpRequest(params: {
  url: string
  method: string
  headers?: Record<string, string>
  body?: string
  timeoutMs: number
  onDone?: (statusCode?: number) => void
  onError?: (error: unknown) => void
}) {
  const { url, method, headers, body, timeoutMs, onDone, onError } = params;
  let parsed: URL;
  try {
    parsed = new URL(url);
  }
  catch (err) {
    onError?.(
      new Error(
        `Invalid URL '${url}': ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
    return;
  }

  const isHttps = parsed.protocol === "https:";
  const transport = isHttps ? https : http;

  const req = transport.request(
    {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers,
    },
    (res) => {
      // Drain data to free socket; we don't need to buffer the body.
      res.on("data", () => {});
      res.on("end", () => {
        onDone?.(res.statusCode);
      });
    },
  );

  req.on("error", (err) => {
    onError?.(err);
  });

  req.setTimeout(timeoutMs, () => {
    try {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    }
    catch (err) {
      onError?.(err);
    }
  });

  if (body) {
    req.write(body);
  }
  req.end();
}

interface TaskCompletionResult {
  name: string
  exitCode?: number
  outputLines: string[]
  taskExecution?: vscode.TaskExecution
}

const missingCommandPatterns = [
  /is not recognized as an internal or external command/i,
  /command not found/i,
];

function formatTaskFailures(tasks: TaskCompletionResult[]): string {
  const failed = tasks.filter(
    task => typeof task.exitCode === "number" && task.exitCode !== 0,
  );
  if (!failed.length) {
    return "";
  }
  const [primary, ...rest] = failed;
  const lines = primary.outputLines.slice(-5);
  const details = lines.length
    ? `\nLast ${lines.length} line(s):\n${lines
      .map(line => `  ${line}`)
      .join("\n")}`
    : "";
  const additional = rest.length
    ? `\nAdditional failed task(s): ${rest
      .map(task => `'${task.name}' (exit ${task.exitCode ?? "unknown"})`)
      .join(", ")}`
    : "";
  return `Task '${primary.name}' exited with code ${
    primary.exitCode ?? "unknown"
  }.${details}${additional}\n`;
}

function sanitizeTaskOutput(text: string): string[] {
  return stripAnsiEscapeCodes(text)
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0);
}

const DEBUG_TERMINAL_NAME_PATTERN = /\bdebug\b/i;
const SERVER_READY_TERMINAL_PATTERN = /^serverReady-/i;

function truncateLine(line: string, maxLength = 160): string {
  if (line.length <= maxLength) {
    return line;
  }
  return `${line.slice(0, maxLength - 1)}…`;
}

function truncateSnippet(snippet: string, maxLength = 80): string {
  return truncateLine(snippet.replace(/\s+/g, " ").trim(), maxLength);
}

function findAllLineNumbersForSnippet(doc: vscode.TextDocument, snippet: string): number[] {
  const text = doc.getText();
  if (!snippet || !snippet.trim()) {
    return [];
  }
  const needles = snippet;
  const lines = new Set<number>();
  let fromIndex = 0;
  while (fromIndex <= text.length) {
    const idx = text.indexOf(needles, fromIndex);
    if (idx === -1) {
      break;
    }
    const pos = doc.positionAt(idx);
    lines.add(pos.line + 1); // 1-based
    // Ensure forward progress even for empty needles (guarded above) or repeated matches.
    fromIndex = idx + Math.max(1, needles.length);
  }
  return Array.from(lines).sort((a, b) => a - b);
}

interface TerminalOutputCapture {
  snapshot: () => string[]
  dispose: () => void
}

interface TerminalOutputCaptureOptions {
  onLine?: (line: string) => void
}

export function createTerminalOutputCapture(maxLines: number, options?: TerminalOutputCaptureOptions): TerminalOutputCapture {
  type TerminalShellWindow = typeof vscode.window & {
    onDidStartTerminalShellExecution?: vscode.Event<vscode.TerminalShellExecutionStartEvent>
    onDidEndTerminalShellExecution?: vscode.Event<vscode.TerminalShellExecutionEndEvent>
  };
  const terminalShellWindow = vscode.window as TerminalShellWindow;
  const startEvent = terminalShellWindow.onDidStartTerminalShellExecution;
  const endEvent = terminalShellWindow.onDidEndTerminalShellExecution;
  if (
    maxLines <= 0
    || typeof startEvent !== "function"
    || typeof endEvent !== "function"
  ) {
    return { snapshot: () => [], dispose: () => undefined };
  }
  const lines: string[] = [];
  const pendingByTerminal = new Map<vscode.Terminal, string>();
  const trackedTerminals = new Set<vscode.Terminal>();
  const initialTerminals = new Set(vscode.window.terminals);
  const activeExecutions = new Map<
    vscode.TerminalShellExecution,
    vscode.Terminal
  >();
  const pumpTasks = new Set<Promise<void>>();
  const pushLine = (terminal: vscode.Terminal, raw: string) => {
    const sanitized = stripAnsiEscapeCodes(raw).trim();
    if (!sanitized) {
      return;
    }
    const formatted = `${terminal.name}: ${truncateLine(sanitized)}`;
    lines.push(formatted);
    if (options?.onLine) {
      try {
        options.onLine(sanitized);
      }
      catch (callbackErr) {
        logger.warn(
          `terminal capture onLine callback failed: ${
            callbackErr instanceof Error
              ? callbackErr.message
              : String(callbackErr)
          }`,
        );
      }
    }
    if (lines.length > maxLines) {
      lines.shift();
    }
  };
  const appendChunk = (terminal: vscode.Terminal, chunk: string) => {
    const combined = (pendingByTerminal.get(terminal) ?? "") + chunk;
    const segments = combined.split(/\r?\n/);
    pendingByTerminal.set(terminal, segments.pop() ?? "");
    for (const segment of segments) {
      pushLine(terminal, segment);
    }
  };
  const considerTerminal = (terminal: vscode.Terminal): boolean => {
    if (trackedTerminals.has(terminal)) {
      return true;
    }
    if (
      !initialTerminals.has(terminal)
      || DEBUG_TERMINAL_NAME_PATTERN.test(terminal.name)
      || SERVER_READY_TERMINAL_PATTERN.test(terminal.name)
    ) {
      trackedTerminals.add(terminal);
      return true;
    }
    return false;
  };
  const flushPending = (terminal?: vscode.Terminal) => {
    if (terminal) {
      const remainder = pendingByTerminal.get(terminal);
      if (remainder && remainder.trim()) {
        pushLine(terminal, remainder);
      }
      pendingByTerminal.delete(terminal);
      return;
    }
    for (const tracked of Array.from(pendingByTerminal.keys())) {
      flushPending(tracked);
    }
  };
  const disposables: vscode.Disposable[] = [];
  disposables.push(
    vscode.window.onDidOpenTerminal((terminal) => {
      if (
        !initialTerminals.has(terminal)
        || DEBUG_TERMINAL_NAME_PATTERN.test(terminal.name)
        || SERVER_READY_TERMINAL_PATTERN.test(terminal.name)
      ) {
        trackedTerminals.add(terminal);
      }
    }),
  );
  disposables.push(
    startEvent((event) => {
      if (!considerTerminal(event.terminal)) {
        return;
      }
      let stream: AsyncIterable<string>;
      try {
        stream = event.execution.read();
      }
      catch (err) {
        logger.warn(
          `Failed to read terminal shell execution data: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return;
      }
      activeExecutions.set(event.execution, event.terminal);
      const pump = (async () => {
        try {
          for await (const chunk of stream) {
            if (!chunk) {
              continue;
            }
            appendChunk(event.terminal, chunk);
          }
        }
        catch (streamErr) {
          logger.warn(
            `Terminal shell execution stream failed: ${
              streamErr instanceof Error ? streamErr.message : String(streamErr)
            }`,
          );
        }
        finally {
          activeExecutions.delete(event.execution);
        }
      })();
      pumpTasks.add(pump);
      void pump.finally(() => pumpTasks.delete(pump));
    }),
  );
  disposables.push(
    endEvent((event) => {
      const terminal = activeExecutions.get(event.execution) ?? event.terminal;
      if (!terminal || !trackedTerminals.has(terminal)) {
        return;
      }
      flushPending(terminal);
    }),
  );
  return {
    snapshot: () => {
      flushPending();
      return [...lines];
    },
    dispose: () => {
      flushPending();
      while (disposables.length) {
        disposables.pop()?.dispose();
      }
      pumpTasks.clear();
      trackedTerminals.clear();
    },
  };
}

function formatRuntimeDiagnosticsMessage(baseMessage: string, options: { sessionId?: string, terminalLines: string[], maxLines: number }): string {
  const { sessionId, terminalLines, maxLines } = options;
  const sections: string[] = [];
  if (sessionId) {
    const exitCode = getSessionExitCode(sessionId);
    if (typeof exitCode === "number") {
      sections.push(`exit code: ${exitCode}`);
    }
    const sessionOutput = getSessionOutput(sessionId);
    if (sessionOutput.length) {
      const stderrLines = sessionOutput
        .filter(line => line.category === "stderr")
        .slice(-maxLines)
        .map(line => truncateLine(stripAnsiEscapeCodes(line.text).trim()))
        .filter(line => line.length > 0);
      if (stderrLines.length) {
        sections.push(`stderr: ${stderrLines.join(" | ")}`);
      }
      else {
        const otherLines = sessionOutput
          .slice(-maxLines)
          .map(
            line =>
              `${line.category}: ${truncateLine(
                stripAnsiEscapeCodes(line.text).trim(),
              )}`,
          )
          .filter(line => line.length > 0);
        if (otherLines.length) {
          sections.push(`output: ${otherLines.join(" | ")}`);
        }
      }
    }
  }
  const sanitizedTerminal = terminalLines
    .slice(-maxLines)
    .map(line => truncateLine(stripAnsiEscapeCodes(line).trim()))
    .filter(line => line.length > 0);
  if (sanitizedTerminal.length) {
    sections.push(`terminal: ${sanitizedTerminal.join(" | ")}`);
  }
  if (!sections.length) {
    return baseMessage;
  }
  return `${baseMessage}\nRuntime diagnostics:\n- ${sections.join("\n- ")}`;
}

function resolveCwd(cwd: string | undefined, baseDir: string) {
  if (!cwd) {
    return baseDir;
  }
  return path.isAbsolute(cwd) ? cwd : path.join(baseDir, cwd);
}

function collectNodeBinDirs(startDir: string) {
  const bins: string[] = [];
  let current = startDir;
  const seen = new Set<string>();
  const parsed = path.parse(startDir);
  while (!seen.has(current)) {
    seen.add(current);
    const candidate = path.join(current, "node_modules", ".bin");
    if (fs.existsSync(candidate)) {
      bins.push(candidate);
    }
    if (current === parsed.root) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return bins;
}

function mergeEnv(baseDir: string, env?: Record<string, string>, existingBins?: string[]): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
  };
  const binDirs = existingBins ?? collectNodeBinDirs(baseDir);
  if (binDirs.length) {
    const existingKey = Object.keys(merged).find(
      key => key.toLowerCase() === "path",
    );
    const pathKey
      = existingKey || (process.platform === "win32" ? "Path" : "PATH");
    const current = merged[pathKey] ?? "";
    const segments = current
      ? current.split(path.delimiter).filter(segment => segment.length > 0)
      : [];
    for (let i = binDirs.length - 1; i >= 0; i -= 1) {
      const dir = binDirs[i];
      if (!segments.includes(dir)) {
        segments.unshift(dir);
      }
    }
    merged[pathKey] = segments.join(path.delimiter);
    logger.debug(
      `Augmented PATH for diagnostic capture with ${binDirs.length} node_modules/.bin directories(s).`,
    );
  }
  return merged;
}

function coerceOutput(value?: string | Buffer | null) {
  if (typeof value === "string") {
    return value;
  }
  return value ? value.toString("utf-8") : "";
}

function resolveCommandFromBins(command: string, binDirs: string[]) {
  if (/[\\/\s]/.test(command)) {
    return undefined;
  }
  const extensions
    = process.platform === "win32" ? [".cmd", ".bat", ".exe", ""] : ["", ".sh"];
  for (const dir of binDirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function isTscCommand(command: string) {
  const normalized = path.basename(command).toLowerCase();
  return normalized === "tsc" || normalized === "tsc.cmd";
}

function isNodeCommand(command: string) {
  const normalized = path.basename(command).toLowerCase();
  return normalized === "node" || normalized === "node.exe";
}

function trimWrappedQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseShellCommandLine(commandLine: string) {
  const tokens = commandLine.match(/"[^"]+"|'[^']+'|\S+/g);
  if (!tokens || tokens.length === 0) {
    return undefined;
  }
  const normalized = tokens.map(token => trimWrappedQuotes(token));
  return {
    command: normalized[0],
    args: normalized.slice(1),
  };
}

function shouldRetryWithNpx(command: string, result: ReturnType<typeof spawnSync>) {
  if (/[\\/\s]/.test(command)) {
    return false;
  }
  const err = result.error as NodeJS.ErrnoException | undefined;
  if (err && err.code === "ENOENT") {
    return true;
  }
  const stderr = (result.stderr ?? "").toString();
  return missingCommandPatterns.some(pattern => pattern.test(stderr));
}

function runCommandForDiagnostics(command: string, args: string[], options: Parameters<typeof spawnSync>[2], binDirs: string[]) {
  let resolvedCommand = command;
  let resolvedArgs = args;
  let routedToTypescript = false;
  if (isNodeCommand(command) && !/[\\/\s]/.test(command)) {
    // In extension hosts (especially during tests), PATH can be restricted.
    // Use the Node runtime running the extension host to make diagnostic capture deterministic.
    resolvedCommand = process.execPath;
  }
  else if (typescriptCliPath && isTscCommand(command)) {
    resolvedCommand = process.execPath;
    resolvedArgs = [typescriptCliPath, ...args];
    routedToTypescript = true;
  }
  else {
    resolvedCommand = resolveCommandFromBins(command, binDirs) ?? command;
  }

  // In VS Code extension hosts (especially test runs), process.execPath may include spaces and
  // parentheses (e.g. "Code Helper (Plugin)"). If we pass shell:true, Node wraps in /bin/sh -c
  // and the unquoted parens cause syntax errors. When we explicitly route to process.execPath,
  // always run it directly without a shell.
  const effectiveOptions
    = options?.shell === true && resolvedCommand === process.execPath
      ? { ...options, shell: false }
      : options;

  const direct = spawnSync(resolvedCommand, resolvedArgs, effectiveOptions);
  if (routedToTypescript || !shouldRetryWithNpx(command, direct)) {
    return direct;
  }
  logger.warn(
    `Command '${command}' unavailable when capturing diagnostics. Retrying via npx.`,
  );
  const npxExecutable = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnSync(npxExecutable, [command, ...args], {
    ...options,
    shell: true,
  });
}

function collectTypescriptCliOutput(cwd: string) {
  if (!typescriptCliPath) {
    return [];
  }
  try {
    const result = spawnSync(
      process.execPath,
      [typescriptCliPath, "--noEmit", "--pretty", "false"],
      {
        cwd,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
      },
    );
    const lines = [
      ...sanitizeTaskOutput(coerceOutput(result.stdout)),
      ...sanitizeTaskOutput(coerceOutput(result.stderr)),
    ];
    return lines.slice(-MAX_CAPTURED_TASK_OUTPUT_LINES);
  }
  catch (err) {
    logger.warn(
      `Failed to collect TypeScript CLI output: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

function captureShellExecutionOutput(execution: vscode.ShellExecution, baseCwd: string): string[] {
  const cwd = resolveCwd(execution.options?.cwd, baseCwd);
  const binDirs = collectNodeBinDirs(baseCwd);
  const env = mergeEnv(baseCwd, execution.options?.env, binDirs);
  const workspaceFolderVar = "$" + "{workspaceFolder}";
  const substitute = (value: string) =>
    value.replaceAll(workspaceFolderVar, baseCwd);
  let result: ReturnType<typeof spawnSync> | undefined;
  if (execution.command) {
    const command
      = typeof execution.command === "string"
        ? substitute(execution.command)
        : execution.command.value;
    const args = (execution.args || []).map((arg) => {
      const raw = typeof arg === "string" ? arg : arg.value;
      return substitute(raw);
    });
    result = runCommandForDiagnostics(
      command,
      args,
      {
        cwd,
        env,
        shell: process.platform === "win32",
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
      },
      binDirs,
    );
  }
  else if (execution.commandLine) {
    const parsed = parseShellCommandLine(substitute(execution.commandLine));
    if (parsed) {
      result = runCommandForDiagnostics(
        substitute(parsed.command),
        parsed.args.map(arg => substitute(arg)),
        {
          cwd,
          env,
          shell: process.platform === "win32",
          encoding: "utf-8",
          maxBuffer: 1024 * 1024,
        },
        binDirs,
      );
    }
    else {
      result = spawnSync(execution.commandLine, {
        cwd,
        env,
        shell: true,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
      });
    }
  }
  if (!result) {
    return [];
  }
  const lines = [
    ...sanitizeTaskOutput(coerceOutput(result.stdout)),
    ...sanitizeTaskOutput(coerceOutput(result.stderr)),
  ];
  return lines.slice(-MAX_CAPTURED_TASK_OUTPUT_LINES);
}

function captureProcessExecutionOutput(execution: vscode.ProcessExecution, baseCwd: string): string[] {
  const cwd = resolveCwd(execution.options?.cwd, baseCwd);
  const binDirs = collectNodeBinDirs(baseCwd);
  const env = mergeEnv(baseCwd, execution.options?.env, binDirs);
  const workspaceFolderVar = "$" + "{workspaceFolder}";
  const substitute = (value: string) =>
    value.replaceAll(workspaceFolderVar, baseCwd);
  const result = runCommandForDiagnostics(
    substitute(execution.process),
    (execution.args || []).map(arg => substitute(String(arg))),
    {
      cwd,
      env,
      shell: process.platform === "win32",
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
    },
    binDirs,
  );
  const lines = [
    ...sanitizeTaskOutput(coerceOutput(result.stdout)),
    ...sanitizeTaskOutput(coerceOutput(result.stderr)),
  ];
  return lines.slice(-MAX_CAPTURED_TASK_OUTPUT_LINES);
}

function captureTaskOutputLines(taskExecution: vscode.TaskExecution, baseCwd: string): string[] {
  const execution = taskExecution.task.execution;
  if (!execution) {
    logger.warn(
      `Task ${taskExecution.task.name} does not expose execution details; unable to capture output.`,
    );
    return [];
  }
  const isShellExecution = (
    candidate: typeof execution,
  ): candidate is vscode.ShellExecution => {
    const shellCandidate = candidate as vscode.ShellExecution;
    return (
      typeof shellCandidate.commandLine === "string"
      || typeof shellCandidate.command !== "undefined"
    );
  };
  const isProcessExecution = (
    candidate: typeof execution,
  ): candidate is vscode.ProcessExecution => {
    return typeof (candidate as vscode.ProcessExecution).process === "string";
  };
  try {
    if (isShellExecution(execution)) {
      return captureShellExecutionOutput(execution, baseCwd);
    }
    if (isProcessExecution(execution)) {
      return captureProcessExecutionOutput(execution, baseCwd);
    }
    logger.warn(
      `Task ${taskExecution.task.name} uses unsupported execution type; unable to capture output.`,
    );
  }
  catch (err) {
    logger.warn(
      `Failed to capture task output for ${taskExecution.task.name}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return [];
}

async function captureTaskOutputLinesAsync(taskExecution: vscode.TaskExecution, baseCwd: string): Promise<string[]> {
  const direct = captureTaskOutputLines(taskExecution, baseCwd);
  if (direct.length > 0) {
    return direct;
  }

  // Task executions may not expose enough execution detail (or may be a non-shell execution type).
  // When direct capture yields no output, resolve the original task definition and try again.

  try {
    const allTasks = await vscode.tasks.fetchTasks();
    const scope = taskExecution.task.scope;
    const scopedTasks = allTasks.filter((candidate) => {
      if (candidate.name !== taskExecution.task.name) {
        return false;
      }
      if (typeof scope === "number") {
        return candidate.scope === scope;
      }
      if (scope && typeof scope === "object") {
        return (
          candidate.scope
          && typeof candidate.scope === "object"
          && candidate.scope.uri.fsPath === scope.uri.fsPath
        );
      }
      return true;
    });

    const resolvedTask = scopedTasks.length
      ? scopedTasks[0]
      : allTasks.find(
          candidate => candidate.name === taskExecution.task.name,
        );
    const resolvedExecution = resolvedTask?.execution;
    if (!resolvedExecution) {
      // Fall through to tasks.json parsing below.
    }
    else {
      const isShellExecution = (
        candidate: typeof resolvedExecution,
      ): candidate is vscode.ShellExecution => {
        const shellCandidate = candidate as vscode.ShellExecution;
        return (
          typeof shellCandidate.commandLine === "string"
          || typeof shellCandidate.command !== "undefined"
        );
      };
      const isProcessExecution = (
        candidate: typeof resolvedExecution,
      ): candidate is vscode.ProcessExecution => {
        return (
          typeof (candidate as vscode.ProcessExecution).process === "string"
        );
      };
      if (isShellExecution(resolvedExecution)) {
        return captureShellExecutionOutput(resolvedExecution, baseCwd);
      }
      if (isProcessExecution(resolvedExecution)) {
        return captureProcessExecutionOutput(resolvedExecution, baseCwd);
      }
    }
  }
  catch (err) {
    logger.warn(
      `Failed to resolve task definition for output capture (${taskExecution.task.name}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // Deterministic capture: parse .vscode/tasks.json for this workspace folder.
  // This helps in VS Code test environments where task execution details can be unavailable.
  try {
    const tasksJsonPath = path.join(baseCwd, ".vscode", "tasks.json");
    if (!fs.existsSync(tasksJsonPath)) {
      return [];
    }
    const raw = fs.readFileSync(tasksJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      tasks?: Array<{
        label?: string
        command?: string
        args?: unknown[]
      }>
    };
    const task = parsed.tasks?.find(t => t.label === taskExecution.task.name);
    if (!task?.command) {
      return [];
    }
    const workspaceFolderVar = "$" + "{workspaceFolder}";
    const substitute = (value: string) =>
      value.replaceAll(workspaceFolderVar, baseCwd);
    const command = substitute(task.command);
    const args = (task.args ?? []).map(arg => substitute(String(arg)));
    const binDirs = collectNodeBinDirs(baseCwd);
    const env = mergeEnv(baseCwd, undefined, binDirs);
    const result = runCommandForDiagnostics(
      command,
      args,
      {
        cwd: baseCwd,
        env,
        shell: process.platform === "win32",
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
      },
      binDirs,
    );
    const lines = [
      ...sanitizeTaskOutput(coerceOutput(result.stdout)),
      ...sanitizeTaskOutput(coerceOutput(result.stderr)),
    ];
    return lines.slice(-MAX_CAPTURED_TASK_OUTPUT_LINES);
  }
  catch (err) {
    logger.warn(
      `Failed to capture task output via tasks.json (${taskExecution.task.name}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return [];
}

function monitorTask(taskExecution: vscode.TaskExecution, baseCwd: string): Promise<TaskCompletionResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const disposables: vscode.Disposable[] = [];
    const cleanup = () => {
      while (disposables.length) {
        disposables.pop()?.dispose();
      }
    };
    const complete = (result: TaskCompletionResult) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    disposables.push(
      vscode.tasks.onDidEndTaskProcess((event) => {
        if (event.execution === taskExecution) {
          const exitCode = event.exitCode ?? undefined;
          if (typeof exitCode === "number" && exitCode !== 0) {
            captureTaskOutputLinesAsync(taskExecution, baseCwd)
              .then((outputLines) => {
                complete({
                  name: taskExecution.task.name,
                  exitCode,
                  outputLines,
                  taskExecution,
                });
              })
              .catch((err) => {
                logger.warn(
                  `Failed to capture task output for ${taskExecution.task.name}: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                );
                complete({
                  name: taskExecution.task.name,
                  exitCode,
                  outputLines: [],
                  taskExecution,
                });
              });
            return;
          }

          complete({
            name: taskExecution.task.name,
            exitCode,
            outputLines: [],
            taskExecution,
          });
        }
      }),
    );

    disposables.push(
      vscode.tasks.onDidEndTask((event) => {
        if (event.execution === taskExecution) {
          captureTaskOutputLinesAsync(taskExecution, baseCwd)
            .then((outputLines) => {
              complete({
                name: taskExecution.task.name,
                exitCode: outputLines.length ? 1 : undefined,
                outputLines,
                taskExecution,
              });
            })
            .catch(() => {
              complete({
                name: taskExecution.task.name,
                exitCode: undefined,
                outputLines: [],
                taskExecution,
              });
            });
        }
      }),
    );

    disposables.push(
      vscode.tasks.onDidStartTaskProcess((event) => {
        if (
          event.execution === taskExecution
          && event.processId === undefined
        ) {
          fail(
            new Error(
              `Failed to start task ${taskExecution.task.name}. Terminal could not be created.`,
            ),
          );
        }
      }),
    );
  });
}

/**
 * Start a new debug session using either a named configuration from .vscode/launch.json or a direct configuration object,
 * then wait until a breakpoint is hit before returning with detailed debug information.
 *
 * @param params - Object containing workspaceFolder, nameOrConfiguration, and optional variable.
 * @param params.sessionName - Name to assign to the debug session.
 * @param params.workspaceFolder - Absolute path to the workspace folder where the debug session will run.
 * @param params.nameOrConfiguration - Either a string name of a launch configuration or a DebugConfiguration object.
 * @param params.timeoutSeconds - Optional timeout in seconds to wait for a breakpoint hit (default: 60).
 * @param params.breakpointConfig - Optional configuration for managing breakpoints during the debug session.
 * @param params.breakpointConfig.breakpoints - Array of breakpoint configurations to set before starting the session.
 * @param params.serverReady - Optional server readiness automation descriptor.
 * @param params.serverReady.trigger - Optional readiness trigger (breakpoint path+line or pattern). If omitted and request==='attach', action executes immediately post-attach.
 * @param params.serverReady.trigger.path - Breakpoint file path.
 * @param params.serverReady.trigger.line - Breakpoint 1-based line number.
 * @param params.serverReady.trigger.pattern - Regex pattern for output readiness via injected serverReadyAction.
 * @param params.serverReady.action - Action executed when ready (one of: { shellCommand }, { httpRequest }, { vscodeCommand }).
 * @param params.useExistingBreakpoints - When true, caller intends to use already-set workspace breakpoints (manual command).
 */
export interface StartDebuggingAndWaitForStopParams {
  sessionName: string
  workspaceFolder: string // absolute path to open workspace folder
  nameOrConfiguration?: string // may be omitted; auto-selection logic will attempt resolution
  timeoutSeconds?: number // optional override; falls back to workspace setting copilot-debugger.entryTimeoutSeconds
  /**
   * Tool mode:
   * - 'singleShot' (default): tool will terminate the debug session before returning.
   * - 'inspect': tool may return with the session paused so the caller can inspect state and resume.
   */
  mode?: "singleShot" | "inspect"
  breakpointConfig: {
    breakpoints?: Array<BreakpointDefinition>
    functionBreakpoints?: Array<FunctionBreakpointDefinition>
  }
  serverReady?: {
    trigger?: { path?: string, line?: number, pattern?: string }
    action:
      | { shellCommand: string }
      | {
        httpRequest: {
          url: string
          method?: string
          headers?: Record<string, string>
          body?: string
        }
      }
      | { vscodeCommand: { command: string, args?: unknown[] } }
      | {
        type: "httpRequest"
        url: string
        method?: string
        headers?: Record<string, string>
        body?: string
      }
      | { type: "shellCommand", shellCommand: string }
      | { type: "vscodeCommand", command: string, args?: unknown[] }
  }
  /**
   * When true, the caller indicates the debug session should use the user's existing breakpoints
   * (e.g. from the UI) instead of prompting for a single file+line. The current implementation expects
   * breakpointConfig to be supplied (the manual command derives it from existing breakpoints) but this flag
   * documents intent and allows future internal logic changes without altering the call sites.
   * Defaults to false.
   */
  useExistingBreakpoints?: boolean
}

function runPreLaunchTaskFromTasksJson(workspaceFolderFsPath: string, taskLabel: string): { exitCode: number | undefined, outputLines: string[] } {
  const tasksJsonPath = path.join(
    workspaceFolderFsPath,
    ".vscode",
    "tasks.json",
  );
  if (!fs.existsSync(tasksJsonPath)) {
    return { exitCode: undefined, outputLines: [] };
  }
  const raw = fs.readFileSync(tasksJsonPath, "utf-8");
  const parsed = JSON.parse(raw) as {
    tasks?: Array<{
      label?: string
      type?: string
      command?: string
      args?: unknown[]
    }>
  };
  const task = parsed.tasks?.find(t => t.label === taskLabel);
  if (!task?.command) {
    return { exitCode: undefined, outputLines: [] };
  }

  const workspaceFolderVar = "$" + "{workspaceFolder}";
  const substitute = (value: string) =>
    value.replaceAll(workspaceFolderVar, workspaceFolderFsPath);

  const command = substitute(task.command);
  const args = (task.args ?? []).map(arg => substitute(String(arg)));
  const binDirs = collectNodeBinDirs(workspaceFolderFsPath);
  const env = mergeEnv(workspaceFolderFsPath, undefined, binDirs);

  // Shell tasks commonly encode a full command line in `command` (e.g. "sleep 5").
  // When we run them ourselves, we must use a shell so the string is interpreted.
  const taskType = typeof task.type === "string" ? task.type.toLowerCase() : "";
  const useShell = taskType === "shell" ? true : process.platform === "win32";

  const result = runCommandForDiagnostics(
    command,
    args,
    {
      cwd: workspaceFolderFsPath,
      env,
      shell: useShell,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
    },
    binDirs,
  );

  const outputLines = [
    ...sanitizeTaskOutput(coerceOutput(result.stdout)),
    ...sanitizeTaskOutput(coerceOutput(result.stderr)),
  ].slice(-MAX_CAPTURED_TASK_OUTPUT_LINES);

  const exitCode
    = typeof result.status === "number"
      ? result.status
      : result.error
        ? 1
        : undefined;

  return { exitCode, outputLines };
}

async function runPreLaunchTaskFromVscodeTasks(params: {
  workspaceFolderFsPath: string
  folder: vscode.WorkspaceFolder
  taskLabel: string
}): Promise<{ exitCode: number | undefined, outputLines: string[] }> {
  const { workspaceFolderFsPath, folder, taskLabel } = params;
  const tasks = await vscode.tasks.fetchTasks();
  const matches = tasks.filter((task) => {
    if (task.name !== taskLabel) {
      return false;
    }
    const scope = task.scope;
    if (!scope || typeof scope !== "object") {
      return false;
    }
    const scopedFolder = scope as vscode.WorkspaceFolder;
    return scopedFolder.uri.fsPath === folder.uri.fsPath;
  });
  if (matches.length === 0) {
    return { exitCode: undefined, outputLines: [] };
  }
  if (matches.length > 1) {
    throw new Error(
      `preLaunchTask '${taskLabel}' is ambiguous: found ${matches.length} tasks with the same name.`,
    );
  }
  const task = matches[0];
  const execution = task.execution as
    | vscode.ShellExecution
    | vscode.ProcessExecution
    | undefined;
  if (!execution) {
    return { exitCode: undefined, outputLines: [] };
  }

  const binDirs = collectNodeBinDirs(workspaceFolderFsPath);
  const env = mergeEnv(
    workspaceFolderFsPath,
    // VS Code task env is additive; mergeEnv already layers process.env + provided overrides.
    (execution.options?.env as Record<string, string> | undefined) ?? undefined,
    binDirs,
  );

  // Prefer the cwd requested by the task, otherwise the workspace folder.
  const cwd = execution.options?.cwd
    ? path.isAbsolute(execution.options.cwd)
      ? execution.options.cwd
      : path.join(workspaceFolderFsPath, execution.options.cwd)
    : workspaceFolderFsPath;

  // ShellExecution in VS Code may be represented as commandLine or command+args.
  const asAny = execution as unknown as Record<string, unknown>;
  const commandLine
    = typeof asAny.commandLine === "string"
      ? (asAny.commandLine as string)
      : undefined;
  if (commandLine && commandLine.trim()) {
    const result = runCommandForDiagnostics(
      commandLine,
      [],
      {
        cwd,
        env,
        shell: true,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
      },
      binDirs,
    );
    const outputLines = [
      ...sanitizeTaskOutput(coerceOutput(result.stdout)),
      ...sanitizeTaskOutput(coerceOutput(result.stderr)),
    ].slice(-MAX_CAPTURED_TASK_OUTPUT_LINES);
    const exitCode
      = typeof result.status === "number"
        ? result.status
        : result.error
          ? 1
          : undefined;
    return { exitCode, outputLines };
  }

  const shellCommand = (execution as vscode.ShellExecution).command;
  const shellArgs = ((execution as vscode.ShellExecution).args ?? []).map(
    arg => String(arg),
  );
  if (shellCommand) {
    const result = runCommandForDiagnostics(
      String(shellCommand),
      shellArgs,
      {
        cwd,
        env,
        shell: process.platform === "win32",
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
      },
      binDirs,
    );
    const outputLines = [
      ...sanitizeTaskOutput(coerceOutput(result.stdout)),
      ...sanitizeTaskOutput(coerceOutput(result.stderr)),
    ].slice(-MAX_CAPTURED_TASK_OUTPUT_LINES);
    const exitCode
      = typeof result.status === "number"
        ? result.status
        : result.error
          ? 1
          : undefined;
    return { exitCode, outputLines };
  }

  const processCommand = (execution as vscode.ProcessExecution).process;
  const processArgs = ((execution as vscode.ProcessExecution).args ?? []).map(
    arg => String(arg),
  );
  if (processCommand) {
    const result = runCommandForDiagnostics(
      String(processCommand),
      processArgs,
      {
        cwd,
        env,
        shell: false,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
      },
      binDirs,
    );
    const outputLines = [
      ...sanitizeTaskOutput(coerceOutput(result.stdout)),
      ...sanitizeTaskOutput(coerceOutput(result.stderr)),
    ].slice(-MAX_CAPTURED_TASK_OUTPUT_LINES);
    const exitCode
      = typeof result.status === "number"
        ? result.status
        : result.error
          ? 1
          : undefined;
    return { exitCode, outputLines };
  }

  return { exitCode: undefined, outputLines: [] };
}

async function runPreLaunchTaskManually(params: {
  workspaceFolderFsPath: string
  folder: vscode.WorkspaceFolder
  taskLabel: string
}): Promise<{ exitCode: number | undefined, outputLines: string[] }> {
  const { workspaceFolderFsPath, folder, taskLabel } = params;

  const fromTasksJson = runPreLaunchTaskFromTasksJson(
    workspaceFolderFsPath,
    taskLabel,
  );
  if (
    typeof fromTasksJson.exitCode === "number"
    || fromTasksJson.outputLines.length > 0
  ) {
    return fromTasksJson;
  }

  const fromVscode = await runPreLaunchTaskFromVscodeTasks({
    workspaceFolderFsPath,
    folder,
    taskLabel,
  });
  if (
    typeof fromVscode.exitCode === "number"
    || fromVscode.outputLines.length > 0
  ) {
    return fromVscode;
  }

  throw new Error(
    `preLaunchTask '${taskLabel}' could not be resolved to a runnable task. Ensure it exists in .vscode/tasks.json (with a command) or is discoverable via VS Code tasks.`,
  );
}

async function configureExceptions(session: vscode.DebugSession) {
  // Wait a short moment for capabilities to be populated by the tracker
  await new Promise(resolve => setTimeout(resolve, 500));

  const capabilities = getSessionCapabilities(session.id) as {
    exceptionBreakpointFilters?: Array<{
      filter: string
      label: string
      default?: boolean
    }>
    supportsExceptionOptions?: boolean
  };

  if (!capabilities?.exceptionBreakpointFilters) {
    logger.debug(
      `No exception breakpoint filters found for session ${session.id}`,
    );
    return;
  }

  // Exception breakpoint filters are adapter-defined IDs (Capabilities.exceptionBreakpointFilters[].filter).
  // DAP does not standardize these IDs across adapters.
  //
  // When supportsExceptionOptions is false, the only portable control we have is `filters`, so we
  // enable adapter-default filters plus a small set of commonly-used filter IDs *if the adapter
  // advertises them*. This is NOT label parsing; it's exact ID matching against the adapter's own list.
  const preferredExceptionFilterIds = new Set([
    // Used by Microsoft vscode-js-debug (JavaScript) adapter via PauseOnExceptionsState.Uncaught.
    // Source: https://raw.githubusercontent.com/microsoft/vscode-js-debug/main/src/adapter/exceptionPauseService.ts
    // (also surfaced in capabilities: https://raw.githubusercontent.com/microsoft/vscode-js-debug/main/src/adapter/debugAdapter.ts)
    "uncaught",
    // Used by Microsoft debugpy (Python) adapter as "userUnhandled" (note casing).
    // Source: https://raw.githubusercontent.com/microsoft/debugpy/main/src/debugpy/adapter/clients.py
    "userunhandled",
  ]);

  const filtersToEnable = capabilities.exceptionBreakpointFilters
    .filter((filter) => {
      const filterId = filter.filter.toLowerCase();
      return (
        filter.default === true || preferredExceptionFilterIds.has(filterId)
      );
    })
    .map(filter => filter.filter);

  try {
    const supportsExceptionOptions
      = capabilities.supportsExceptionOptions === true;
    const summaryParts: string[] = [];
    if (filtersToEnable.length) {
      summaryParts.push(`filters=[${filtersToEnable.join(", ")}]`);
    }
    else {
      summaryParts.push("filters=[]");
    }
    if (supportsExceptionOptions) {
      summaryParts.push("exceptionOptions=[userUnhandled]");
    }
    else {
      summaryParts.push("exceptionOptions=<not supported>");
    }

    logger.info(
      `Enabling exception breakpoints for session ${
        session.id
      }: ${summaryParts.join(", ")}`,
    );

    const setExceptionBreakpointsTimeoutMs = 2000;
    await Promise.race([
      session.customRequest("setExceptionBreakpoints", {
        filters: filtersToEnable,
        ...(supportsExceptionOptions
          ? { exceptionOptions: [{ breakMode: "userUnhandled" }] }
          : {}),
      }),
      new Promise<void>((_resolve, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `setExceptionBreakpoints timed out after ${setExceptionBreakpointsTimeoutMs}ms`,
            ),
          );
        }, setExceptionBreakpointsTimeoutMs);
      }),
    ]);
  }
  catch (err) {
    logger.warn(
      `Failed to set exception breakpoints: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function startDebuggingAndWaitForStop(params: StartDebuggingAndWaitForStopParams): Promise<StartDebuggerStopInfo> {
  const {
    sessionName,
    workspaceFolder,
    nameOrConfiguration,
    timeoutSeconds: timeoutOverride,
    mode = "singleShot",
    breakpointConfig,
    serverReady: serverReadyParam,
    useExistingBreakpoints: _useExistingBreakpoints = false,
  } = params;

  logger.debug("startDebuggingAndWaitForStop params", params);

  if (mode === "singleShot" && breakpointConfig?.breakpoints) {
    const invalidBp = breakpointConfig.breakpoints.find(
      bp => bp.onHit === "captureAndContinue",
    );
    if (invalidBp) {
      throw new Error(
        "'captureAndContinue' onHit action is not supported in singleShot mode. Use 'inspect' mode or 'break'/'captureAndStopDebugging' action.",
      );
    }
  }

  const serverReadyEnabled = config.serverReadyEnabled !== false;
  if (serverReadyParam && !serverReadyEnabled) {
    logger.info(
      "serverReady payload ignored because copilot-debugger.serverReadyEnabled is false.",
    );
  }
  const serverReady = serverReadyEnabled ? serverReadyParam : undefined;

  let serverReadyPatternRegex: RegExp | undefined;
  if (serverReady?.trigger?.pattern) {
    try {
      serverReadyPatternRegex = new RegExp(serverReady.trigger.pattern);
    }
    catch (err) {
      throw new Error(
        `Invalid serverReady trigger pattern '${
          serverReady.trigger.pattern
        }': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  let serverReadyTriggerSummary: string | undefined;
  let serverReadyPatternMatched = false;
  let serverReadyPatternScanTimer: ReturnType<typeof setInterval> | undefined;
  const pendingTerminalPatternLines: string[] = [];
  let terminalPatternEvaluationEnabled = false;
  let activeDebugPatternScan: (() => void) | undefined;

  const copilotServerReadyTriggerMode:
    | "pattern"
    | "breakpoint"
    | "immediate"
    | "disabled" = !serverReady
      ? "disabled"
      : serverReadyPatternRegex
        ? "pattern"
        : serverReady.trigger?.path
          && typeof serverReady.trigger.line === "number"
          ? "breakpoint"
          : "immediate";
  const serverReadyPhaseExecutions: Array<{
    phase: "entry" | "late" | "immediate"
    when: number
  }> = [];
  // Helper to execute configured serverReady action
  const executeServerReadyAction = async (
    phase: "entry" | "late" | "immediate",
  ) => {
    if (!serverReady) {
      return;
    }
    serverReadyPhaseExecutions.push({ phase, when: Date.now() });
    try {
      // Determine action shape (new flat with type discriminator OR legacy union)
      type FlatAction
        = | {
          type: "httpRequest"
          url: string
          method?: string
          headers?: Record<string, string>
          body?: string
        }
        | { type: "shellCommand", shellCommand: string }
        | { type: "vscodeCommand", command: string, args?: unknown[] };
      type LegacyAction
        = | { shellCommand: string }
          | {
            httpRequest: {
              url: string
              method?: string
              headers?: Record<string, string>
              body?: string
            }
          }
          | { vscodeCommand: { command: string, args?: unknown[] } };
      const actionAny: FlatAction | LegacyAction = serverReady.action as
        | FlatAction
        | LegacyAction;
      let discriminator: string | undefined;
      if ("type" in (actionAny as object)) {
        discriminator = (actionAny as { type: string }).type;
      }
      const kind
        = discriminator
          || ("shellCommand" in actionAny
            ? "shellCommand"
            : "httpRequest" in actionAny
              ? "httpRequest"
              : "vscodeCommand" in actionAny
                ? "vscodeCommand"
                : undefined);
      switch (kind) {
        case "shellCommand": {
          const cmd = discriminator
            ? (actionAny as FlatAction & { shellCommand: string }).shellCommand
            : (actionAny as { shellCommand: string }).shellCommand;
          if (!cmd) {
            logger.warn("serverReady shellCommand missing command text.");
            return;
          }
          const terminal = vscode.window.createTerminal({
            name: `serverReady-${phase}`,
            isTransient: true,
            hideFromUser: true,
          });
          const autoDisposeTimer = setTimeout(() => {
            try {
              terminal.dispose();
            }
            catch (disposeErr) {
              logger.debug(
                `serverReady shellCommand auto-dispose failed: ${
                  disposeErr instanceof Error
                    ? disposeErr.message
                    : String(disposeErr)
                }`,
              );
            }
          }, 60_000);
          const closeListener = vscode.window.onDidCloseTerminal(
            (closedTerminal) => {
              if (closedTerminal === terminal) {
                clearTimeout(autoDisposeTimer);
                closeListener.dispose();
              }
            },
          );
          terminal.sendText(cmd, true);
          logger.info(`Executed serverReady shellCommand (${phase}): ${cmd}`);
          break;
        }
        case "httpRequest": {
          const url = discriminator
            ? (actionAny as FlatAction & { url: string }).url
            : (actionAny as { httpRequest?: { url?: string } }).httpRequest?.url;
          if (!url) {
            logger.warn("serverReady httpRequest missing url.");
            return;
          }
          const method = discriminator
            ? ((actionAny as FlatAction & { method?: string }).method ?? "GET")
            : ((actionAny as { httpRequest?: { method?: string } }).httpRequest?.method ?? "GET");
          const headers = discriminator
            ? (actionAny as FlatAction & { headers?: Record<string, string> })
                .headers
            : (
                actionAny as {
                  httpRequest?: { headers?: Record<string, string> }
                }
              ).httpRequest?.headers;
          const body = discriminator
            ? (actionAny as FlatAction & { body?: string }).body
            : (actionAny as { httpRequest?: { body?: string } }).httpRequest?.body;
          logger.info(
            `Dispatching serverReady httpRequest (${phase}) to ${url} method=${method}`,
          );
          // IMPORTANT: do not await the response.
          // If the request handler hits a break breakpoint, the debuggee pauses and
          // the HTTP response may never complete until resumed. We bound the request
          // lifetime with a timeout to prevent resource leaks.
          fireAndForgetHttpRequest({
            url,
            method,
            headers,
            body,
            timeoutMs: 15_000,
            onDone: (statusCode) => {
              logger.info(
                `serverReady httpRequest (${phase}) response status=${
                  statusCode ?? "unknown"
                }`,
              );
            },
            onError: (httpErr) => {
              logger.error(
                `serverReady httpRequest (${phase}) failed: ${
                  httpErr instanceof Error ? httpErr.message : String(httpErr)
                }`,
              );
            },
          });
          break;
        }
        case "vscodeCommand": {
          const command = discriminator
            ? (actionAny as FlatAction & { command: string }).command
            : (actionAny as { vscodeCommand?: { command?: string } })
                .vscodeCommand
                ?.command;
          if (!command) {
            logger.warn("serverReady vscodeCommand missing command id.");
            return;
          }
          const args = discriminator
            ? ((actionAny as FlatAction & { args?: unknown[] }).args ?? [])
            : ((actionAny as { vscodeCommand?: { args?: unknown[] } })
                .vscodeCommand
                ?.args ?? []);
          logger.info(
            `Executing serverReady vscodeCommand (${phase}): ${command}`,
          );
          try {
            const result = await vscode.commands.executeCommand(
              command,
              ...args,
            );
            logger.debug(
              `serverReady vscodeCommand (${phase}) result: ${JSON.stringify(
                result,
              )}`,
            );
          }
          catch (cmdErr) {
            logger.error(
              `serverReady vscodeCommand (${phase}) failed: ${
                cmdErr instanceof Error ? cmdErr.message : String(cmdErr)
              }`,
            );
          }
          break;
        }
        default:
          logger.warn("serverReady action type not recognized; skipping.");
      }
    }
    catch (err) {
      logger.error(
        `Failed executing serverReady action (${phase}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  // Basic breakpoint configuration validation (moved from StartDebuggerTool)
  // Accept either source breakpoints (path+code) or function breakpoints (functionName).
  if (!breakpointConfig) {
    throw new Error(
      "breakpointConfig is required (provide breakpoints and/or functionBreakpoints).",
    );
  }
  if (!path.isAbsolute(workspaceFolder)) {
    throw new Error(
      `workspaceFolder must be an absolute path to an open workspace folder. Received '${workspaceFolder}'.`,
    );
  }
  const resolvedWorkspaceFolder = workspaceFolder.trim();
  const normalizedRequestedFolder = normalizeFsPath(resolvedWorkspaceFolder);
  // Ensure that workspace folders exist and are accessible.
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error("No workspace folders are currently open.");
  }

  logger.debug(
    `Available workspace folders: ${workspaceFolders
      .map(f => `${f.name} -> ${f.uri.fsPath}`)
      .join(", ")}`,
  );
  logger.debug(
    `Looking for workspace folder (resolved): ${resolvedWorkspaceFolder}`,
  );

  const normalizedFolders = workspaceFolders.map(f => ({
    folder: f,
    normalized: normalizeFsPath(f.uri.fsPath),
  }));
  const folderEntry = normalizedFolders.find(
    f => f.normalized === normalizedRequestedFolder,
  );
  const folder = folderEntry?.folder;
  if (!folder) {
    throw new Error(
      `Workspace folder '${workspaceFolder}' is not currently open. Open folders: ${workspaceFolders
        .map(f => f.uri.fsPath)
        .join(", ")}`,
    );
  }
  const folderFsPath = folder.uri.fsPath;
  const trackedTaskPromises: Promise<TaskCompletionResult>[] = [];
  const trackedExecutions = new Set<vscode.TaskExecution>();
  let taskTrackingArmed = false;
  const shouldTrackTask = (task: vscode.Task) => {
    const scope = task.scope;
    if (!scope) {
      return false;
    }
    if (scope === vscode.TaskScope.Global) {
      return false;
    }
    if (scope === vscode.TaskScope.Workspace) {
      return true;
    }
    if (typeof scope === "object" && "uri" in scope && scope.uri) {
      const folderScope = scope as vscode.WorkspaceFolder;
      return (
        normalizeFsPath(folderScope.uri.fsPath) === normalizedRequestedFolder
      );
    }
    return false;
  };
  let taskStartDisposable: vscode.Disposable | undefined;
  // Automatic backup & isolation of existing breakpoints (no extra params required)
  const originalBreakpoints = [...vscode.debug.breakpoints];
  if (originalBreakpoints.length) {
    logger.debug(
      `Backing up and removing ${originalBreakpoints.length} existing breakpoint(s) for isolated debug session.`,
    );
    vscode.debug.removeBreakpoints(originalBreakpoints);
  }

  const sourceBreakpointRequests = breakpointConfig.breakpoints ?? [];
  const functionBreakpointRequests = breakpointConfig.functionBreakpoints ?? [];
  if (!sourceBreakpointRequests.length && !functionBreakpointRequests.length) {
    throw new Error(
      "breakpointConfig must provide at least one of: breakpoints (source) or functionBreakpoints.",
    );
  }

  const seen = new Set<string>();
  // Keep association between original request and created SourceBreakpoint
  const validated: Array<{
    bp: BreakpointDefinition
    sb: vscode.SourceBreakpoint
    resolvedLine: number
  }> = [];
  // Keep association between original request and created FunctionBreakpoint
  const validatedFunctions: Array<{
    bp: FunctionBreakpointDefinition
    fb: vscode.FunctionBreakpoint
  }> = [];

  for (const bp of sourceBreakpointRequests) {
    const absolutePath = path.isAbsolute(bp.path)
      ? bp.path
      : path.join(folderFsPath, bp.path);
    if (!bp.code || !bp.code.trim()) {
      throw new Error(
        `Breakpoint for '${absolutePath}' is missing required 'code' snippet.`,
      );
    }
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(absolutePath),
    );
    const lines = findAllLineNumbersForSnippet(doc, bp.code);
    if (lines.length === 0) {
      throw new Error(
        `Breakpoint snippet not found in '${absolutePath}': '${truncateSnippet(
          bp.code,
        )}'`,
      );
    }

    for (const line of lines) {
      const key = `${absolutePath}:${line}`;
      if (seen.has(key)) {
        logger.debug(`Skipping duplicate breakpoint ${key}.`);
        continue;
      }
      seen.add(key);
      const uri = vscode.Uri.file(absolutePath);
      const location = new vscode.Position(line - 1, 0);
      const effectiveHitCondition
        = bp.hitCount !== undefined ? String(bp.hitCount) : undefined;
      // For capture-style breakpoints we intentionally do NOT pass bp.logMessage to SourceBreakpoint.
      // Passing a logMessage turns the breakpoint into a logpoint (non-pausing) in many adapters.
      // Capture semantics require a real pause to gather variables; we interpolate logMessage ourselves.
      const adapterLogMessage
        = bp.onHit === "captureAndContinue" || bp.onHit === "captureAndStopDebugging"
          ? undefined
          : bp.logMessage;
      const sourceBp = new vscode.SourceBreakpoint(
        new vscode.Location(uri, location),
        true,
        bp.condition,
        effectiveHitCondition,
        adapterLogMessage,
      );
      validated.push({ bp, sb: sourceBp, resolvedLine: line });
    }
  }

  for (const bp of functionBreakpointRequests) {
    const name = bp.functionName?.trim();
    if (!name) {
      throw new Error("Function breakpoint is missing required 'functionName'.");
    }
    const effectiveHitCondition
      = bp.hitCount !== undefined ? String(bp.hitCount) : undefined;

    // For capture-style breakpoints we intentionally do NOT attempt to configure a logpoint.
    // VS Code's FunctionBreakpoint constructor does not accept a logMessage consistently across versions,
    // and capture semantics require a real pause.
    const key = `fn:${name}|cond:${bp.condition ?? ""}|hit:${effectiveHitCondition ?? ""}`;
    if (seen.has(key)) {
      logger.debug(`Skipping duplicate function breakpoint ${key}.`);
      continue;
    }
    seen.add(key);

    // Note: constructor signature varies slightly across VS Code versions; keep to the stable args.
    const fnBp = new vscode.FunctionBreakpoint(
      name,
      true,
      bp.condition,
      effectiveHitCondition,
    );
    validatedFunctions.push({ bp, fb: fnBp });
  }
  const updateResolvedBreakpointLine = (source: vscode.SourceBreakpoint) => {
    const match = validated.find(entry => entry.sb === source);
    if (!match) {
      return;
    }
    const nextResolvedLine = source.location.range.start.line + 1;
    if (match.resolvedLine === nextResolvedLine) {
      return;
    }
    logger.debug(
      `Breakpoint ${source.location.uri.fsPath} resolved line changed from ${match.resolvedLine} to ${nextResolvedLine}.`,
    );
    match.resolvedLine = nextResolvedLine;
  };
  let breakpointChangeDisposable: vscode.Disposable | undefined;
  if (validated.length) {
    breakpointChangeDisposable = vscode.debug.onDidChangeBreakpoints(
      (event) => {
        const candidates = [...event.added, ...event.changed].filter(
          (bp): bp is vscode.SourceBreakpoint =>
            bp instanceof vscode.SourceBreakpoint,
        );
        for (const bp of candidates) {
          updateResolvedBreakpointLine(bp);
        }
      },
    );
  }
  // Optional serverReady breakpoint (declare early so scope is available later)
  let serverReadySource: vscode.SourceBreakpoint | undefined;
  if (
    serverReady?.trigger?.path
    && typeof serverReady.trigger.line === "number"
  ) {
    const serverReadyPath = path.isAbsolute(serverReady.trigger.path)
      ? serverReady.trigger.path!
      : path.join(folderFsPath, serverReady.trigger.path!);
    try {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(serverReadyPath),
      );
      const lineCount = doc.lineCount;
      const duplicate = validated.some((v) => {
        const existingPath = v.sb.location.uri.fsPath;
        const existingLine = v.sb.location.range.start.line + 1;
        return (
          existingPath === serverReadyPath
          && existingLine === serverReady.trigger!.line
        );
      });
      if (
        serverReady.trigger.line! < 1
        || serverReady.trigger.line! > lineCount
        || duplicate
      ) {
        logger.warn(
          `ServerReady breakpoint invalid or duplicate (${serverReadyPath}:${serverReady.trigger.line}); ignoring.`,
        );
      }
      else {
        serverReadySource = new vscode.SourceBreakpoint(
          new vscode.Location(
            vscode.Uri.file(serverReadyPath),
            new vscode.Position(serverReady.trigger.line! - 1, 0),
          ),
          true,
        );
      }
    }
    catch (e) {
      logger.error(
        `Failed to open serverReady file ${serverReadyPath}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
  const addedBreakpoints: vscode.Breakpoint[] = [
    ...validated.map(v => v.sb),
    ...validatedFunctions.map(v => v.fb),
  ];
  if (addedBreakpoints.length) {
    vscode.debug.addBreakpoints(addedBreakpoints);
    logger.info(
      `Added ${validated.length} source breakpoint(s) and ${validatedFunctions.length} function breakpoint(s).`,
    );
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  else {
    logger.warn("No valid breakpoints to add after validation.");
  }
  if (serverReadySource) {
    vscode.debug.addBreakpoints([serverReadySource]);
    logger.info(
      `Added serverReady breakpoint at ${
        serverReadySource.location.uri.fsPath
      }:$${serverReadySource.location.range.start.line + 1}`,
    );
  }

  // Resolve launch configuration: always inject stopOnEntry=true to ensure early pause, but never synthesize a generic config.
  // Determine effective timeout
  const settingTimeout = config.entryTimeoutSeconds;
  const settingMaxBuildErrors = config.maxBuildErrors;
  const maxRuntimeOutputLines = config.maxOutputLines ?? 50;
  const stopServerReadyPatternTimer = () => {
    if (serverReadyPatternScanTimer) {
      clearInterval(serverReadyPatternScanTimer);
      serverReadyPatternScanTimer = undefined;
    }
  };
  const evaluateServerReadyPatternCandidate = (
    source: ServerReadyPatternSource,
    line: string,
  ) => {
    if (!serverReady || !serverReadyPatternRegex || serverReadyPatternMatched) {
      return;
    }
    const normalized = stripAnsiEscapeCodes(line).trim();
    if (!normalized) {
      return;
    }
    serverReadyPatternRegex.lastIndex = 0;
    if (!serverReadyPatternRegex.test(normalized)) {
      return;
    }
    serverReadyPatternMatched = true;
    serverReadyTriggerSummary = `${
      source === "terminal" ? "Terminal" : "Debug output"
    } matched: ${truncateLine(normalized)}`;
    logger.info(
      `serverReady trigger pattern matched via ${source}: ${normalized}`,
    );
    stopServerReadyPatternTimer();
    pendingTerminalPatternLines.length = 0;
    void executeServerReadyAction("immediate");
  };
  const pendingTerminalPatternLinesMax = maxRuntimeOutputLines;
  const enqueueTerminalPatternLine = (line: string) => {
    if (!serverReadyPatternRegex || serverReadyPatternMatched) {
      return;
    }
    if (!terminalPatternEvaluationEnabled) {
      if (pendingTerminalPatternLinesMax > 0) {
        pendingTerminalPatternLines.push(line);
        if (
          pendingTerminalPatternLines.length > pendingTerminalPatternLinesMax
        ) {
          pendingTerminalPatternLines.shift();
        }
      }
      return;
    }
    evaluateServerReadyPatternCandidate("terminal", line);
  };
  const enableTerminalPatternEvaluation = () => {
    if (!serverReadyPatternRegex || terminalPatternEvaluationEnabled) {
      return;
    }
    terminalPatternEvaluationEnabled = true;
    if (!pendingTerminalPatternLines.length) {
      return;
    }
    const buffered = [...pendingTerminalPatternLines];
    pendingTerminalPatternLines.length = 0;
    for (const line of buffered) {
      evaluateServerReadyPatternCandidate("terminal", line);
      if (serverReadyPatternMatched) {
        break;
      }
    }
  };
  const scheduleDebugPatternScan = (sessionId: string) => {
    if (!serverReadyPatternRegex || serverReadyPatternMatched) {
      return undefined;
    }
    const scan = () => {
      if (serverReadyPatternMatched) {
        stopServerReadyPatternTimer();
        return;
      }
      const lines = getSessionOutput(sessionId);
      for (const entry of lines) {
        if (!entry?.text) {
          continue;
        }
        evaluateServerReadyPatternCandidate("debugOutput", entry.text);
        if (serverReadyPatternMatched) {
          break;
        }
      }
    };
    scan();
    if (!serverReadyPatternMatched) {
      serverReadyPatternScanTimer = setInterval(scan, 250);
    }
    return scan;
  };
  const terminalCapture = createTerminalOutputCapture(maxRuntimeOutputLines, {
    onLine: line => enqueueTerminalPatternLine(line),
  });
  const withRuntimeDiagnostics = (message: string, sessionId?: string) =>
    formatRuntimeDiagnosticsMessage(message, {
      sessionId,
      terminalLines: terminalCapture.snapshot(),
      maxLines: maxRuntimeOutputLines,
    });
  interface ServerReadyMatch {
    source: ServerReadyPatternSource
    sample: string
    captureGroups: string[]
    formattedUri?: string
  }
  interface ServerReadyActionAnalysis {
    configured: boolean
    actionKind?: string
    pattern?: string
    patternError?: string
    uriFormat?: string
    match?: ServerReadyMatch
  }
  interface EntryTimeoutContext {
    launchRequest?: { type?: string, request?: string, name?: string }
    serverReadyAction?: ServerReadyActionAnalysis
    copilotServerReady?: {
      triggerMode: "pattern" | "breakpoint" | "immediate" | "disabled"
      executedPhases: Array<"entry" | "late" | "immediate">
    }
  }
  const analyzeServerReadyAction = (
    actionConfig: unknown,
    sessionId: string | undefined,
    terminalLines: string[],
  ): ServerReadyActionAnalysis => {
    const analysis: ServerReadyActionAnalysis = {
      configured: !!actionConfig,
    };
    if (!actionConfig || typeof actionConfig !== "object") {
      return analysis;
    }
    const record = actionConfig as Record<string, unknown>;
    if (typeof record.action === "string") {
      analysis.actionKind = record.action;
    }
    if (typeof record.pattern === "string") {
      analysis.pattern = record.pattern;
    }
    if (typeof record.uriFormat === "string") {
      analysis.uriFormat = record.uriFormat;
    }
    if (!analysis.pattern) {
      return analysis;
    }
    let regex: RegExp;
    try {
      regex = new RegExp(analysis.pattern);
    }
    catch (err) {
      analysis.patternError = err instanceof Error ? err.message : String(err);
      return analysis;
    }
    const sanitize = (value: string | undefined) =>
      value ? stripAnsiEscapeCodes(value).trim() : "";
    const sessionLines = sessionId
      ? getSessionOutput(sessionId).map(line => sanitize(line.text))
      : [];
    const searchLines = (
      lines: string[],
      source: ServerReadyPatternSource,
    ): ServerReadyMatch | undefined => {
      for (const raw of lines) {
        if (!raw) {
          continue;
        }
        regex.lastIndex = 0;
        const match = regex.exec(raw);
        if (match) {
          return {
            source,
            sample: truncateLine(raw),
            captureGroups: match.slice(1),
          };
        }
      }
      return undefined;
    };
    const terminalCandidates = terminalLines.flatMap((line) => {
      const trimmed = line.trim();
      const colonIndex = trimmed.indexOf(": ");
      if (colonIndex >= 0) {
        const withoutPrefix = trimmed.slice(colonIndex + 2).trim();
        return withoutPrefix && withoutPrefix !== trimmed
          ? [withoutPrefix, trimmed]
          : [trimmed];
      }
      return [trimmed];
    });
    const debugMatch = searchLines(sessionLines, "debugOutput");
    const terminalMatch = debugMatch
      ? undefined
      : searchLines(terminalCandidates, "terminal");
    const match = debugMatch ?? terminalMatch;
    if (match) {
      if (analysis.uriFormat) {
        let index = 0;
        const groups = match.captureGroups;
        match.formattedUri = analysis.uriFormat.replace(
          /%s/g,
          () => groups[index++] ?? "",
        );
      }
      analysis.match = match;
    }
    return analysis;
  };
  const describeEntryTimeout = (
    err: EntryStopTimeoutError,
    context?: EntryTimeoutContext,
  ) => {
    const seconds = (err.details.timeoutMs / 1000)
      .toFixed(1)
      .replace(/\.0$/, "");
    const header = `Timed out waiting ${seconds}s for the debugger to report its first stop.`;
    const hasSessions = err.details.sessions.length > 0;
    const sessionLines = hasSessions
      ? err.details.sessions.map((session, index) => {
          const status = session.stopped
            ? "stopped after timeout"
            : session.stopError
              ? `could not stop (${session.stopError})`
              : "still running when timeout fired";
          const request = session.request ?? "unknown";
          const cfgName = session.configurationName
            ? ` launch='${session.configurationName}'`
            : "";
          const folder = session.workspaceFolder
            ? ` workspace='${session.workspaceFolder}'`
            : "";
          return `${index + 1}. ${session.name} (id=${
            session.id
          }) [request=${request}${cfgName}${folder}] status=${status}`;
        })
      : [];
    const stoppedAny = hasSessions
      ? err.details.sessions.some(session => session.stopped)
      : false;
    const footer = hasSessions
      ? stoppedAny
        ? "Observed session(s) were stopped after diagnostics were collected."
        : "Unable to stop the new session before returning diagnostics."
      : "No new debug sessions were detected before the timeout fired.";
    const stateLines: string[] = [];
    if (context?.launchRequest) {
      const { type, request, name } = context.launchRequest;
      stateLines.push(
        `Launch configuration '${name ?? "<unnamed>"}' (type=${
          type ?? "unknown"
        }, request=${request ?? "unknown"}) resolved before timeout.`,
      );
    }
    stateLines.push(
      "Entry stop observed: NO (debug adapter never paused before timeout).",
    );
    if (context?.serverReadyAction) {
      const diag = context.serverReadyAction;
      stateLines.push(
        `serverReadyAction configured: ${diag.configured ? "yes" : "no"}.`,
      );
      if (diag.configured) {
        if (diag.patternError) {
          stateLines.push(
            `serverReadyAction.pattern error: ${diag.patternError} (pattern='${
              diag.pattern ?? "<unset>"
            }').`,
          );
        }
        else if (diag.pattern) {
          if (diag.match) {
            const captureSummary = diag.match.captureGroups.length
              ? `captures=${JSON.stringify(diag.match.captureGroups)}`
              : "no capture groups";
            stateLines.push(
              `serverReadyAction.pattern '${diag.pattern}' matched ${diag.match.source} output (${captureSummary}). Sample: ${diag.match.sample}`,
            );
            if (diag.uriFormat) {
              stateLines.push(
                `serverReadyAction.uriFormat '${diag.uriFormat}' => '${
                  diag.match.formattedUri ?? "<unresolved>"
                }'.`,
              );
            }
          }
          else {
            stateLines.push(
              `serverReadyAction.pattern '${diag.pattern}' has NOT appeared in debug/task output yet. Confirm your app logs this line (case-sensitive) before increasing the timeout.`,
            );
            if (diag.uriFormat) {
              stateLines.push(
                `serverReadyAction.uriFormat '${diag.uriFormat}' cannot be resolved until the pattern captures a value. Double-check the capture group in your log output.`,
              );
            }
          }
        }
        else {
          stateLines.push(
            "serverReadyAction.pattern not provided; VS Code will only run the action when tasks report readiness manually.",
          );
        }
        if (diag.actionKind) {
          stateLines.push(
            `serverReadyAction.action=${diag.actionKind}${
              diag.match?.formattedUri
                ? ` (verify the browser/command opened '${diag.match.formattedUri}')`
                : ""
            }`,
          );
        }
      }
    }
    if (context?.copilotServerReady) {
      const { triggerMode, executedPhases } = context.copilotServerReady;
      stateLines.push(
        `Copilot serverReady trigger: ${triggerMode}. Phases executed: ${
          executedPhases.length ? executedPhases.join(", ") : "<none>"
        }.`,
      );
      if (triggerMode === "pattern" && executedPhases.length === 0) {
        stateLines.push(
          "serverReady trigger pattern was not hit before timeout; ensure the monitored log line is emitted.",
        );
      }
    }
    stateLines.push(
      "Only raise 'copilot-debugger.entryTimeoutSeconds' after confirming the above readiness signals are working.",
    );
    const analysisBlock = stateLines.length
      ? `\nTimeout state analysis:\n- ${stateLines.join("\n- ")}`
      : "";
    return {
      message: `${header}\n${sessionLines.join(
        "\n",
      )}\n${footer}${analysisBlock}`,
      sessionId: err.details.sessions[0]?.id,
    };
  };
  const effectiveMaxBuildErrors
    = typeof settingMaxBuildErrors === "number" && settingMaxBuildErrors > 0
      ? settingMaxBuildErrors
      : 5;
  const buildFailureDetails = async (baseMessage: string) => {
    const diagnostics = collectBuildDiagnostics(
      folder.uri,
      effectiveMaxBuildErrors,
    );
    const terminalLinesSnapshot = terminalCapture.snapshot();
    const taskResults = await Promise.all(trackedTaskPromises);
    const taskResultsWithTerminalOutput = taskResults.map((result) => {
      if (
        typeof result.exitCode === "number"
        && result.exitCode !== 0
        && result.outputLines.length === 0
        && terminalLinesSnapshot.length > 0
      ) {
        return {
          ...result,
          outputLines: terminalLinesSnapshot,
        };
      }
      return result;
    });
    const shouldCaptureTypescriptCli
      = !!typescriptCliPath
        && taskResultsWithTerminalOutput.some(result =>
          result.name.toLowerCase().includes("tsc"),
        )
        && taskResultsWithTerminalOutput.every(
          result => result.outputLines.length === 0,
        );
    const typescriptCliLines = shouldCaptureTypescriptCli
      ? collectTypescriptCliOutput(folderFsPath)
      : [];
    const augmentedTaskResults = typescriptCliLines.length
      ? (() => {
          const updated = [...taskResultsWithTerminalOutput];
          const index = updated.findIndex(result =>
            result.name.toLowerCase().includes("tsc"),
          );
          if (index >= 0 && updated[index].outputLines.length === 0) {
            const existing = updated[index];
            updated[index] = {
              ...existing,
              exitCode:
                typeof existing.exitCode === "number" ? existing.exitCode : 1,
              outputLines: typescriptCliLines,
            };
            return updated;
          }
          // If we can't attribute the output to a specific task, include it as its own entry.
          updated.push({
            name: "TypeScript CLI (--noEmit)",
            exitCode: 1,
            outputLines: typescriptCliLines,
          } as TaskCompletionResult);
          return updated;
        })()
      : taskResultsWithTerminalOutput;
    const trackedAnyTasks = trackedTaskPromises.length > 0;
    const hasTaskFailures = augmentedTaskResults.some(
      result => typeof result.exitCode === "number" && result.exitCode !== 0,
    );
    const hasDiagnostics = trackedAnyTasks && diagnostics.length > 0;
    if (!hasTaskFailures && !hasDiagnostics) {
      return undefined;
    }

    // Ensure we have best-effort stdout/stderr for any failed tasks.
    // Some task execution modes do not expose execution details until after completion;
    // capturing here reduces flakiness in error reporting.
    const finalizedTaskResults = await Promise.all(
      augmentedTaskResults.map(async (result) => {
        if (
          typeof result.exitCode === "number"
          && result.exitCode !== 0
          && result.outputLines.length === 0
          && result.taskExecution
        ) {
          const outputLines = await captureTaskOutputLinesAsync(
            result.taskExecution,
            folderFsPath,
          );
          return outputLines.length ? { ...result, outputLines } : result;
        }
        return result;
      }),
    );
    const diagnosticText = formatBuildErrors(diagnostics);
    const taskFailureText = formatTaskFailures(finalizedTaskResults);
    return `${baseMessage}\n${diagnosticText}${taskFailureText}`
      .trim()
      .replace(/\n{3,}/g, "\n\n");
  };
  const effectiveTimeoutSeconds
    = typeof timeoutOverride === "number" && timeoutOverride > 0
      ? timeoutOverride
      : typeof settingTimeout === "number" && settingTimeout > 0
        ? settingTimeout
        : 60;
  let entryStopTimeoutMs = effectiveTimeoutSeconds * 1000;

  // Resolve launch configuration name: provided -> setting -> single config auto-select
  let effectiveLaunchName = nameOrConfiguration;
  if (!effectiveLaunchName) {
    effectiveLaunchName = config.defaultLaunchConfiguration;
  }
  const launchConfig = vscode.workspace.getConfiguration("launch", folder.uri);
  const allConfigs
    = (launchConfig.get<unknown>(
      "configurations",
    ) as vscode.DebugConfiguration[]) || [];
  if (!effectiveLaunchName) {
    if (allConfigs.length === 1 && allConfigs[0].name) {
      effectiveLaunchName = allConfigs[0].name;
      logger.info(
        `[startDebuggingAndWaitForStop] Auto-selected sole launch configuration '${effectiveLaunchName}'.`,
      );
    }
    else {
      throw new Error(
        "No launch configuration specified. Provide nameOrConfiguration, set copilot-debugger.defaultLaunchConfiguration, or define exactly one configuration.",
      );
    }
  }
  const found = allConfigs.find(c => c.name === effectiveLaunchName);
  if (!found) {
    throw new Error(
      `Launch configuration '${effectiveLaunchName}' not found in ${folder.uri.fsPath}. Add it to .vscode/launch.json.`,
    );
  }
  const resolvedConfig = { ...found };
  // Inject stopOnEntry if not already present (harmless if adapter ignores it)
  // Always force stopOnEntry true (adapter may ignore)
  (resolvedConfig as Record<string, unknown>).stopOnEntry = true;

  // Always run preLaunchTask manually so we can deterministically capture stdout/stderr.
  // After a successful run, remove it from the resolved config to prevent VS Code from running it again.
  const preLaunchTask = (resolvedConfig as Record<string, unknown>)
    .preLaunchTask;
  if (typeof preLaunchTask === "string" && preLaunchTask.trim()) {
    const preLaunchStart = Date.now();
    const run = await runPreLaunchTaskManually({
      workspaceFolderFsPath: folderFsPath,
      folder,
      taskLabel: preLaunchTask,
    });
    const preLaunchElapsedMs = Date.now() - preLaunchStart;
    entryStopTimeoutMs = Math.max(0, entryStopTimeoutMs - preLaunchElapsedMs);
    if (entryStopTimeoutMs <= 0) {
      const err = new EntryStopTimeoutError(
        `Timed out waiting for entry stop after ${effectiveTimeoutSeconds}s (preLaunchTask '${preLaunchTask}' consumed the entire timeout budget).`,
        { timeoutMs: effectiveTimeoutSeconds * 1000, sessions: [] },
      );
      const report = describeEntryTimeout(err, {
        launchRequest: {
          type:
            typeof resolvedConfig.type === "string"
              ? resolvedConfig.type
              : undefined,
          request:
            typeof resolvedConfig.request === "string"
              ? resolvedConfig.request
              : undefined,
          name:
            typeof resolvedConfig.name === "string"
              ? resolvedConfig.name
              : undefined,
        },
        serverReadyAction: { configured: false },
      });
      throw new EntryStopTimeoutError(report.message, err.details);
    }
    if (typeof run.exitCode === "number" && run.exitCode !== 0) {
      const lines = run.outputLines.slice(-5);
      const details = lines.length
        ? `\nLast ${lines.length} line(s):\n${lines
          .map(line => `  ${line}`)
          .join("\n")}`
        : "";
      throw new Error(
        `preLaunchTask '${preLaunchTask}' failed (exit ${run.exitCode}).${details}`,
      );
    }
    delete (resolvedConfig as Record<string, unknown>).preLaunchTask;
  }

  const effectiveSessionName = sessionName || resolvedConfig.name || "";
  logger.info(
    `Starting debugger with configuration '${resolvedConfig.name}' (stopOnEntry forced to true). Waiting for first stop event.`,
  );
  // Prepare entry stop listener BEFORE starting debugger to capture session id.
  const existingIds = activeSessions.map(s => s.id);
  const entryStopPromise = waitForEntryStop({
    excludeSessionIds: existingIds,
    timeout: entryStopTimeoutMs,
  });
  // Prevent unhandled rejection warning (error is rethrown via awaited path below)
  void entryStopPromise.catch(() => {});

  if (!taskStartDisposable) {
    taskStartDisposable = vscode.tasks.onDidStartTask((event) => {
      if (!taskTrackingArmed) {
        return;
      }
      if (trackedExecutions.has(event.execution)) {
        return;
      }
      if (!shouldTrackTask(event.execution.task)) {
        return;
      }
      trackedExecutions.add(event.execution);
      const monitored = monitorTask(event.execution, folderFsPath).catch(
        (err) => {
          logger.warn(
            `Task monitoring failed for ${event.execution.task.name}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return {
            name: event.execution.task.name,
            exitCode: undefined,
            outputLines: [],
          } as TaskCompletionResult;
        },
      );
      trackedTaskPromises.push(monitored);
    });
  }

  taskTrackingArmed = true;

  const startDebuggingTimeoutMs = Math.max(
    1,
    Math.min(10_000, entryStopTimeoutMs),
  );
  const success = await startDebuggingWithTimeout({
    folder,
    resolvedConfig,
    timeoutMs: startDebuggingTimeoutMs,
    failureContext: `configuration='${resolvedConfig.name}' sessionName='${effectiveSessionName}'`,
  });

  taskTrackingArmed = false;
  if (!success) {
    const baseMessage = `Failed to start debug session '${effectiveSessionName}'.`;
    const augmented = await buildFailureDetails(baseMessage);
    throw new Error(augmented ?? baseMessage);
  }
  if (
    serverReady
    && copilotServerReadyTriggerMode === "immediate"
    && (!resolvedConfig.request || resolvedConfig.request === "attach")
  ) {
    if (!serverReadyTriggerSummary) {
      serverReadyTriggerSummary = "Immediate trigger invoked (attach request).";
    }
    logger.info("Executing immediate serverReady action for attach request.");
    void executeServerReadyAction("immediate");
  }
  const startT = Date.now();
  let remainingMs = effectiveTimeoutSeconds * 1000;
  let entryStop: BreakpointHitInfo | undefined;
  let finalStop: BreakpointHitInfo | undefined;
  let debugContext:
    | Awaited<ReturnType<typeof DAPHelpers.getDebugContext>>
    | undefined;
  try {
    entryStop = await entryStopPromise;
    const afterEntry = Date.now();
    remainingMs = Math.max(0, remainingMs - (afterEntry - startT));
    if (entryStop.reason === "terminated") {
      throw new Error(
        withRuntimeDiagnostics(
          `Debug session '${effectiveSessionName}' terminated before hitting entry (unexpected: user cancelled or app exited).`,
          entryStop.session.id,
        ),
      );
    }
    enableTerminalPatternEvaluation();
    activeDebugPatternScan = scheduleDebugPatternScan(entryStop.session.id);

    // Configure exception breakpoints as early as possible (now that we have the concrete session id),
    // so uncaught exceptions can stop the debugger before the app terminates.
    logger.info(
      `Entry stop observed for session ${entryStop.session.id} (${entryStop.session.name}); configuring exception breakpoints.`,
    );
    await configureExceptions(entryStop.session);

    const sessionId = entryStop.session.id;

    // Fail fast if caller requested function breakpoints but adapter doesn't support them.
    if (validatedFunctions.length) {
      const caps = await waitForSessionCapabilities({
        sessionId,
        timeoutMs: 2000,
      });
      const supportsFunctionBreakpoints
        = (caps?.supportsFunctionBreakpoints as unknown) === true;
      if (!supportsFunctionBreakpoints) {
        throw new Error(
          "The active debug adapter does not advertise supportsFunctionBreakpoints=true, so functionBreakpoints are not supported in this session.",
        );
      }
    }
    // Determine if entry stop is serverReady breakpoint
    // Tolerate serverReady breakpoint being the first ("entry") stop even if a user breakpoint
    // might also be hit first in some adapters. We only require line equality; path mismatch is
    // highly unlikely and path normalization differences previously caused false negatives.
    // This broadened check ensures we properly detect and continue past serverReady to user breakpoint.
    const isServerReadyHit
      = !!serverReadySource && entryStop.line === serverReady?.trigger?.line;
    // Decide whether to continue immediately (entry not at user breakpoint OR serverReady hit)
    const isRequestedStop = (stop: BreakpointHitInfo): boolean => {
      if (stop.reason === "function breakpoint" && validatedFunctions.length) {
        return true;
      }
      return (
        typeof stop.line === "number"
        && validated.some(v => v.resolvedLine === stop.line)
      );
    };

    const hitRequestedBreakpoint = isRequestedStop(entryStop);
    logger.info(
      `EntryStop diagnostics: line=${entryStop.line} serverReadyLine=${serverReady?.trigger?.line} isServerReadyHit=${isServerReadyHit} hitRequestedBreakpoint=${hitRequestedBreakpoint}`,
    );
    if (!hitRequestedBreakpoint || isServerReadyHit) {
      logger.debug(
        isServerReadyHit
          ? "Entry stop is serverReady breakpoint; executing command then continuing."
          : `Entry stop for session ${sessionId} not at requested breakpoint; continuing to first user breakpoint.`,
      );
      if (isServerReadyHit && serverReady) {
        if (!serverReadyTriggerSummary) {
          serverReadyTriggerSummary = serverReady.trigger?.path
            ? `Breakpoint ${serverReady.trigger.path}:${serverReady.trigger.line}`
            : "serverReady breakpoint hit";
        }
        await executeServerReadyAction("entry");
      }
      // Remove serverReady breakpoint BEFORE continuing to avoid immediate re-stop
      if (isServerReadyHit && serverReadySource) {
        vscode.debug.removeBreakpoints([serverReadySource]);
        logger.debug("Removed serverReady breakpoint prior to continue.");
      }
      const firstPostEntryStop = await customRequestAndWaitForStop({
        session: entryStop.session,
        sessionId,
        command: "continue",
        threadId: entryStop.threadId,
        timeout: remainingMs,
        failureMessage: "Failed to continue after entry stop (DAP 'continue')",
      });

      // Some adapters emit multiple early stops (often reported as 'breakpoint' rather than 'entry').
      // Continue until we hit a requested breakpoint, an exception stop, or termination.
      {
        let nextStop: BreakpointHitInfo = firstPostEntryStop;
        const loopStart = Date.now();
        const maxHops = 10;
        let hops = 0;
        while (
          nextStop.reason !== "terminated"
          && nextStop.reason !== "exception"
          && !isRequestedStop(nextStop)
          && hops < maxHops
        ) {
          // Special-case: serverReady breakpoint stop (after entry).
          // If we don't process it here, we'll keep re-stopping on the same breakpoint.
          if (
            serverReady
            && serverReadySource
            && typeof nextStop.line === "number"
            && nextStop.line === serverReady.trigger?.line
          ) {
            logger.info(
              `Hit serverReady breakpoint during startup hops at line ${nextStop.line}; executing action then continuing to user breakpoint.`,
            );
            if (!serverReadyTriggerSummary) {
              serverReadyTriggerSummary = serverReady.trigger?.path
                ? `Breakpoint ${serverReady.trigger.path}:${serverReady.trigger.line}`
                : "serverReady breakpoint hit";
            }
            await executeServerReadyAction("late");
            // Remove serverReady breakpoint to avoid re-trigger.
            vscode.debug.removeBreakpoints([serverReadySource]);
            serverReadySource = undefined;
            const elapsed = Date.now() - loopStart;
            const remaining = Math.max(0, remainingMs - elapsed);
            nextStop = await customRequestAndWaitForStop({
              session: nextStop.session,
              sessionId,
              command: "continue",
              threadId: nextStop.threadId,
              timeout: remaining,
              failureMessage:
                "Failed to continue after serverReady breakpoint (DAP 'continue')",
            });
            continue;
          }
          hops++;
          const elapsed = Date.now() - loopStart;
          const remaining = Math.max(0, remainingMs - elapsed);
          logger.debug(
            `Continuing past non-user stop (reason=${nextStop.reason} line=${nextStop.line}); hop ${hops}/${maxHops}.`,
          );
          nextStop = await customRequestAndWaitForStop({
            session: nextStop.session,
            sessionId,
            command: "continue",
            threadId: nextStop.threadId,
            timeout: remaining,
            failureMessage:
              "Failed to continue after non-user stop (DAP 'continue')",
          });
        }
        finalStop = nextStop;
      }
    }
    else {
      finalStop = entryStop; // entry coincides with user breakpoint
    }
    if (finalStop.reason === "terminated") {
      throw new Error(
        withRuntimeDiagnostics(
          `Debug session '${effectiveSessionName}' terminated before hitting a user breakpoint (unexpected: user cancelled or app exited).`,
          finalStop.session.id,
        ),
      );
    }
    // If serverReady was NOT the entry stop but becomes the first user stop, process it now then continue.
    if (
      !isServerReadyHit
      && serverReady
      && serverReadySource
      && finalStop.line === serverReady.trigger?.line
    ) {
      logger.info(
        `Processing serverReady breakpoint post-entry at line ${finalStop.line}. Executing serverReady action then continuing to user breakpoint.`,
      );
      if (!serverReadyTriggerSummary) {
        serverReadyTriggerSummary = serverReady.trigger?.path
          ? `Breakpoint ${serverReady.trigger.path}:${serverReady.trigger.line}`
          : "serverReady breakpoint hit";
      }
      await executeServerReadyAction("late");
      // Remove serverReady breakpoint to avoid re-trigger
      vscode.debug.removeBreakpoints([serverReadySource]);
      const nextStop = await customRequestAndWaitForStop({
        session: finalStop.session,
        sessionId: finalStop.session.id,
        command: "continue",
        threadId: finalStop.threadId,
        timeout: remainingMs,
        failureMessage:
          "Failed to continue after late serverReady processing (DAP 'continue')",
      });
      if (nextStop.reason === "terminated") {
        throw new Error(
          withRuntimeDiagnostics(
            `Debug session '${effectiveSessionName}' terminated after serverReady processing before hitting a user breakpoint (unexpected: user cancelled or app exited).`,
            finalStop.session.id,
          ),
        );
      }
      finalStop = nextStop;
    }
    // Deterministic advancement: some adapters may re-stop on the serverReady line after continue.
    // If still on serverReady and a user breakpoint exists immediately after, perform explicit step(s) to reach it.
    if (
      isServerReadyHit
      && serverReady?.trigger?.line
      && finalStop.line === serverReady.trigger.line
    ) {
      const userNextLine = serverReady.trigger.line + 1;
      const hasUserNext = validated.some(
        v => v.sb.location.range.start.line === userNextLine - 1,
      );
      if (hasUserNext) {
        logger.info(
          `Advancing from serverReady line ${serverReady.trigger.line} to user breakpoint line ${userNextLine} via step(s).`,
        );
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const stepped = await customRequestAndWaitForStop({
              session: finalStop.session,
              sessionId: finalStop.session.id,
              command: "next",
              threadId: finalStop.threadId,
              timeout: remainingMs,
              failureMessage: `Step attempt ${attempt + 1} failed`,
            });
            if (stepped.reason === "terminated") {
              logger.warn(
                "Session terminated during serverReady advancement step.",
              );
              finalStop = stepped;
              break;
            }
            finalStop = stepped;
            if (finalStop.line === userNextLine) {
              logger.info(
                `Reached user breakpoint line ${userNextLine} after ${
                  attempt + 1
                } step(s).`,
              );
              break;
            }
          }
          catch (stepErr) {
            logger.warn(
              `Step attempt ${attempt + 1} failed: ${
                stepErr instanceof Error ? stepErr.message : String(stepErr)
              }`,
            );
            break;
          }
        }
      }
    }
    debugContext = await DAPHelpers.getDebugContext(
      finalStop.session,
      finalStop.threadId,
    );
    const orderedScopes = reorderScopesForCapture(debugContext.scopes ?? []);
    debugContext = { ...debugContext, scopes: orderedScopes };
    let scopesForCapture = orderedScopes;
    // Determine which breakpoint was actually hit (exact file + line match)
    let hitBreakpoint: BreakpointDefinition | undefined;
    let hitFunctionBreakpoint: FunctionBreakpointDefinition | undefined;
    const framePath = debugContext.frame?.source?.path;
    const frameLine = debugContext.frame?.line;
    if (framePath && typeof frameLine === "number") {
      const normalizedFramePath = normalizeFsPath(framePath);
      for (const { bp, resolvedLine } of validated) {
        const absPath = path.isAbsolute(bp.path)
          ? bp.path
          : path.join(folderFsPath, bp.path);
        if (normalizeFsPath(absPath) !== normalizedFramePath) {
          continue;
        }
        if (frameLine !== resolvedLine) {
          continue;
        }
        hitBreakpoint = {
          path: absPath,
          line: frameLine,
          code: bp.code,
          variable: bp.variable,
          onHit: bp.onHit,
          condition: bp.condition,
          hitCount: bp.hitCount,
          logMessage: bp.logMessage,
          autoStepOver: bp.autoStepOver,
          reasonCode: bp.reasonCode,
        };
        break;
      }
    }

    // DAP stopped events do not include a unique "function breakpoint id".
    // If we can unambiguously match the top frame name to the requested functionName, report it.
    if (
      finalStop.reason === "function breakpoint"
      && validatedFunctions.length
      && typeof debugContext.frame?.name === "string"
    ) {
      const frameName = debugContext.frame.name;
      const matches = validatedFunctions
        .map(v => v.bp)
        .filter(bp => bp.functionName === frameName);
      if (matches.length === 1) {
        hitFunctionBreakpoint = { ...matches[0] };
      }
    }

    // Capture variables.
    // For capture actions (captureAndContinue / captureAndStopDebugging), we default to a
    // single step-over (DAP 'next') before collecting variables. This avoids the common
    // scenario where a breakpoint is placed on an assignment line and variables still
    // reflect their pre-assignment values.
    //
    // If autoStepOver=true, we do a richer before/after capture instead.
    // If autoStepOver=false, we do not step.
    let stepOverCapture: StartDebuggerStopInfo["stepOverCapture"] | undefined;
    let scopeVariables: ScopeVariables[] = [];
    const effectiveHit = hitBreakpoint ?? hitFunctionBreakpoint;
    const isCaptureAction
      = effectiveHit?.onHit === "captureAndContinue"
        || effectiveHit?.onHit === "captureAndStopDebugging";
    const shouldDefaultStepBeforeCapture
      = isCaptureAction
        && effectiveHit?.autoStepOver !== true
        && effectiveHit?.autoStepOver !== false;

    if (shouldDefaultStepBeforeCapture) {
      const stepped = await customRequestAndWaitForStop({
        session: finalStop.session,
        sessionId: finalStop.session.id,
        command: "next",
        threadId: finalStop.threadId,
        timeout: remainingMs,
        failureMessage:
          "capture action default step-over failed: debug adapter did not accept DAP 'next'",
      });
      if (stepped.reason === "terminated") {
        throw new Error(
          withRuntimeDiagnostics(
            "Capture action requested, but the debug session terminated during default step-over.",
            finalStop.session.id,
          ),
        );
      }
      finalStop = stepped;
      debugContext = await DAPHelpers.getDebugContext(
        finalStop.session,
        finalStop.threadId,
      );
      const steppedScopes = reorderScopesForCapture(debugContext.scopes ?? []);
      debugContext = { ...debugContext, scopes: steppedScopes };
      scopesForCapture = steppedScopes;
    }

    if (effectiveHit?.autoStepOver) {
      const before = await captureScopeVariables({
        session: finalStop.session,
        scopes: scopesForCapture,
      });
      const fromLine = debugContext.frame?.line;

      const stepped = await customRequestAndWaitForStop({
        session: finalStop.session,
        sessionId: finalStop.session.id,
        command: "next",
        threadId: finalStop.threadId,
        timeout: remainingMs,
        failureMessage:
          "autoStepOver failed: debug adapter did not accept step-over request (DAP 'next')",
      });
      if (stepped.reason === "terminated") {
        throw new Error(
          withRuntimeDiagnostics(
            "autoStepOver requested, but the debug session terminated during step-over.",
            finalStop.session.id,
          ),
        );
      }

      finalStop = stepped;
      debugContext = await DAPHelpers.getDebugContext(
        finalStop.session,
        finalStop.threadId,
      );
      const steppedScopes = reorderScopesForCapture(debugContext.scopes ?? []);
      debugContext = { ...debugContext, scopes: steppedScopes };
      const after = await captureScopeVariables({
        session: finalStop.session,
        scopes: steppedScopes,
      });
      const toLine = debugContext.frame?.line;

      scopeVariables = after;
      stepOverCapture = {
        performed: true,
        fromLine,
        toLine,
        before,
        after,
      };
    }
    else {
      scopeVariables = await captureScopeVariables({
        session: finalStop.session,
        scopes: scopesForCapture,
      });
    }
    // Build variable lookup for interpolation (for capture action log message expansion)
    const variableLookup = new Map<string, string>();
    for (const scope of scopeVariables) {
      for (const v of scope.variables) {
        variableLookup.set(v.name, v.value);
      }
    }
    let capturedLogMessages: string[] | undefined;
    if (
      effectiveHit?.onHit === "captureAndContinue"
      || effectiveHit?.onHit === "captureAndStopDebugging"
    ) {
      const interpolate = (msg: string) =>
        msg.replace(/\{([^{}]+)\}/g, (_m, name) => {
          const raw = variableLookup.get(name);
          return raw !== undefined ? raw : `{${name}}`;
        });
      capturedLogMessages = [];
      for (const { bp } of validated) {
        if (bp.logMessage) {
          capturedLogMessages.push(interpolate(bp.logMessage));
        }
      }
      for (const { bp } of validatedFunctions) {
        if (bp.logMessage) {
          capturedLogMessages.push(interpolate(bp.logMessage));
        }
      }
    }
    if (effectiveHit?.onHit === "captureAndStopDebugging") {
      logger.info("Terminating all debug sessions per breakpoint action.");
      await vscode.debug.stopDebugging();
      const now = Date.now();
      while (vscode.debug.activeDebugSession) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const waitTime = Date.now() - now;
      logger.info(`All debug sessions terminated after ${waitTime}ms.`);
    }
    else if (effectiveHit?.onHit === "captureAndContinue") {
      await tryContinueWithoutWaiting({
        session: finalStop.session,
        threadId: finalStop.threadId,
        failureContext: "after capture action",
      });
    }
    activeDebugPatternScan?.();
    const serverReadyInfo: ServerReadyInfo = {
      configured: !!serverReady,
      triggerMode: copilotServerReadyTriggerMode,
      phases: serverReadyPhaseExecutions.map(entry => ({
        phase: entry.phase,
        timestamp: entry.when,
      })),
      triggerSummary: serverReadyTriggerSummary,
    };
    let debuggerState: DebuggerStateSnapshot;
    if (effectiveHit?.onHit === "captureAndStopDebugging") {
      debuggerState = { status: "terminated" };
    }
    else if (effectiveHit?.onHit === "captureAndContinue") {
      debuggerState = {
        status: "running",
        sessionId: finalStop.session.id,
        sessionName: finalStop.session.name,
      };
    }
    else {
      debuggerState = {
        status: "paused",
        sessionId: finalStop.session.id,
        sessionName: finalStop.session.name,
      };
    }

    // Safe-by-default: if the tool is operating in singleShot mode, terminate the session
    // before returning. This prevents the model from doing "out-of-band" external actions
    // (like curl) against a paused debuggee.
    if (mode === "singleShot" && debuggerState.status === "paused") {
      try {
        logger.info(
          `singleShot mode: terminating debug session '${finalStop.session.name}' (id=${finalStop.session.id}) before returning.`,
        );
        await vscode.debug.stopDebugging(finalStop.session);
      }
      catch (stopErr) {
        logger.warn(
          `singleShot mode: failed to stop debug session before return: ${
            stopErr instanceof Error ? stopErr.message : String(stopErr)
          }`,
        );
      }
      debuggerState = { status: "terminated" };
    }

    const protocol = buildProtocol(debuggerState);
    const formattedOutput = getSessionOutput(finalStop.session.id)
      .map((line) => {
        const category = line.category || "output";
        const sanitized = truncateLine(stripAnsiEscapeCodes(line.text).trim());
        if (!sanitized) {
          return undefined;
        }
        return `[${category}] ${sanitized}`;
      })
      .filter((line): line is string => typeof line === "string");
    const totalLines = formattedOutput.length;
    const previewCount = Math.min(MAX_RETURNED_DEBUG_OUTPUT_LINES, totalLines);
    const runtimeOutput: RuntimeOutputPreview = {
      lines:
        previewCount > 0
          ? formattedOutput.slice(totalLines - previewCount)
          : [],
      totalLines,
      truncated: previewCount < totalLines,
    };
    return {
      ...debugContext,
      scopeVariables,
      stepOverCapture,
      hitBreakpoint: hitBreakpoint ?? undefined,
      hitFunctionBreakpoint: hitFunctionBreakpoint ?? undefined,
      capturedLogMessages,
      serverReadyInfo,
      debuggerState,
      protocol,
      runtimeOutput,
      reason: finalStop.reason,
      exceptionInfo: finalStop.exceptionInfo,
    };
  }
  catch (error) {
    taskTrackingArmed = false;
    if (error instanceof EntryStopTimeoutError) {
      const terminalLinesForAnalysis = terminalCapture.snapshot();
      const firstSessionId = error.details.sessions[0]?.id;
      const serverReadyActionAnalysis = analyzeServerReadyAction(
        (resolvedConfig as Record<string, unknown>).serverReadyAction,
        firstSessionId,
        terminalLinesForAnalysis,
      );
      const summary = describeEntryTimeout(error, {
        launchRequest: {
          type: (resolvedConfig as Record<string, unknown>).type as
          | string
          | undefined,
          request: (resolvedConfig as Record<string, unknown>).request as
          | string
          | undefined,
          name: resolvedConfig.name,
        },
        serverReadyAction: serverReadyActionAnalysis,
        copilotServerReady: {
          triggerMode: copilotServerReadyTriggerMode,
          executedPhases: serverReadyPhaseExecutions.map(
            entry => entry.phase,
          ),
        },
      });
      const enriched = formatRuntimeDiagnosticsMessage(summary.message, {
        sessionId: summary.sessionId,
        terminalLines: terminalLinesForAnalysis,
        maxLines: maxRuntimeOutputLines,
      });
      throw new Error(enriched);
    }
    const baseMessage = error instanceof Error ? error.message : String(error);
    const augmented = await buildFailureDetails(baseMessage);
    if (augmented) {
      throw new Error(augmented);
    }
    throw error;
  }
  finally {
    taskTrackingArmed = false;
    stopServerReadyPatternTimer();
    activeDebugPatternScan = undefined;
    terminalCapture.dispose();
    taskStartDisposable?.dispose();
    breakpointChangeDisposable?.dispose();
    // Restore original breakpoints, removing any added ones first
    const current = vscode.debug.breakpoints;
    if (current.length) {
      // Remove only the breakpoints we added (avoid touching restored originals twice)
      const added = new Set<vscode.Breakpoint>([
        ...validated.map(v => v.sb),
        ...validatedFunctions.map(v => v.fb),
      ]);
      if (serverReadySource) {
        added.add(serverReadySource);
      }
      const toRemove = current.filter(bp => added.has(bp));
      if (toRemove.length) {
        vscode.debug.removeBreakpoints(toRemove);
        logger.debug(
          `Removed ${toRemove.length} session breakpoint(s) before restoring originals.`,
        );
      }
    }
    if (originalBreakpoints.length) {
      vscode.debug.addBreakpoints(originalBreakpoints);
      logger.debug(
        `Restored ${originalBreakpoints.length} original breakpoint(s).`,
      );
    }
    else {
      logger.debug("No original breakpoints to restore.");
    }
  }
}

/**
 * Stop debug sessions that match the provided session id.
 *
 * @param params - Object containing the sessionId to stop.
 * @param params.sessionId - ID of the debug session(s) to stop.
 */
export async function stopDebugSession(params: { sessionId: string }) {
  const { sessionId } = params;
  const trimmed = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!trimmed) {
    throw new Error("sessionId is required");
  }

  // 1) Exact VS Code session UUID match.
  let matchingSessions = activeSessions.filter(
    (session: vscode.DebugSession) => session.id === trimmed,
  );

  // 2) If not found, allow passing the listDebugSessions toolId (1-based index).
  if (matchingSessions.length === 0 && /^\d+$/.test(trimmed)) {
    const toolId = Number(trimmed);
    const mapped = mapDebugSessionsForTool({
      sessions: activeSessions,
      activeSessionId: vscode.debug.activeDebugSession?.id,
    });
    const item = mapped.find(i => i.toolId === toolId);
    if (item) {
      matchingSessions = activeSessions.filter(s => s.id === item.id);
    }
  }

  // 3) If still not found, allow exact name match when unambiguous.
  if (matchingSessions.length === 0) {
    const byName = activeSessions.filter(s => s.name === trimmed);
    if (byName.length === 1) {
      matchingSessions = byName;
    }
    else if (byName.length > 1) {
      throw new Error(
        `Multiple debug sessions share the name '${trimmed}'. Use listDebugSessions and pass the session 'id' (UUID) or 'toolId'.`,
      );
    }
  }

  if (matchingSessions.length === 0) {
    throw new Error(
      `No debug session(s) found for '${trimmed}'. Use listDebugSessions and pass either the session 'id' (UUID) or 'toolId'.`,
    );
  }

  for (const session of matchingSessions) {
    await vscode.debug.stopDebugging(session);
  }
}
/**
 * Resume execution of a debug session that has been paused (e.g., by a breakpoint).
 *
 * @param params - Object containing the sessionId of the debug session to resume and optional waitForStop flag.
 * @param params.sessionId - ID of the debug session to resume.
 * @param params.breakpointConfig - Optional configuration for managing breakpoints when resuming.
 * @param params.breakpointConfig.breakpoints - Array of breakpoint configurations to set before resuming.
 * @param params.breakpointConfig.functionBreakpoints - Array of function breakpoint configurations to set before resuming.
 */
export async function resumeDebugSession(params: {
  sessionId: string
  breakpointConfig?: {
    breakpoints?: Array<BreakpointDefinition>
    functionBreakpoints?: Array<FunctionBreakpointDefinition>
  }
}) {
  const { sessionId, breakpointConfig } = params;

  // Find the session with the given ID
  let session = activeSessions.find(s => s.id === sessionId);

  // If not found by ID, try to find by name pattern (VSCode creates child sessions with modified names)
  if (!session) {
    // Look for a session whose name contains the session ID
    session = activeSessions.find(s => s.name.includes(sessionId));
  }

  if (!session) {
    throw new Error(`No debug session found with ID '${sessionId}'.`);
  }

  // Used to resolve relative breakpoint paths.
  const workspaceFolder
    = session.workspaceFolder?.uri.fsPath
      || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Handle breakpoint configuration if provided
  if (breakpointConfig) {
    // Fail fast if caller requested function breakpoints but adapter doesn't support them.
    if (breakpointConfig.functionBreakpoints?.length) {
      const caps = await waitForSessionCapabilities({
        sessionId: session.id,
        timeoutMs: 2000,
      });
      const supportsFunctionBreakpoints
        = (caps?.supportsFunctionBreakpoints as unknown) === true;
      if (!supportsFunctionBreakpoints) {
        throw new Error(
          "The active debug adapter does not advertise supportsFunctionBreakpoints=true, so functionBreakpoints are not supported in this session.",
        );
      }
    }

    const functionBreakpoints: vscode.FunctionBreakpoint[] = [];
    if (breakpointConfig.functionBreakpoints?.length) {
      for (const bp of breakpointConfig.functionBreakpoints) {
        const name = bp.functionName?.trim();
        if (!name) {
          throw new Error(
            "Function breakpoint is missing required 'functionName'.",
          );
        }
        const hitCond
          = bp.hitCount !== undefined ? String(bp.hitCount) : undefined;
        functionBreakpoints.push(
          new vscode.FunctionBreakpoint(name, true, bp.condition, hitCond),
        );
      }
    }

    // Add new source breakpoints if provided
    if (breakpointConfig.breakpoints?.length) {
      if (!workspaceFolder) {
        throw new Error(
          "Cannot determine workspace folder for breakpoint paths",
        );
      }

      const resolved = [] as Array<{
        bp: BreakpointDefinition
        absPath: string
        lines: number[]
      }>;
      for (const bp of breakpointConfig.breakpoints) {
        let absPath: string;
        if (path.isAbsolute(bp.path)) {
          absPath = bp.path;
        }
        else {
          // Try to resolve relative path against session folder, then any workspace folder
          const candidates = [
            session.workspaceFolder?.uri.fsPath,
            ...(vscode.workspace.workspaceFolders ?? []).map(
              f => f.uri.fsPath,
            ),
          ].filter((p): p is string => !!p);

          const found = candidates.find(base =>
            fs.existsSync(path.join(base, bp.path)),
          );
          if (found) {
            absPath = path.join(found, bp.path);
          }
          else {
            // Legacy determination
            if (!workspaceFolder) {
              throw new Error(
                `Cannot determine workspace folder for '${bp.path}'`,
              );
            }
            absPath = path.join(workspaceFolder, bp.path);
          }
        }

        if (!bp.code || !bp.code.trim()) {
          throw new Error(
            `Breakpoint for '${absPath}' is missing required 'code' snippet.`,
          );
        }
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(absPath),
        );
        const lines = findAllLineNumbersForSnippet(doc, bp.code);
        if (lines.length === 0) {
          throw new Error(
            `Breakpoint snippet not found in '${absPath}': '${truncateSnippet(
              bp.code,
            )}'`,
          );
        }
        resolved.push({ bp, absPath, lines });
      }

      const newBreakpoints: vscode.SourceBreakpoint[] = [];
      for (const entry of resolved) {
        for (const line of entry.lines) {
          const uri = vscode.Uri.file(entry.absPath);
          const location = new vscode.Position(line - 1, 0);
          const hitCond
            = entry.bp.hitCount !== undefined
              ? String(entry.bp.hitCount)
              : undefined;
          const adapterLogMessage
            = entry.bp.onHit === "captureAndContinue"
              || entry.bp.onHit === "captureAndStopDebugging"
              ? undefined
              : entry.bp.logMessage;
          newBreakpoints.push(
            new vscode.SourceBreakpoint(
              new vscode.Location(uri, location),
              true,
              entry.bp.condition,
              hitCond,
              adapterLogMessage,
            ),
          );
        }
      }
      vscode.debug.addBreakpoints([...newBreakpoints, ...functionBreakpoints]);

      // Replace breakpointConfig breakpoints with resolved entries for downstream correlation.
      // (We keep original code snippet on each entry, but the hit line is checked via resolved mapping below.)
    }
    else if (functionBreakpoints.length) {
      vscode.debug.addBreakpoints(functionBreakpoints);
    }
  }

  // Send the continue request to the debug adapter
  logger.info(`Resuming debug session '${session.name}' (ID: ${sessionId})`);
  const stopInfo = await customRequestAndWaitForStop({
    session,
    sessionId: session.id,
    command: "continue",
    threadId: 0,
    timeout: 30000,
    failureMessage: "Failed to resume debug session (DAP 'continue')",
  });
  // If session terminated without hitting breakpoint, return termination stopInfo
  if (stopInfo.reason === "terminated") {
    throw new Error(
      `Debug session '${session.name}' terminated before hitting a breakpoint.`,
    );
  }
  // Otherwise resolve full breakpoint stopInfo (align with startDebuggingAndWaitForStop output)
  const debugContext = await DAPHelpers.getDebugContext(
    stopInfo.session,
    stopInfo.threadId,
  );

  const orderedScopes = reorderScopesForCapture(debugContext.scopes ?? []);
  const normalizedContext = { ...debugContext, scopes: orderedScopes };

  // Determine which breakpoint was actually hit (exact file + line match) based on provided breakpointConfig.
  let hitBreakpoint: BreakpointDefinition | undefined;
  let hitFunctionBreakpoint: FunctionBreakpointDefinition | undefined;
  const framePath = normalizedContext.frame?.source?.path;
  const frameLine = normalizedContext.frame?.line;
  if (
    framePath
    && typeof frameLine === "number"
    && breakpointConfig?.breakpoints?.length
  ) {
    const normalizedFramePath = normalizeFsPath(framePath);
    for (const bp of breakpointConfig.breakpoints) {
      let absPath: string;
      if (path.isAbsolute(bp.path)) {
        absPath = bp.path;
      }
      else {
        // Smart resolution to find correct workspace folder
        const candidates = [
          session.workspaceFolder?.uri.fsPath,
          ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath),
        ].filter((p): p is string => !!p);

        const found = candidates.find(base =>
          fs.existsSync(path.join(base, bp.path)),
        );
        if (found) {
          absPath = path.join(found, bp.path);
        }
        else {
          // Default resolution
          absPath = path.join(workspaceFolder ?? candidates[0] ?? "", bp.path);
        }
      }
      if (normalizeFsPath(absPath) !== normalizedFramePath) {
        continue;
      }
      // Identify hit breakpoint by checking whether the frame line is one of the resolved snippet matches.
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(absPath),
      );
      const resolvedLines = findAllLineNumbersForSnippet(doc, bp.code);
      if (!resolvedLines.includes(frameLine)) {
        continue;
      }
      hitBreakpoint = {
        ...bp,
        path: absPath,
        line: frameLine,
      };
      break;
    }
  }

  if (
    stopInfo.reason === "function breakpoint"
    && breakpointConfig?.functionBreakpoints?.length
    && typeof normalizedContext.frame?.name === "string"
  ) {
    const frameName = normalizedContext.frame.name;
    const matches = breakpointConfig.functionBreakpoints.filter(
      bp => bp.functionName === frameName,
    );
    if (matches.length === 1) {
      hitFunctionBreakpoint = { ...matches[0] };
    }
  }

  // For capture actions, default to a single step-over (DAP 'next') before collecting variables
  // to avoid pre-assignment values when the breakpoint is set on an assignment line.
  const effectiveHit = hitBreakpoint ?? hitFunctionBreakpoint;
  const isCaptureAction
    = effectiveHit?.onHit === "captureAndContinue"
      || effectiveHit?.onHit === "captureAndStopDebugging";
  const shouldDefaultStepBeforeCapture
    = isCaptureAction
      && effectiveHit?.autoStepOver !== true
      && effectiveHit?.autoStepOver !== false;

  let contextForVariables = normalizedContext;
  if (shouldDefaultStepBeforeCapture) {
    const stepped = await customRequestAndWaitForStop({
      session: stopInfo.session,
      sessionId: stopInfo.session.id,
      command: "next",
      threadId: stopInfo.threadId,
      timeout: 30000,
      failureMessage:
        "capture action default step-over failed: debug adapter did not accept DAP 'next'",
    });
    if (stepped.reason === "terminated") {
      throw new Error(
        "Capture action requested, but the debug session terminated during default step-over.",
      );
    }
    const steppedContext = await DAPHelpers.getDebugContext(
      stepped.session,
      stepped.threadId,
    );
    const steppedScopes = reorderScopesForCapture(steppedContext.scopes ?? []);
    contextForVariables = { ...steppedContext, scopes: steppedScopes };
  }

  const scopeVariables: ScopeVariables[] = [];
  for (const scope of contextForVariables.scopes ?? []) {
    const variables = await DAPHelpers.getVariablesFromReference(
      stopInfo.session,
      scope.variablesReference,
    );
    scopeVariables.push({ scopeName: scope.name, variables });
  }

  // Build variable lookup for interpolation (for capture action log message expansion)
  const variableLookup = new Map<string, string>();
  for (const scope of scopeVariables) {
    for (const v of scope.variables) {
      variableLookup.set(v.name, v.value);
    }
  }

  let capturedLogMessages: string[] | undefined;
  if (
    effectiveHit?.onHit === "captureAndContinue"
    || effectiveHit?.onHit === "captureAndStopDebugging"
  ) {
    const interpolate = (msg: string) =>
      msg.replace(/\{([^{}]+)\}/g, (_m, name) => {
        const raw = variableLookup.get(name);
        return raw !== undefined ? raw : `{${name}}`;
      });
    capturedLogMessages = [];
    for (const bp of breakpointConfig?.breakpoints ?? []) {
      if (bp.logMessage) {
        capturedLogMessages.push(interpolate(bp.logMessage));
      }
    }
    for (const bp of breakpointConfig?.functionBreakpoints ?? []) {
      if (bp.logMessage) {
        capturedLogMessages.push(interpolate(bp.logMessage));
      }
    }
  }

  if (effectiveHit?.onHit === "captureAndStopDebugging") {
    logger.info("Terminating all debug sessions per breakpoint action.");
    await vscode.debug.stopDebugging();
  }
  else if (effectiveHit?.onHit === "captureAndContinue") {
    await tryContinueWithoutWaiting({
      session: stopInfo.session,
      threadId: stopInfo.threadId,
      failureContext: "after capture action",
    });
  }

  const serverReadyInfo: ServerReadyInfo = {
    configured: false,
    triggerMode: "disabled",
    phases: [],
  };

  let debuggerState: DebuggerStateSnapshot;
  if (effectiveHit?.onHit === "captureAndStopDebugging") {
    debuggerState = { status: "terminated" };
  }
  else if (effectiveHit?.onHit === "captureAndContinue") {
    debuggerState = {
      status: "running",
      sessionId: stopInfo.session.id,
      sessionName: stopInfo.session.name,
    };
  }
  else {
    debuggerState = {
      status: "paused",
      sessionId: stopInfo.session.id,
      sessionName: stopInfo.session.name,
    };
  }

  const protocol = buildProtocol(debuggerState);

  const formattedOutput = getSessionOutput(stopInfo.session.id)
    .map((line) => {
      const category = line.category || "output";
      const sanitized = truncateLine(stripAnsiEscapeCodes(line.text).trim());
      if (!sanitized) {
        return undefined;
      }
      return `[${category}] ${sanitized}`;
    })
    .filter((line): line is string => typeof line === "string");
  const totalLines = formattedOutput.length;
  const previewCount = Math.min(MAX_RETURNED_DEBUG_OUTPUT_LINES, totalLines);
  const runtimeOutput: RuntimeOutputPreview = {
    lines:
      previewCount > 0 ? formattedOutput.slice(totalLines - previewCount) : [],
    totalLines,
    truncated: previewCount < totalLines,
  };

  return {
    ...contextForVariables,
    scopeVariables,
    hitBreakpoint: hitBreakpoint ?? undefined,
    hitFunctionBreakpoint: hitFunctionBreakpoint ?? undefined,
    capturedLogMessages,
    serverReadyInfo,
    debuggerState,
    protocol,
    runtimeOutput,
    reason: stopInfo.reason,
    exceptionInfo: stopInfo.exceptionInfo,
  };
}
