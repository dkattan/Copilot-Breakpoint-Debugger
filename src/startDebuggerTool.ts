import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
} from 'vscode';
import type { BreakpointDefinition } from './BreakpointDefinition';
import { EntryStopTimeoutError } from './events';
import { logger } from './logger';
import { createTruncatedToolResult } from './outputTruncation';
import { startDebuggingAndWaitForStop } from './session';
import { renderStopInfoMarkdown } from './stopInfoMarkdown';

export interface BreakpointConfiguration {
  breakpoints: BreakpointDefinition[];
}

type ServerReadyAction =
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
      type: 'httpRequest';
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    }
  | { type: 'shellCommand'; shellCommand: string }
  | { type: 'vscodeCommand'; command: string; args?: unknown[] };

export interface StartDebuggerToolParameters {
  workspaceFolder: string;
  configurationName?: string;
  /**
   * Tool mode:
   * - 'singleShot' (default): terminate the debug session before returning.
   * - 'inspect': allow returning while paused so the caller can inspect state and resume.
   */
  mode?: 'singleShot' | 'inspect';
  /**
   * Required when mode is 'inspect'. Explanation of why interactive inspection is needed instead of singleShot.
   */
  inspectJustification?: string;
  breakpointConfig: BreakpointConfiguration;
  /**
   * Optional serverReady configuration.
   * trigger: defines when to run the action (breakpoint path+line OR pattern). If omitted and request === 'attach' the action runs immediately after attach (default immediate attach mode).
   * action: exactly one of shellCommand | httpRequest | vscodeCommand.
   */
  serverReady?: {
    trigger?: {
      path?: string;
      line?: number;
      pattern?: string;
    };
    action: ServerReadyAction;
  };
}

// Removed scope variable limiting; concise output filters directly.

export class StartDebuggerTool
  implements LanguageModelTool<StartDebuggerToolParameters>
{
  async invoke(
    options: LanguageModelToolInvocationOptions<StartDebuggerToolParameters>
  ): Promise<LanguageModelToolResult> {
    let success = true;
    const {
      workspaceFolder,
      configurationName,
      mode,
      inspectJustification,
      breakpointConfig,
      serverReady,
    } = options.input;

    if (mode === 'inspect') {
      if (
        !inspectJustification ||
        typeof inspectJustification !== 'string' ||
        inspectJustification.trim().length === 0
      ) {
        return createTruncatedToolResult(
          "Error: 'inspectJustification' is required when mode is 'inspect'. Please explain why interactive inspection is needed (e.g., 'Need to evaluate expression X which depends on variable Y')."
        );
      }
    }

    try {
      // Direct invocation with new serverReady structure
      const stopInfo = await startDebuggingAndWaitForStop({
        workspaceFolder,
        nameOrConfiguration: configurationName,
        mode,
        breakpointConfig,
        sessionName: '',
        serverReady,
      });

      const textOutput = renderStopInfoMarkdown({
        stopInfo,
        breakpointConfig,
        success,
      });

      logger.info(`[StartDebuggerTool] textOutput ${textOutput}`);
      return createTruncatedToolResult(textOutput);
    } catch (err) {
      success = false;
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout =
        err instanceof EntryStopTimeoutError || /timed out/i.test(message);
      const failureLine = isTimeout ? 'Failure: timeout' : 'Failure: error';
      const errorOutput = `Success: ${success}\n${failureLine}\nError: ${message}`;
      return createTruncatedToolResult(errorOutput);
    }
  }
}
