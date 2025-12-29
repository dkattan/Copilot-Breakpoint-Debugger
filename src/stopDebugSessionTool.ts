import type * as vscode from 'vscode';
import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  LanguageModelToolResult,
  ProviderResult,
} from 'vscode';
import { createTruncatedToolResult } from './outputTruncation';
import { stopDebugSession } from './session';

export interface StopDebugSessionToolParameters {
  sessionId: string; // ID of session to stop (aligns with resumeDebugSession)
}

export class StopDebugSessionTool
  implements LanguageModelTool<StopDebugSessionToolParameters>
{
  async invoke(
    options: LanguageModelToolInvocationOptions<StopDebugSessionToolParameters>
  ): Promise<LanguageModelToolResult> {
    const { sessionId } = options.input;
    try {
      await stopDebugSession({ sessionId });
      return createTruncatedToolResult(
        `Stopped debug session(s) with id '${sessionId}'.`
      );
    } catch (error) {
      return createTruncatedToolResult(
        `Error stopping debug session: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  prepareInvocation?(
    options: LanguageModelToolInvocationPrepareOptions<StopDebugSessionToolParameters>
  ): ProviderResult<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Stopping debug session(s) with id '${options.input.sessionId}'`,
    };
  }
}
