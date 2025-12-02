/* eslint-disable no-console */
import * as vscode from "vscode";

// Log levels (ordered by verbosity)
export enum LogLevel {
  Trace = 0,
  Debug = 1,
  Info = 2,
  Warn = 3,
  Error = 4,
  Off = 5,
}

// Shared log output channel for the extension
export const logChannel = vscode.window.createOutputChannel(
  "Copilot Breakpoint Debugger",
  { log: true }
);

function parseLogLevel(raw: string | undefined): LogLevel {
  if (!raw) {
    return LogLevel.Info;
  }
  switch (raw.toLowerCase()) {
    case "trace":
      return LogLevel.Trace;
    case "debug":
      return LogLevel.Debug;
    case "info":
      return LogLevel.Info;
    case "warn":
    case "warning":
      return LogLevel.Warn;
    case "error":
      return LogLevel.Error;
    case "off":
      return LogLevel.Off;
    default:
      throw new Error(`Unsupported log level: ${raw}`);
  }
}

export class Logger {
  private level: LogLevel;

  constructor(private channel: vscode.LogOutputChannel) {
    this.level = this.resolveLevel();
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("copilot-debugger.consoleLogLevel")) {
        this.level = this.resolveLevel();
        this.debug(`Log level updated to ${LogLevel[this.level]}`);
      }
    });
  }

  private resolveLevel(): LogLevel {
    const cfg = vscode.workspace.getConfiguration("copilot-debugger");
    const raw = cfg.get<string>("consoleLogLevel");
    return parseLogLevel(raw);
  }

  private enabled(level: LogLevel): boolean {
    return level >= this.level && this.level !== LogLevel.Off;
  }

  trace(message: string, ...extra: unknown[]): void {
    this.channel.trace(message);
    if (this.enabled(LogLevel.Trace)) {
      console.trace(`[TRACE] ${message}`, ...extra);
    }
  }
  debug(message: string, ...extra: unknown[]): void {
    this.channel.debug(message);
    if (this.enabled(LogLevel.Debug)) {
      console.debug(`[DEBUG] ${message}`, ...extra);
    }
  }
  info(message: string, ...extra: unknown[]): void {
    this.channel.info(message);
    if (this.enabled(LogLevel.Info)) {
      console.info(`[INFO] ${message}`, ...extra);
    }
  }
  warn(message: string, ...extra: unknown[]): void {
    this.channel.warn(message);
    if (this.enabled(LogLevel.Warn)) {
      console.warn(message, ...extra);
    }
  }
  error(message: string, ...extra: unknown[]): void {
    this.channel.error(message);
    if (this.enabled(LogLevel.Error)) {
      console.error(message, ...extra);
    }
  }
}

export const logger = new Logger(logChannel);

export const logging = { logger, logChannel };
