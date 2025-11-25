import type { Buffer } from "node:buffer";
import type { BreakpointHitInfo } from "./common";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import stripAnsi from "strip-ansi";
import * as vscode from "vscode";
import { activeSessions } from "./common";
import { DAPHelpers, type DebugContext, type VariableInfo } from "./debugUtils";
import {
  getSessionExitCode,
  getSessionOutput,
  waitForDebuggerStopBySessionId,
  waitForEntryStop,
} from "./events";
import { logger } from "./logger";

const typescriptCliPath = (() => {
  try {
    return require.resolve("typescript/lib/tsc.js");
  } catch {
    return undefined;
  }
})();

const normalizeFsPath = (value: string) => {
  // Normalize path, convert backslashes, strip trailing slashes.
  // On Windows, make comparison case-insensitive by lowercasing drive letter + entire path.
  const normalized = path
    .normalize(value)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

/**
 * Variables grouped by scope
 */
export interface ScopeVariables {
  scopeName: string;
  variables: VariableInfo[];
  error?: string;
}

/**
 * Call stack information for a debug session
 */
export interface CallStackInfo {
  callStacks: Array<{
    sessionId: string;
    sessionName: string;
    threads?: Array<{
      threadId: number;
      threadName: string;
      stackFrames?: Array<{
        id: number;
        name: string;
        source?: {
          name?: string;
          path?: string;
        };
        line: number;
        column: number;
      }>;
      error?: string;
    }>;
    error?: string;
  }>;
}

/**
 * Structured debug information returned when a breakpoint is hit
 */
export interface DebugInfo {
  breakpoint: BreakpointHitInfo;
  callStack: CallStackInfo | null;
  variables: ScopeVariables[] | null;
  variablesError: string | null;
}

/**
 * Result from starting a debug session
 */
export interface StartDebugSessionResult {
  content: Array<{
    type: "text" | "json";
    text?: string;
    json?: DebugInfo;
  }>;
  isError: boolean;
}

/**
 * List all active debug sessions in the workspace.
 *
 * Exposes debug session information, including each session's ID, name, and associated launch configuration.
 */
export const listDebugSessions = () => {
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
};

const collectBuildDiagnostics = (
  workspaceUri: vscode.Uri,
  maxErrors: number
): vscode.Diagnostic[] => {
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
};

const formatBuildErrors = (diagnostics: vscode.Diagnostic[]): string => {
  if (diagnostics.length === 0) {
    return "";
  }
  const formatted = diagnostics
    .map((diag) => {
      const line = diag.range.start.line + 1;
      const msg =
        diag.message.length > 80
          ? `${diag.message.slice(0, 80)}...`
          : diag.message;
      return `Line ${line}: ${msg}`;
    })
    .join(", ");
  return `Build errors: [${formatted}]. `;
};

const MAX_CAPTURED_TASK_OUTPUT_LINES = 200;

const stripAnsiEscapeCodes = (value: string): string =>
  value ? stripAnsi(value) : "";

interface TaskCompletionResult {
  name: string;
  exitCode?: number;
  outputLines: string[];
}

const missingCommandPatterns = [
  /is not recognized as an internal or external command/i,
  /command not found/i,
];

const formatTaskFailures = (tasks: TaskCompletionResult[]): string => {
  const failed = tasks.filter(
    (task) => typeof task.exitCode === "number" && task.exitCode !== 0
  );
  if (!failed.length) {
    return "";
  }
  const [primary, ...rest] = failed;
  const lines = primary.outputLines.slice(-5);
  const details = lines.length
    ? `\nLast ${lines.length} line(s):\n${lines
        .map((line) => `  ${line}`)
        .join("\n")}`
    : "";
  const additional = rest.length
    ? `\nAdditional failed task(s): ${rest
        .map((task) => `'${task.name}' (exit ${task.exitCode ?? "unknown"})`)
        .join(", ")}`
    : "";
  return `Task '${primary.name}' exited with code ${
    primary.exitCode ?? "unknown"
  }.${details}${additional}\n`;
};

const sanitizeTaskOutput = (text: string): string[] =>
  stripAnsiEscapeCodes(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

const DEBUG_TERMINAL_NAME_PATTERN = /\bdebug\b/i;
const SERVER_READY_TERMINAL_PATTERN = /^serverReady-/i;

const truncateLine = (line: string, maxLength = 160): string => {
  if (line.length <= maxLength) {
    return line;
  }
  return `${line.slice(0, maxLength - 1)}…`;
};

interface TerminalOutputCapture {
  snapshot: () => string[];
  dispose: () => void;
}

interface TerminalDataWriteEvent {
  terminal: vscode.Terminal;
  data: string;
}

type TerminalDataWindow = typeof vscode.window & {
  onDidWriteTerminalData?: (
    listener: (event: TerminalDataWriteEvent) => void,
    thisArgs?: unknown,
    disposables?: vscode.Disposable[]
  ) => vscode.Disposable;
};

const createTerminalOutputCapture = (maxLines: number): TerminalOutputCapture => {
  const terminalDataEmitter = (vscode.window as TerminalDataWindow)
    .onDidWriteTerminalData;
  if (maxLines <= 0 || typeof terminalDataEmitter !== "function") {
    return { snapshot: () => [], dispose: () => undefined };
  }
  const lines: string[] = [];
  const pendingByTerminal = new Map<vscode.Terminal, string>();
  const trackedTerminals = new Set<vscode.Terminal>();
  const initialTerminals = new Set(vscode.window.terminals);
  const pushLine = (terminal: vscode.Terminal, raw: string) => {
    const sanitized = stripAnsiEscapeCodes(raw).trim();
    if (!sanitized) {
      return;
    }
    lines.push(`${terminal.name}: ${truncateLine(sanitized)}`);
    if (lines.length > maxLines) {
      lines.shift();
    }
  };
  const considerTerminal = (terminal: vscode.Terminal): boolean => {
    if (trackedTerminals.has(terminal)) {
      return true;
    }
    if (
      !initialTerminals.has(terminal) ||
      DEBUG_TERMINAL_NAME_PATTERN.test(terminal.name) ||
      SERVER_READY_TERMINAL_PATTERN.test(terminal.name)
    ) {
      trackedTerminals.add(terminal);
      return true;
    }
    return false;
  };
  const flushPending = () => {
    for (const [terminal, remainder] of pendingByTerminal.entries()) {
      if (remainder && remainder.trim()) {
        pushLine(terminal, remainder);
      }
    }
    pendingByTerminal.clear();
  };
  const disposables: vscode.Disposable[] = [];
  disposables.push(
    vscode.window.onDidOpenTerminal((terminal) => {
      if (
        !initialTerminals.has(terminal) ||
        DEBUG_TERMINAL_NAME_PATTERN.test(terminal.name) ||
        SERVER_READY_TERMINAL_PATTERN.test(terminal.name)
      ) {
        trackedTerminals.add(terminal);
      }
    })
  );
  disposables.push(
    terminalDataEmitter((event: TerminalDataWriteEvent) => {
      if (!considerTerminal(event.terminal)) {
        return;
      }
      const combined = (pendingByTerminal.get(event.terminal) ?? "") + event.data;
      const segments = combined.split(/\r?\n/);
      pendingByTerminal.set(event.terminal, segments.pop() ?? "");
      for (const segment of segments) {
        pushLine(event.terminal, segment);
      }
    })
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
      trackedTerminals.clear();
    },
  };
};

const formatRuntimeDiagnosticsMessage = (
  baseMessage: string,
  options: { sessionId?: string; terminalLines: string[]; maxLines: number }
): string => {
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
        .filter((line) => line.category === "stderr")
        .slice(-maxLines)
        .map((line) => truncateLine(stripAnsiEscapeCodes(line.text).trim()))
        .filter((line) => line.length > 0);
      if (stderrLines.length) {
        sections.push(`stderr: ${stderrLines.join(" | ")}`);
      } else {
        const otherLines = sessionOutput
          .slice(-maxLines)
          .map(
            (line) =>
              `${line.category}: ${truncateLine(
                stripAnsiEscapeCodes(line.text).trim()
              )}`
          )
          .filter((line) => line.length > 0);
        if (otherLines.length) {
          sections.push(`output: ${otherLines.join(" | ")}`);
        }
      }
    }
  }
  const sanitizedTerminal = terminalLines
    .slice(-maxLines)
    .map((line) => truncateLine(stripAnsiEscapeCodes(line).trim()))
    .filter((line) => line.length > 0);
  if (sanitizedTerminal.length) {
    sections.push(`terminal: ${sanitizedTerminal.join(" | ")}`);
  }
  if (!sections.length) {
    return baseMessage;
  }
  return `${baseMessage}\nRuntime diagnostics:\n- ${sections.join("\n- ")}`;
};

const resolveCwd = (cwd: string | undefined, baseDir: string) => {
  if (!cwd) {
    return baseDir;
  }
  return path.isAbsolute(cwd) ? cwd : path.join(baseDir, cwd);
};

const collectNodeBinDirs = (startDir: string) => {
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
};

const mergeEnv = (
  baseDir: string,
  env?: Record<string, string>,
  existingBins?: string[]
): NodeJS.ProcessEnv => {
  const merged: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
  };
  const binDirs = existingBins ?? collectNodeBinDirs(baseDir);
  if (binDirs.length) {
    const existingKey = Object.keys(merged).find(
      (key) => key.toLowerCase() === "path"
    );
    const pathKey = existingKey || (process.platform === "win32" ? "Path" : "PATH");
    const current = merged[pathKey] ?? "";
    const segments = current
      ? current.split(path.delimiter).filter((segment) => segment.length > 0)
      : [];
    for (let i = binDirs.length - 1; i >= 0; i -= 1) {
      const dir = binDirs[i];
      if (!segments.includes(dir)) {
        segments.unshift(dir);
      }
    }
    merged[pathKey] = segments.join(path.delimiter);
    logger.debug(
      `Augmented PATH for diagnostic capture with ${binDirs.length} node_modules/.bin directorie(s).`
    );
  }
  return merged;
};

const coerceOutput = (value?: string | Buffer | null) => {
  if (typeof value === "string") {
    return value;
  }
  return value ? value.toString("utf-8") : "";
};

const resolveCommandFromBins = (command: string, binDirs: string[]) => {
  if (/[\\/\s]/.test(command)) {
    return undefined;
  }
  const extensions = process.platform === "win32"
    ? [".cmd", ".bat", ".exe", ""]
    : ["", ".sh"];
  for (const dir of binDirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
};

const isTscCommand = (command: string) => {
  const normalized = path.basename(command).toLowerCase();
  return normalized === "tsc" || normalized === "tsc.cmd";
};

const trimWrappedQuotes = (value: string) => {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

const parseShellCommandLine = (commandLine: string) => {
  const tokens = commandLine.match(/"[^"]+"|'[^']+'|\S+/g);
  if (!tokens || tokens.length === 0) {
    return undefined;
  }
  const normalized = tokens.map((token) => trimWrappedQuotes(token));
  return {
    command: normalized[0],
    args: normalized.slice(1),
  };
};

const shouldRetryWithNpx = (
  command: string,
  result: ReturnType<typeof spawnSync>
) => {
  if (/[\\/\s]/.test(command)) {
    return false;
  }
  const err = result.error as NodeJS.ErrnoException | undefined;
  if (err && err.code === "ENOENT") {
    return true;
  }
  const stderr = (result.stderr ?? "").toString();
  return missingCommandPatterns.some((pattern) => pattern.test(stderr));
};

const runCommandForDiagnostics = (
  command: string,
  args: string[],
  options: Parameters<typeof spawnSync>[2],
  binDirs: string[]
) => {
  let resolvedCommand = command;
  let resolvedArgs = args;
  let routedToTypescript = false;
  if (typescriptCliPath && isTscCommand(command)) {
    resolvedCommand = process.execPath;
    resolvedArgs = [typescriptCliPath, ...args];
    routedToTypescript = true;
  } else {
    resolvedCommand = resolveCommandFromBins(command, binDirs) ?? command;
  }
  const direct = spawnSync(resolvedCommand, resolvedArgs, options);
  if (routedToTypescript || !shouldRetryWithNpx(command, direct)) {
    return direct;
  }
  logger.warn(
    `Command '${command}' unavailable when capturing diagnostics. Retrying via npx.`
  );
  const npxExecutable = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnSync(npxExecutable, [command, ...args], {
    ...options,
    shell: true,
  });
};

const collectTypescriptCliOutput = (cwd: string) => {
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
      }
    );
    const lines = [
      ...sanitizeTaskOutput(coerceOutput(result.stdout)),
      ...sanitizeTaskOutput(coerceOutput(result.stderr)),
    ];
    return lines.slice(-MAX_CAPTURED_TASK_OUTPUT_LINES);
  } catch (err) {
    logger.warn(
      `Failed to collect TypeScript CLI output: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return [];
  }
};

const captureShellExecutionOutput = (
  execution: vscode.ShellExecution,
  baseCwd: string
): string[] => {
  const cwd = resolveCwd(execution.options?.cwd, baseCwd);
  const binDirs = collectNodeBinDirs(baseCwd);
  const env = mergeEnv(baseCwd, execution.options?.env, binDirs);
  let result: ReturnType<typeof spawnSync> | undefined;
  if (execution.command) {
    const command =
      typeof execution.command === "string"
        ? execution.command
        : execution.command.value;
    const args = (execution.args || []).map((arg) =>
      typeof arg === "string" ? arg : arg.value
    );
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
      binDirs
    );
  } else if (execution.commandLine) {
    const parsed = parseShellCommandLine(execution.commandLine);
    if (parsed) {
      result = runCommandForDiagnostics(
        parsed.command,
        parsed.args,
        {
          cwd,
          env,
          shell: process.platform === "win32",
          encoding: "utf-8",
          maxBuffer: 1024 * 1024,
        },
        binDirs
      );
    } else {
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
};

const captureProcessExecutionOutput = (
  execution: vscode.ProcessExecution,
  baseCwd: string
): string[] => {
  const cwd = resolveCwd(execution.options?.cwd, baseCwd);
  const binDirs = collectNodeBinDirs(baseCwd);
  const env = mergeEnv(baseCwd, execution.options?.env, binDirs);
  const result = runCommandForDiagnostics(
    execution.process,
    execution.args || [],
    {
      cwd,
      env,
      shell: process.platform === "win32",
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
    },
    binDirs
  );
  const lines = [
    ...sanitizeTaskOutput(coerceOutput(result.stdout)),
    ...sanitizeTaskOutput(coerceOutput(result.stderr)),
  ];
  return lines.slice(-MAX_CAPTURED_TASK_OUTPUT_LINES);
};

const captureTaskOutputLines = (
  taskExecution: vscode.TaskExecution,
  baseCwd: string
): string[] => {
  const execution = taskExecution.task.execution;
  if (!execution) {
    logger.warn(
      `Task ${taskExecution.task.name} does not expose execution details; unable to capture output.`
    );
    return [];
  }
  const isShellExecution = (
    candidate: typeof execution
  ): candidate is vscode.ShellExecution => {
    const shellCandidate = candidate as vscode.ShellExecution;
    return (
      typeof shellCandidate.commandLine === "string" ||
      typeof shellCandidate.command !== "undefined"
    );
  };
  const isProcessExecution = (
    candidate: typeof execution
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
      `Task ${taskExecution.task.name} uses unsupported execution type; unable to capture output.`
    );
  } catch (err) {
    logger.warn(
      `Failed to capture task output for ${taskExecution.task.name}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  return [];
};

const monitorTask = (
  taskExecution: vscode.TaskExecution,
  baseCwd: string
): Promise<TaskCompletionResult> => {
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
          complete({
            name: taskExecution.task.name,
            exitCode,
            outputLines:
              typeof exitCode === "number" && exitCode !== 0
                ? captureTaskOutputLines(taskExecution, baseCwd)
                : [],
          });
        }
      })
    );

    disposables.push(
      vscode.tasks.onDidEndTask((event) => {
        if (event.execution === taskExecution) {
          complete({
            name: taskExecution.task.name,
            exitCode: undefined,
            outputLines: [],
          });
        }
      })
    );

    disposables.push(
      vscode.tasks.onDidStartTaskProcess((event) => {
        if (event.execution === taskExecution && event.processId === undefined) {
          fail(
            new Error(
              `Failed to start task ${taskExecution.task.name}. Terminal could not be created.`
            )
          );
        }
      })
    );
  });
};

/**
 * Start a new debug session using either a named configuration from .vscode/launch.json or a direct configuration object,
 * then wait until a breakpoint is hit before returning with detailed debug information.
 *
 * @param params - Object containing workspaceFolder, nameOrConfiguration, and optional variableFilter.
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
export const startDebuggingAndWaitForStop = async (params: {
  sessionName: string;
  workspaceFolder: string; // absolute path to open workspace folder
  nameOrConfiguration?: string; // may be omitted; auto-selection logic will attempt resolution
  timeoutSeconds?: number; // optional override; falls back to workspace setting copilot-debugger.entryTimeoutSeconds
  breakpointConfig: {
    breakpoints: Array<{
      path: string;
      line: number;
      condition?: string;
      hitCount?: number; // numeric hit count (exact)
      logMessage?: string;
      variableFilter?: string[]; // optional; when capture and omitted we auto-capture all locals (bounded in StartDebuggerTool)
      action?: "break" | "stopDebugging" | "capture"; // 'capture' collects data + log messages then continues
      reasonCode?: string; // internal telemetry tag
    }>;
  };
  serverReady?: {
    trigger?: { path?: string; line?: number; pattern?: string };
    action:
      | { shellCommand: string }
      | {
          httpRequest: {
            url: string;
            method?: string;
            headers?: Record<string, string>;
            body?: string;
          };
        }
      | { vscodeCommand: { command: string; args?: unknown[] } }
      | {
          type: "httpRequest";
          url: string;
          method?: string;
          headers?: Record<string, string>;
          body?: string;
        }
      | { type: "shellCommand"; shellCommand: string }
      | { type: "vscodeCommand"; command: string; args?: unknown[] };
  };
  /**
   * When true, the caller indicates the debug session should use the user's existing breakpoints
   * (e.g. from the UI) instead of prompting for a single file+line. The current implementation expects
   * breakpointConfig to be supplied (the manual command derives it from existing breakpoints) but this flag
   * documents intent and allows future internal logic changes without altering the call sites.
   * Defaults to false.
   */
  useExistingBreakpoints?: boolean;
}): Promise<
  DebugContext & {
    scopeVariables: ScopeVariables[];
    hitBreakpoint?: {
      path: string;
      line: number;
      variableFilter?: string[];
      action?: "break" | "stopDebugging" | "capture";
      logMessage?: string;
      reasonCode?: string;
    };
    capturedLogMessages?: string[];
  }
> => {
  const {
    sessionName,
    workspaceFolder,
    nameOrConfiguration,
    timeoutSeconds: timeoutOverride,
    breakpointConfig,
    serverReady,
    useExistingBreakpoints: _useExistingBreakpoints = false,
  } = params;

  // Helper to execute configured serverReady action
  const executeServerReadyAction = async (
    phase: "entry" | "late" | "immediate"
  ) => {
    if (!serverReady) {
      return;
    }
    try {
      // Determine action shape (new flat with type discriminator OR legacy union)
      type FlatAction =
        | {
            type: "httpRequest";
            url: string;
            method?: string;
            headers?: Record<string, string>;
            body?: string;
          }
        | { type: "shellCommand"; shellCommand: string }
        | { type: "vscodeCommand"; command: string; args?: unknown[] };
      type LegacyAction =
        | { shellCommand: string }
        | {
            httpRequest: {
              url: string;
              method?: string;
              headers?: Record<string, string>;
              body?: string;
            };
          }
        | { vscodeCommand: { command: string; args?: unknown[] } };
      const actionAny: FlatAction | LegacyAction = serverReady.action as
        | FlatAction
        | LegacyAction;
      let discriminator: string | undefined;
      if ("type" in (actionAny as object)) {
        discriminator = (actionAny as { type: string }).type;
      }
      const kind =
        discriminator ||
        ("shellCommand" in actionAny
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
          });
          terminal.sendText(cmd, true);
          logger.info(`Executed serverReady shellCommand (${phase}): ${cmd}`);
          break;
        }
        case "httpRequest": {
          const url = discriminator
            ? (actionAny as FlatAction & { url: string }).url
            : (actionAny as { httpRequest?: { url?: string } }).httpRequest
                ?.url;
          if (!url) {
            logger.warn("serverReady httpRequest missing url.");
            return;
          }
          const method = discriminator
            ? (actionAny as FlatAction & { method?: string }).method ?? "GET"
            : (actionAny as { httpRequest?: { method?: string } }).httpRequest
                ?.method ?? "GET";
          const headers = discriminator
            ? (actionAny as FlatAction & { headers?: Record<string, string> })
                .headers
            : (
                actionAny as {
                  httpRequest?: { headers?: Record<string, string> };
                }
              ).httpRequest?.headers;
          const body = discriminator
            ? (actionAny as FlatAction & { body?: string }).body
            : (actionAny as { httpRequest?: { body?: string } }).httpRequest
                ?.body;
          logger.info(
            `Dispatching serverReady httpRequest (${phase}) to ${url} method=${method}`
          );
          void fetch(url, { method, headers, body })
            .then((resp) => {
              logger.info(
                `serverReady httpRequest (${phase}) response status=${resp.status}`
              );
            })
            .catch((httpErr) => {
              logger.error(
                `serverReady httpRequest (${phase}) failed: ${
                  httpErr instanceof Error ? httpErr.message : String(httpErr)
                }`
              );
            });
          break;
        }
        case "vscodeCommand": {
          const command = discriminator
            ? (actionAny as FlatAction & { command: string }).command
            : (actionAny as { vscodeCommand?: { command?: string } })
                .vscodeCommand?.command;
          if (!command) {
            logger.warn("serverReady vscodeCommand missing command id.");
            return;
          }
          const args = discriminator
            ? (actionAny as FlatAction & { args?: unknown[] }).args ?? []
            : (actionAny as { vscodeCommand?: { args?: unknown[] } })
                .vscodeCommand?.args ?? [];
          logger.info(
            `Executing serverReady vscodeCommand (${phase}): ${command}`
          );
          try {
            const result = await vscode.commands.executeCommand(
              command,
              ...args
            );
            logger.debug(
              `serverReady vscodeCommand (${phase}) result: ${JSON.stringify(
                result
              )}`
            );
          } catch (cmdErr) {
            logger.error(
              `serverReady vscodeCommand (${phase}) failed: ${
                cmdErr instanceof Error ? cmdErr.message : String(cmdErr)
              }`
            );
          }
          break;
        }
        default:
          logger.warn("serverReady action type not recognized; skipping.");
      }
    } catch (err) {
      logger.error(
        `Failed executing serverReady action (${phase}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  };

  // Basic breakpoint configuration validation (moved from StartDebuggerTool)
  if (!breakpointConfig || !Array.isArray(breakpointConfig.breakpoints)) {
    throw new Error("breakpointConfig.breakpoints is required.");
  }
  if (breakpointConfig.breakpoints.length === 0) {
    throw new Error(
      "Provide at least one breakpoint (path + line) before starting the debugger."
    );
  }
  for (const bp of breakpointConfig.breakpoints) {
    if (
      bp.action === "capture" &&
      bp.variableFilter &&
      bp.variableFilter.length === 0
    ) {
      throw new Error(
        `Breakpoint at ${bp.path}:${bp.line} has empty variableFilter (omit entirely for auto-capture or provide at least one name).`
      );
    }
  }
  if (!path.isAbsolute(workspaceFolder)) {
    throw new Error(
      `workspaceFolder must be an absolute path to an open workspace folder. Received '${workspaceFolder}'.`
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
      .map((f) => `${f.name} -> ${f.uri.fsPath}`)
      .join(", ")}`
  );
  logger.debug(
    `Looking for workspace folder (resolved): ${resolvedWorkspaceFolder}`
  );

  const normalizedFolders = workspaceFolders.map((f) => ({
    folder: f,
    normalized: normalizeFsPath(f.uri.fsPath),
  }));
  const folderEntry = normalizedFolders.find(
    (f) => f.normalized === normalizedRequestedFolder
  );
  const folder = folderEntry?.folder;
  if (!folder) {
    throw new Error(
      `Workspace folder '${workspaceFolder}' is not currently open. Open folders: ${workspaceFolders
        .map((f) => f.uri.fsPath)
        .join(", ")}`
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
      `Backing up and removing ${originalBreakpoints.length} existing breakpoint(s) for isolated debug session.`
    );
    vscode.debug.removeBreakpoints(originalBreakpoints);
  }

  const seen = new Set<string>();
  // Keep association between original request and created SourceBreakpoint
  const validated: Array<{
    bp: (typeof breakpointConfig.breakpoints)[number];
    sb: vscode.SourceBreakpoint;
  }> = [];
  for (const bp of breakpointConfig.breakpoints) {
    const absolutePath = path.isAbsolute(bp.path)
      ? bp.path
      : path.join(folderFsPath, bp.path);
    try {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(absolutePath)
      );
      const lineCount = doc.lineCount;
      if (bp.line < 1 || bp.line > lineCount) {
        logger.warn(
          `Skipping breakpoint ${absolutePath}:${bp.line} (out of range, file has ${lineCount} lines).`
        );
        continue;
      }
      const key = `${absolutePath}:${bp.line}`;
      if (seen.has(key)) {
        logger.debug(`Skipping duplicate breakpoint ${key}.`);
        continue;
      }
      seen.add(key);
      const uri = vscode.Uri.file(absolutePath);
      const location = new vscode.Position(bp.line - 1, 0);
      const effectiveHitCondition =
        bp.hitCount !== undefined ? String(bp.hitCount) : undefined;
      // For 'capture' action we intentionally do NOT pass bp.logMessage to SourceBreakpoint.
      // Passing a logMessage turns the breakpoint into a logpoint (non-pausing) in many adapters.
      // Capture semantics require a real pause to gather variables, then we auto-continue.
      const adapterLogMessage =
        bp.action === "capture" ? undefined : bp.logMessage;
      const sourceBp = new vscode.SourceBreakpoint(
        new vscode.Location(uri, location),
        true,
        bp.condition,
        effectiveHitCondition,
        adapterLogMessage
      );
      validated.push({ bp, sb: sourceBp });
    } catch (e) {
      logger.error(
        `Failed to open file for breakpoint path ${absolutePath}: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  }
  // Optional serverReady breakpoint (declare early so scope is available later)
  let serverReadySource: vscode.SourceBreakpoint | undefined;
  if (
    serverReady?.trigger?.path &&
    typeof serverReady.trigger.line === "number"
  ) {
    const serverReadyPath = path.isAbsolute(serverReady.trigger.path)
      ? serverReady.trigger.path!
      : path.join(folderFsPath, serverReady.trigger.path!);
    try {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(serverReadyPath)
      );
      const lineCount = doc.lineCount;
      const duplicate = validated.some((v) => {
        const existingPath = v.sb.location.uri.fsPath;
        const existingLine = v.sb.location.range.start.line + 1;
        return (
          existingPath === serverReadyPath &&
          existingLine === serverReady.trigger!.line
        );
      });
      if (
        serverReady.trigger.line! < 1 ||
        serverReady.trigger.line! > lineCount ||
        duplicate
      ) {
        logger.warn(
          `ServerReady breakpoint invalid or duplicate (${serverReadyPath}:${serverReady.trigger.line}); ignoring.`
        );
      } else {
        serverReadySource = new vscode.SourceBreakpoint(
          new vscode.Location(
            vscode.Uri.file(serverReadyPath),
            new vscode.Position(serverReady.trigger.line! - 1, 0)
          ),
          true
        );
      }
    } catch (e) {
      logger.error(
        `Failed to open serverReady file ${serverReadyPath}: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  }
  if (validated.length) {
    vscode.debug.addBreakpoints(validated.map((v) => v.sb));
    logger.info(`Added ${validated.length} validated breakpoint(s).`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  } else {
    logger.warn("No valid breakpoints to add after validation.");
  }
  if (serverReadySource) {
    vscode.debug.addBreakpoints([serverReadySource]);
    logger.info(
      `Added serverReady breakpoint at ${
        serverReadySource.location.uri.fsPath
      }:$${serverReadySource.location.range.start.line + 1}`
    );
  }

  // Resolve launch configuration: always inject stopOnEntry=true to ensure early pause, but never synthesize a generic config.
  // Determine effective timeout
  const settings = vscode.workspace.getConfiguration(
    "copilot-debugger",
    folder.uri
  );
  const settingTimeout = settings.get<number>("entryTimeoutSeconds");
  const settingMaxBuildErrors = settings.get<number>("maxBuildErrors");
  const maxRuntimeOutputLines = settings.get<number>("maxOutputLines") ?? 50;
  const terminalCapture = createTerminalOutputCapture(maxRuntimeOutputLines);
  const withRuntimeDiagnostics = (message: string, sessionId?: string) =>
    formatRuntimeDiagnosticsMessage(message, {
      sessionId,
      terminalLines: terminalCapture.snapshot(),
      maxLines: maxRuntimeOutputLines,
    });
  const effectiveMaxBuildErrors =
    typeof settingMaxBuildErrors === "number" && settingMaxBuildErrors > 0
      ? settingMaxBuildErrors
      : 5;
  const buildFailureDetails = async (baseMessage: string) => {
    const diagnostics = collectBuildDiagnostics(
      folder.uri,
      effectiveMaxBuildErrors
    );
    const taskResults = await Promise.all(trackedTaskPromises);
    const shouldCaptureTypescriptCli =
      !!typescriptCliPath &&
      taskResults.some((result) =>
        result.name.toLowerCase().includes("tsc")
      ) &&
      taskResults.every((result) => result.outputLines.length === 0);
    const typescriptCliLines = shouldCaptureTypescriptCli
      ? collectTypescriptCliOutput(folderFsPath)
      : [];
    const augmentedTaskResults = typescriptCliLines.length
      ? [
          {
            name: "TypeScript CLI (--noEmit)",
            exitCode: 1,
            outputLines: typescriptCliLines,
          } as TaskCompletionResult,
          ...taskResults,
        ]
      : taskResults;
    const trackedAnyTasks = trackedTaskPromises.length > 0;
    const hasTaskFailures = augmentedTaskResults.some(
      (result) => typeof result.exitCode === "number" && result.exitCode !== 0
    );
    const hasDiagnostics = trackedAnyTasks && diagnostics.length > 0;
    if (!hasTaskFailures && !hasDiagnostics) {
      return undefined;
    }
    const diagnosticText = formatBuildErrors(diagnostics);
    const taskFailureText = formatTaskFailures(augmentedTaskResults);
    return `${baseMessage}\n${diagnosticText}${taskFailureText}`
      .trim()
      .replace(/\n{3,}/g, "\n\n");
  };
  const effectiveTimeoutSeconds =
    typeof timeoutOverride === "number" && timeoutOverride > 0
      ? timeoutOverride
      : typeof settingTimeout === "number" && settingTimeout > 0
      ? settingTimeout
      : 60;

  // Resolve launch configuration name: provided -> setting -> single config auto-select
  let effectiveLaunchName = nameOrConfiguration;
  if (!effectiveLaunchName) {
    const settingDefault = settings.get<string>("defaultLaunchConfiguration");
    effectiveLaunchName = settingDefault;
  }
  const launchConfig = vscode.workspace.getConfiguration("launch", folder.uri);
  const allConfigs =
    (launchConfig.get<unknown>(
      "configurations"
    ) as vscode.DebugConfiguration[]) || [];
  if (!effectiveLaunchName) {
    if (allConfigs.length === 1 && allConfigs[0].name) {
      effectiveLaunchName = allConfigs[0].name;
      logger.info(
        `[startDebuggingAndWaitForStop] Auto-selected sole launch configuration '${effectiveLaunchName}'.`
      );
    } else {
      throw new Error(
        "No launch configuration specified. Provide nameOrConfiguration, set copilot-debugger.defaultLaunchConfiguration, or define exactly one configuration."
      );
    }
  }
  const found = allConfigs.find((c) => c.name === effectiveLaunchName);
  if (!found) {
    throw new Error(
      `Launch configuration '${effectiveLaunchName}' not found in ${folder.uri.fsPath}. Add it to .vscode/launch.json.`
    );
  }
  const resolvedConfig = { ...found };
  // Inject stopOnEntry if not already present (harmless if adapter ignores it)
  // Always force stopOnEntry true (adapter may ignore)
  (resolvedConfig as Record<string, unknown>).stopOnEntry = true;

  const effectiveSessionName = sessionName || resolvedConfig.name || "";
  logger.info(
    `Starting debugger with configuration '${resolvedConfig.name}' (stopOnEntry forced to true). Waiting for first stop event.`
  );
  // Prepare entry stop listener BEFORE starting debugger to capture session id.
  const existingIds = activeSessions.map((s) => s.id);
  const entryStopPromise = waitForEntryStop({
    excludeSessionIds: existingIds,
    timeout: effectiveTimeoutSeconds * 1000,
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
            }`
          );
          return {
            name: event.execution.task.name,
            exitCode: undefined,
            outputLines: [],
          } as TaskCompletionResult;
        }
      );
      trackedTaskPromises.push(monitored);
    });
  }

  taskTrackingArmed = true;
  const success = await vscode.debug.startDebugging(folder, resolvedConfig);
  taskTrackingArmed = false;
  if (!success) {
    const baseMessage = `Failed to start debug session '${effectiveSessionName}'.`;
    const augmented = await buildFailureDetails(baseMessage);
    throw new Error(augmented ?? baseMessage);
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
          `Debug session '${effectiveSessionName}' terminated before hitting entry.`,
          entryStop.session.id
        )
      );
    }
    const sessionId = entryStop.session.id;
    // Determine if entry stop is serverReady breakpoint
    // Tolerate serverReady breakpoint being the first ("entry") stop even if a user breakpoint
    // might also be hit first in some adapters. We only require line equality; path mismatch is
    // highly unlikely and path normalization differences previously caused false negatives.
    // This broadened check ensures we properly detect and continue past serverReady to user breakpoint.
    const isServerReadyHit =
      !!serverReadySource && entryStop.line === serverReady?.trigger?.line;
    // Decide whether to continue immediately (entry not at user breakpoint OR serverReady hit)
    const entryLineZeroBased = entryStop.line ? entryStop.line - 1 : -1;
    const hitRequestedBreakpoint = validated.some(
      (v) => v.sb.location.range.start.line === entryLineZeroBased
    );
    logger.info(
      `EntryStop diagnostics: line=${entryStop.line} serverReadyLine=${serverReady?.trigger?.line} isServerReadyHit=${isServerReadyHit} hitRequestedBreakpoint=${hitRequestedBreakpoint}`
    );
    if (!hitRequestedBreakpoint || isServerReadyHit) {
      logger.debug(
        isServerReadyHit
          ? `Entry stop is serverReady breakpoint; executing command then continuing.`
          : `Entry stop for session ${sessionId} not at requested breakpoint; continuing to first user breakpoint.`
      );
      if (isServerReadyHit && serverReady) {
        await executeServerReadyAction("entry");
      }
      try {
        // Remove serverReady breakpoint BEFORE continuing to avoid immediate re-stop
        if (isServerReadyHit && serverReadySource) {
          vscode.debug.removeBreakpoints([serverReadySource]);
          logger.debug("Removed serverReady breakpoint prior to continue.");
        }
        await entryStop.session.customRequest("continue", {
          threadId: entryStop.threadId,
        });
      } catch (e) {
        logger.warn(
          `Failed to continue after entry stop: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
      finalStop = await waitForDebuggerStopBySessionId({
        sessionId,
        timeout: remainingMs,
      });
    } else {
      finalStop = entryStop; // entry coincides with user breakpoint
    }
    if (finalStop.reason === "terminated") {
      throw new Error(
        withRuntimeDiagnostics(
          `Debug session '${effectiveSessionName}' terminated before hitting a user breakpoint.`,
          finalStop.session.id
        )
      );
    }
    // If serverReady was NOT the entry stop but becomes the first user stop, process it now then continue.
    if (
      !isServerReadyHit &&
      serverReadySource &&
      finalStop.line === serverReady?.trigger?.line
    ) {
      logger.info(
        `Processing serverReady breakpoint post-entry at line ${finalStop.line}. Executing serverReady action then continuing to user breakpoint.`
      );
      await executeServerReadyAction("late");
      // Remove serverReady breakpoint to avoid re-trigger
      vscode.debug.removeBreakpoints([serverReadySource]);
      try {
        await finalStop.session.customRequest("continue", {
          threadId: finalStop.threadId,
        });
      } catch (contErr) {
        logger.warn(
          `Failed to continue after late serverReady processing: ${
            contErr instanceof Error ? contErr.message : String(contErr)
          }`
        );
      }
      // Wait for the actual user breakpoint
      const nextStop = await waitForDebuggerStopBySessionId({
        sessionId: finalStop.session.id,
        timeout: remainingMs,
      });
      if (nextStop.reason === "terminated") {
        throw new Error(
          withRuntimeDiagnostics(
            `Debug session '${effectiveSessionName}' terminated after serverReady processing before hitting a user breakpoint.`,
            finalStop.session.id
          )
        );
      }
      finalStop = nextStop;
    }
    // Deterministic advancement: some adapters may re-stop on the serverReady line after continue.
    // If still on serverReady and a user breakpoint exists immediately after, perform explicit step(s) to reach it.
    if (
      isServerReadyHit &&
      serverReady?.trigger?.line &&
      finalStop.line === serverReady.trigger.line
    ) {
      const userNextLine = serverReady.trigger.line + 1;
      const hasUserNext = validated.some(
        (v) => v.sb.location.range.start.line === userNextLine - 1
      );
      if (hasUserNext) {
        logger.info(
          `Advancing from serverReady line ${serverReady.trigger.line} to user breakpoint line ${userNextLine} via step(s).`
        );
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await finalStop.session.customRequest("next", {
              threadId: finalStop.threadId,
            });
          } catch (stepErr) {
            logger.warn(
              `Step attempt ${attempt + 1} failed: ${
                stepErr instanceof Error ? stepErr.message : String(stepErr)
              }`
            );
            break;
          }
          try {
            const stepped = await waitForDebuggerStopBySessionId({
              sessionId: finalStop.session.id,
              timeout: remainingMs,
            });
            if (stepped.reason === "terminated") {
              logger.warn(
                "Session terminated during serverReady advancement step."
              );
              finalStop = stepped;
              break;
            }
            finalStop = stepped;
            if (finalStop.line === userNextLine) {
              logger.info(
                `Reached user breakpoint line ${userNextLine} after ${
                  attempt + 1
                } step(s).`
              );
              break;
            }
          } catch (waitErr) {
            logger.warn(
              `Wait after step attempt ${attempt + 1} failed: ${
                waitErr instanceof Error ? waitErr.message : String(waitErr)
              }`
            );
            break;
          }
        }
      }
    }
    debugContext = await DAPHelpers.getDebugContext(
      finalStop.session,
      finalStop.threadId
    );
    const scopeVariables: ScopeVariables[] = [];
    for (const scope of debugContext.scopes ?? []) {
      const variables = await DAPHelpers.getVariablesFromReference(
        finalStop.session,
        scope.variablesReference
      );
      scopeVariables.push({ scopeName: scope.name, variables });
    }
    // Determine which breakpoint was actually hit (exact file + line match)
    let hitBreakpoint:
      | {
          path: string;
          line: number;
          variableFilter?: string[];
          action?: "break" | "stopDebugging" | "capture";
          logMessage?: string;
          reasonCode?: string;
        }
      | undefined;
    const framePath = debugContext.frame?.source?.path;
    const frameLine = debugContext.frame?.line;
    if (framePath && typeof frameLine === "number") {
      const normalizedFramePath = normalizeFsPath(framePath);
      for (const { bp } of validated) {
        const absPath = path.isAbsolute(bp.path)
          ? bp.path
          : path.join(folderFsPath, bp.path);
        if (
          normalizeFsPath(absPath) === normalizedFramePath &&
          bp.line === frameLine
        ) {
          hitBreakpoint = {
            path: absPath,
            line: bp.line,
            variableFilter: bp.variableFilter,
            action: bp.action,
            logMessage: bp.logMessage,
            reasonCode: bp.reasonCode,
          };
          break;
        }
      }
    }
    // Build variable lookup for interpolation (for capture action log message expansion)
    const variableLookup = new Map<string, string>();
    for (const scope of scopeVariables) {
      for (const v of scope.variables) {
        variableLookup.set(v.name, v.value);
      }
    }
    let capturedLogMessages: string[] | undefined;
    if (hitBreakpoint?.action === "capture") {
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
    }
    if (hitBreakpoint?.action === "stopDebugging") {
      logger.info(`Terminating all debug sessions per breakpoint action.`);
      await vscode.debug.stopDebugging();
      const now = Date.now();
      while (vscode.debug.activeDebugSession) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const waitTime = Date.now() - now;
      logger.info(`All debug sessions terminated after ${waitTime}ms.`);
    } else if (hitBreakpoint?.action === "capture") {
      try {
        logger.debug(
          `Continuing debug session ${finalStop.session.id} after capture action.`
        );
        await finalStop.session.customRequest("continue", {
          threadId: finalStop.threadId,
        });
      } catch (continueErr) {
        logger.warn(
          `Failed to continue after capture action: ${
            continueErr instanceof Error
              ? continueErr.message
              : String(continueErr)
          }`
        );
      }
    }
    return {
      ...debugContext,
      scopeVariables,
      hitBreakpoint,
      capturedLogMessages,
    };
  } catch (error) {
    taskTrackingArmed = false;
    const baseMessage =
      error instanceof Error ? error.message : String(error);
    const augmented = await buildFailureDetails(baseMessage);
    if (augmented) {
      throw new Error(augmented);
    }
    throw error;
  } finally {
    taskTrackingArmed = false;
    terminalCapture.dispose();
    taskStartDisposable?.dispose();
    // Restore original breakpoints, removing any added ones first
    const current = vscode.debug.breakpoints;
    if (current.length) {
      // Remove only the breakpoints we added (avoid touching restored originals twice)
      const currentSource = current.filter(
        (bp) => bp instanceof vscode.SourceBreakpoint
      ) as vscode.SourceBreakpoint[];
      const addedKeys = new Set(
        validated.map(
          (v) => `${v.sb.location.uri.fsPath}:${v.sb.location.range.start.line}`
        )
      );
      const toRemove = currentSource.filter((sb) =>
        addedKeys.has(
          `${sb.location.uri.fsPath}:${sb.location.range.start.line}`
        )
      );
      if (toRemove.length) {
        vscode.debug.removeBreakpoints(toRemove);
        logger.debug(
          `Removed ${toRemove.length} session breakpoint(s) before restoring originals.`
        );
      }
    }
    if (originalBreakpoints.length) {
      vscode.debug.addBreakpoints(originalBreakpoints);
      logger.debug(
        `Restored ${originalBreakpoints.length} original breakpoint(s).`
      );
    } else {
      logger.debug("No original breakpoints to restore.");
    }
  }
};

/**
 * Stop debug sessions that match the provided session name.
 *
 * @param params - Object containing the sessionName to stop.
 * @param params.sessionName - Name of the debug session(s) to stop.
 */
export const stopDebugSession = async (params: { sessionName: string }) => {
  const { sessionName } = params;
  // Filter active sessions to find matching sessions.
  const matchingSessions = activeSessions.filter(
    (session: vscode.DebugSession) => session.name === sessionName
  );

  if (matchingSessions.length === 0) {
    throw new Error(`No debug session(s) found with name '${sessionName}'.`);
  }

  // Stop each matching debug session.
  for (const session of matchingSessions) {
    await vscode.debug.stopDebugging(session);
  }
};
/**
 * Resume execution of a debug session that has been paused (e.g., by a breakpoint).
 *
 * @param params - Object containing the sessionId of the debug session to resume and optional waitForStop flag.
 * @param params.sessionId - ID of the debug session to resume.
 * @param params.breakpointConfig - Optional configuration for managing breakpoints when resuming.
 * @param params.breakpointConfig.breakpoints - Array of breakpoint configurations to set before resuming.
 */
export const resumeDebugSession = async (params: {
  sessionId: string;
  breakpointConfig?: {
    breakpoints?: Array<{
      path: string;
      line: number;
      condition?: string;
      hitCount?: number;
      logMessage?: string;
    }>;
  };
}) => {
  const { sessionId, breakpointConfig } = params;

  // Find the session with the given ID
  let session = activeSessions.find((s) => s.id === sessionId);

  // If not found by ID, try to find by name pattern (VSCode creates child sessions with modified names)
  if (!session) {
    // Look for a session whose name contains the session ID
    session = activeSessions.find((s) => s.name.includes(sessionId));
  }

  if (!session) {
    return {
      content: [
        {
          type: "text",
          text: `No debug session found with ID '${sessionId}'.`,
        },
      ],
      isError: true,
    };
  }

  // Handle breakpoint configuration if provided
  if (breakpointConfig) {
    // Add new breakpoints if provided
    if (
      breakpointConfig.breakpoints &&
      breakpointConfig.breakpoints.length > 0
    ) {
      // Get workspace folder from session configuration
      const workspaceFolder =
        session.workspaceFolder?.uri.fsPath ||
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) {
        throw new Error(
          "Cannot determine workspace folder for breakpoint paths"
        );
      }

      const newBreakpoints = breakpointConfig.breakpoints.map((bp) => {
        const absolutePath = path.isAbsolute(bp.path)
          ? bp.path
          : path.join(workspaceFolder, bp.path);
        const uri = vscode.Uri.file(absolutePath);
        const location = new vscode.Position(bp.line - 1, 0); // VSCode uses 0-based line numbers
        const hitCond =
          bp.hitCount !== undefined ? String(bp.hitCount) : undefined;
        return new vscode.SourceBreakpoint(
          new vscode.Location(uri, location),
          true, // enabled
          bp.condition,
          hitCond,
          bp.logMessage
        );
      });
      vscode.debug.addBreakpoints(newBreakpoints);
    }
  }

  // Send the continue request to the debug adapter
  logger.info(`Resuming debug session '${session.name}' (ID: ${sessionId})`);
  const stopPromise = waitForDebuggerStopBySessionId({
    sessionId: session.id,
  });
  await session.customRequest("continue", { threadId: 0 }); // 0 means all threads
  const stopInfo = await stopPromise;
  // If session terminated without hitting breakpoint, return termination stopInfo
  if (stopInfo.reason === "terminated") {
    throw new Error(
      `Debug session '${session.name}' terminated before hitting a breakpoint.`
    );
  }
  // Otherwise resolve full breakpoint stopInfo
  return await DAPHelpers.getDebugContext(stopInfo.session, stopInfo.threadId);
};
