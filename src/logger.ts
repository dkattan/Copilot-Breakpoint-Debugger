/* eslint-disable no-console */
import { computed, useLogger } from "reactive-vscode";
import * as vscode from "vscode";

type ConsoleLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "off";
type LogLevel = Exclude<ConsoleLogLevel, "off">;

const levelOrder: Record<ConsoleLogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  off: 5,
};

const baseLogger = useLogger("Copilot Breakpoint Debugger", { toConsole: [] });
export const logChannel = baseLogger;

const consoleLevel = computed<ConsoleLogLevel>(
  () => {
    try {
      const configured = vscode.workspace
        .getConfiguration("copilot-debugger")
        .get<ConsoleLogLevel>("consoleLogLevel");
      return configured ?? "info";
    }
    catch {
      return "info";
    }
  },
);

function shouldMirror(level: LogLevel): boolean {
  const current = consoleLevel.value;
  if (current === "off") {
    return false;
  }
  return levelOrder[level] >= levelOrder[current];
}

function emitConsole(level: LogLevel, message: string, extra: unknown[]) {
  if (!shouldMirror(level)) {
    return;
  }
  const prefix = `[${level.toUpperCase()}]`;
  switch (level) {
    case "trace":
      // Avoid console.trace stack spam; prefer console.info because some VS Code
      // extension test runners do not reliably surface console.debug output.
      console.info(`${prefix} ${message}`, ...extra);
      break;
    case "debug":
      console.debug(`${prefix} ${message}`, ...extra);
      break;
    case "info":
      console.info(`${prefix} ${message}`, ...extra);
      break;
    case "warn":
      console.warn(`${prefix} ${message}`, ...extra);
      break;
    case "error":
      console.error(`${prefix} ${message}`, ...extra);
      break;
  }
}

const infoWriter = baseLogger.info;
const warnWriter = baseLogger.warn;
const errorWriter = baseLogger.error;

type DapConsoleLine = string;

// Some VS Code debug adapter tracker hooks can fire twice for the same DAP message
// (observed in extension tests). In addition, the extension code can be loaded more
// than once within the same extension host process, which would otherwise defeat
// module-local de-duplication.
//
// Keep a small, time-windowed de-dupe cache on globalThis so duplicate lines
// disappear even if multiple logger instances exist.
const dapConsoleDedupeState: {
  seenAtByLine: Map<DapConsoleLine, number>
  lastLine?: DapConsoleLine
  lastLineAt?: number
} = (() => {
  const key = "__copilotDebuggerDapConsoleDedupeState";
  const host = globalThis as unknown as Record<string, unknown>;
  const existing = host[key];
  if (
    typeof existing === "object"
    && existing !== null
    && "seenAtByLine" in existing
    && (existing as { seenAtByLine?: unknown }).seenAtByLine instanceof Map
  ) {
    return existing as {
      seenAtByLine: Map<DapConsoleLine, number>
      lastLine?: DapConsoleLine
      lastLineAt?: number
    };
  }
  const created = { seenAtByLine: new Map<DapConsoleLine, number>() };
  host[key] = created;
  return created;
})();

function shouldEmitDapConsoleLine(line: string): boolean {
  const now = Date.now();

  // Fast-path for the most common failure mode: immediate duplicate print.
  if (dapConsoleDedupeState.lastLine === line) {
    const lastAt = dapConsoleDedupeState.lastLineAt;
    if (typeof lastAt === "number" && now - lastAt < 250) {
      return false;
    }
  }

  const lastSeenAt = dapConsoleDedupeState.seenAtByLine.get(line);
  if (typeof lastSeenAt === "number" && now - lastSeenAt < 250) {
    return false;
  }

  dapConsoleDedupeState.seenAtByLine.set(line, now);
  dapConsoleDedupeState.lastLine = line;
  dapConsoleDedupeState.lastLineAt = now;

  // Keep memory bounded (insertion order is preserved).
  const maxEntries = 2000;
  while (dapConsoleDedupeState.seenAtByLine.size > maxEntries) {
    const first = dapConsoleDedupeState.seenAtByLine.keys().next().value as
      | DapConsoleLine
      | undefined;
    if (!first) {
      break;
    }
    dapConsoleDedupeState.seenAtByLine.delete(first);
  }

  return true;
}

export const logger = {
  trace(message: string, ...extra: unknown[]): void {
    logChannel.info(message);
    // DAP logs are high-signal during investigations and should be visible even when
    // consoleLogLevel is higher than 'trace' (e.g. test runs / CI output).
    if (message.startsWith("[DAP]")) {
      const line = `[TRACE] ${message}`;
      if (!shouldEmitDapConsoleLine(line)) {
        return;
      }
      console.info(line, ...extra);
      return;
    }
    emitConsole("trace", message, extra);
  },
  debug(message: string, ...extra: unknown[]): void {
    logChannel.info(message);
    emitConsole("debug", message, extra);
  },
  info(message: string, ...extra: unknown[]): void {
    infoWriter(message, ...extra);
    emitConsole("info", message, extra);
  },
  warn(message: string, ...extra: unknown[]): void {
    warnWriter(message, ...extra);
    emitConsole("warn", message, extra);
  },
  error(message: string, ...extra: unknown[]): void {
    errorWriter(message, ...extra);
    emitConsole("error", message, extra);
  },
};

export const logging = { logger, logChannel };
