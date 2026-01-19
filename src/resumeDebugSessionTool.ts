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
import { resumeDebugSession } from "./session";
import { renderStopInfoMarkdown } from "./stopInfoMarkdown";

export interface ResumeDebugSessionToolParameters {
  sessionId: string // ID of the debug session to resume
  waitForStop?: boolean // Wait for next breakpoint after resume
  breakpointConfig?: {
    breakpoints?: Array<BreakpointDefinition>
  }
}

export class ResumeDebugSessionTool implements LanguageModelTool<ResumeDebugSessionToolParameters> {
  async invoke(
    options: LanguageModelToolInvocationOptions<ResumeDebugSessionToolParameters>,
  ): Promise<LanguageModelToolResult> {
    const { sessionId, breakpointConfig } = options.input;
    try {
      const stopInfo = await resumeDebugSession({
        sessionId,
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
        `Error resuming debug session: ${
          error instanceof Error ? error.message : String(error)
        }\n\nIf you want variables in the same table format as startDebugSessionWithBreakpoints, include breakpointConfig.breakpoints with an entry that targets the paused file via path + code snippet, and provide variableFilter (empty array means auto-capture).`,
      );
    }
  }

  prepareInvocation?(
    options: LanguageModelToolInvocationPrepareOptions<ResumeDebugSessionToolParameters>,
  ): ProviderResult<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Resuming debug session '${options.input.sessionId}'${
        options.input.waitForStop ? " and waiting for breakpoint" : ""
      }`,
    };
  }
}
