/* eslint-disable no-console */
import { computed, useLogger } from 'reactive-vscode';
import { config } from './config';

type ConsoleLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'off';
type LogLevel = Exclude<ConsoleLogLevel, 'off'>;

const levelOrder: Record<ConsoleLogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  off: 5,
};

const baseLogger = useLogger('Copilot Breakpoint Debugger', { toConsole: [] });
export const logChannel = baseLogger;

const consoleLevel = computed<ConsoleLogLevel>(
  () => config.consoleLogLevel || 'info'
);

const shouldMirror = (level: LogLevel): boolean => {
  const current = consoleLevel.value;
  if (current === 'off') {
    return false;
  }
  return levelOrder[level] >= levelOrder[current];
};

const emitConsole = (level: LogLevel, message: string, extra: unknown[]) => {
  if (!shouldMirror(level)) {
    return;
  }
  const prefix = `[${level.toUpperCase()}]`;
  switch (level) {
    case 'trace':
      console.trace(`${prefix} ${message}`, ...extra);
      break;
    case 'debug':
      console.debug(`${prefix} ${message}`, ...extra);
      break;
    case 'info':
      console.info(`${prefix} ${message}`, ...extra);
      break;
    case 'warn':
      console.warn(`${prefix} ${message}`, ...extra);
      break;
    case 'error':
      console.error(`${prefix} ${message}`, ...extra);
      break;
  }
};

const infoWriter = baseLogger.info;
const warnWriter = baseLogger.warn;
const errorWriter = baseLogger.error;

export const logger = {
  trace(message: string, ...extra: unknown[]): void {
    logChannel.info(message);
    emitConsole('trace', message, extra);
  },
  debug(message: string, ...extra: unknown[]): void {
    logChannel.info(message);
    emitConsole('debug', message, extra);
  },
  info(message: string, ...extra: unknown[]): void {
    infoWriter(message, ...extra);
    emitConsole('info', message, extra);
  },
  warn(message: string, ...extra: unknown[]): void {
    warnWriter(message, ...extra);
    emitConsole('warn', message, extra);
  },
  error(message: string, ...extra: unknown[]): void {
    errorWriter(message, ...extra);
    emitConsole('error', message, extra);
  },
};

export const logging = { logger, logChannel };
