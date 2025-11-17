import type * as vscode from 'vscode';
import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  ProviderResult,
} from 'vscode';
import { LanguageModelTextPart, LanguageModelToolResult } from 'vscode';
import { resumeDebugSession } from './session';

export interface ResumeDebugSessionToolParameters {
  sessionId: string; // ID of the debug session to resume
  waitForStop?: boolean; // Wait for next breakpoint after resume
  breakpointConfig?: {
    breakpoints?: Array<{ path: string; line: number }>;
  };
}

export class ResumeDebugSessionTool
  implements LanguageModelTool<ResumeDebugSessionToolParameters>
{
  async invoke(
    options: LanguageModelToolInvocationOptions<ResumeDebugSessionToolParameters>
  ): Promise<LanguageModelToolResult> {
    const { sessionId, breakpointConfig } = options.input;
    try {
      const stopInfo = await resumeDebugSession({
        sessionId,
        breakpointConfig,
      });
      return new LanguageModelToolResult([
        new LanguageModelTextPart(JSON.stringify(stopInfo, null, 2)),
      ]);
    } catch (error) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          `Error resuming debug session: ${
            error instanceof Error ? error.message : String(error)
          }`
        ),
      ]);
    }
  }

  prepareInvocation?(
    options: LanguageModelToolInvocationPrepareOptions<ResumeDebugSessionToolParameters>
  ): ProviderResult<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Resuming debug session '${options.input.sessionId}'${options.input.waitForStop ? ' and waiting for breakpoint' : ''}`,
    };
  }
}
