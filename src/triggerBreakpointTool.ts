import type * as vscode from "vscode";
import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  LanguageModelToolResult,
  ProviderResult,
} from "vscode";
import type { BreakpointDefinition } from "./BreakpointDefinition";
import { createTruncatedToolResult } from "./outputTruncation";
import { triggerBreakpointAndWaitForStop } from "./session";
import { renderStopInfoMarkdown } from "./stopInfoMarkdown";

export interface TriggerBreakpointToolParameters {
  sessionId?: string
  workspaceFolder?: string
  configurationName?: string
  watcherTaskLabel?: string
  existingSessionBehavior?: "useExisting" | "stopExisting" | "ignoreAndCreateNew"
  serverReadyTrigger?: {
    path?: string
    code?: string
    pattern?: string
  }
  startupBreakpointConfig?: {
    breakpoints: Array<BreakpointDefinition>
  }
  timeoutSeconds?: number
  mode?: "singleShot" | "inspect"
  breakpointConfig: {
    breakpoints?: Array<BreakpointDefinition>
    /**
     * Optional trigger action to execute after resuming.
     * Required for triggerBreakpoint.
     */
    breakpointTrigger:
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
}

export class TriggerBreakpointTool
implements LanguageModelTool<TriggerBreakpointToolParameters> {
  async invoke(
    options: LanguageModelToolInvocationOptions<TriggerBreakpointToolParameters>,
  ): Promise<LanguageModelToolResult> {
    const {
      sessionId,
      workspaceFolder,
      configurationName,
      watcherTaskLabel,
      existingSessionBehavior,
      serverReadyTrigger,
      startupBreakpointConfig,
      timeoutSeconds,
      mode,
      breakpointConfig,
    }
      = options.input;

    try {
      const stopInfo = await triggerBreakpointAndWaitForStop({
        sessionId,
        workspaceFolder,
        configurationName,
        watcherTaskLabel,
        existingSessionBehavior,
        serverReadyTrigger,
        startupBreakpointConfig,
        timeoutSeconds,
        mode,
        breakpointConfig,
      });

      return createTruncatedToolResult(
        renderStopInfoMarkdown({
          stopInfo,
          breakpointConfig: {
            breakpoints: breakpointConfig?.breakpoints ?? [],
          },
          success: true,
        }),
      );
    }
    catch (error) {
      return createTruncatedToolResult(
        `Error triggering breakpoint: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  prepareInvocation?(options: LanguageModelToolInvocationPrepareOptions<TriggerBreakpointToolParameters>): ProviderResult<vscode.PreparedToolInvocation> {
    const sessionLabel = options.input.sessionId
      ? `session '${options.input.sessionId}'`
      : "a new or existing session";
    return {
      invocationMessage: `Triggering action and waiting for stop in ${sessionLabel}`,
    };
  }
}
