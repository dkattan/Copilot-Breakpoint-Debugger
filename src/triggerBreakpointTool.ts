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
  sessionId: string
  timeoutSeconds?: number
  mode?: "singleShot" | "inspect"
  breakpointConfig?: {
    breakpoints?: Array<BreakpointDefinition>
  }
  action:
    | {
      type: "httpRequest"
      url: string
      method?: string
      headers?: Record<string, string>
      body?: string
    }
    | { type: "shellCommand", shellCommand: string }
    | { type: "vscodeCommand", command: string, args?: unknown[] }
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
}

export class TriggerBreakpointTool
implements LanguageModelTool<TriggerBreakpointToolParameters> {
  async invoke(
    options: LanguageModelToolInvocationOptions<TriggerBreakpointToolParameters>,
  ): Promise<LanguageModelToolResult> {
    const { sessionId, timeoutSeconds, mode, breakpointConfig, action }
      = options.input;

    try {
      const stopInfo = await triggerBreakpointAndWaitForStop({
        sessionId,
        timeoutSeconds,
        mode,
        breakpointConfig,
        action,
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
    return {
      invocationMessage: `Triggering action and waiting for stop in session '${options.input.sessionId}'`,
    };
  }
}
