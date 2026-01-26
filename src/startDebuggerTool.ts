import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
} from "vscode";

import type { StartDebuggerToolParameters } from "./startDebuggerToolTypes";

import { EntryStopTimeoutError } from "./events";
import { logger } from "./logger";
import { createTruncatedToolResult } from "./outputTruncation";
import { startDebuggingAndWaitForStop } from "./session";
import { renderStopInfoMarkdown } from "./stopInfoMarkdown";

export type { StartDebuggerToolParameters } from "./startDebuggerToolTypes";

// Removed scope variable limiting; concise output filters directly.

export class StartDebuggerTool implements LanguageModelTool<StartDebuggerToolParameters> {
  async invoke(
    options: LanguageModelToolInvocationOptions<StartDebuggerToolParameters>,
  ): Promise<LanguageModelToolResult> {
    let success = true;
    const {
      workspaceFolder,
      configurationName,
      mode,
      watcherTaskLabel,
      breakpointConfig,
      serverReady,
    } = options.input;

    try {
      // Direct invocation with new serverReady structure
      const stopInfo = await startDebuggingAndWaitForStop({
        workspaceFolder,
        nameOrConfiguration: configurationName,
        mode,
        watcherTaskLabel,
        breakpointConfig,
        sessionName: "",
        serverReady,
      });

      const textOutput = renderStopInfoMarkdown({
        stopInfo,
        breakpointConfig,
        success,
      });

      logger.info(`[StartDebuggerTool] textOutput ${textOutput}`);
      return createTruncatedToolResult(textOutput);
    }
    catch (err) {
      success = false;
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout
        = err instanceof EntryStopTimeoutError || /timed out/i.test(message);
      const failureLine = isTimeout ? "Failure: timeout" : "Failure: error";
      const errorOutput = `Success: ${success}\n${failureLine}\nError: ${message}`;
      return createTruncatedToolResult(errorOutput);
    }
  }
}
