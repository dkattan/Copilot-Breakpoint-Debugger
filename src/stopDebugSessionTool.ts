import type * as vscode from 'vscode';
import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  ProviderResult,
} from 'vscode';
import { LanguageModelTextPart, LanguageModelToolResult } from 'vscode';
import { stopDebugSession } from './session';

export interface StopDebugSessionToolParameters {
  sessionName: string; // Name of session to stop (supports multiple with same name)
}

export class StopDebugSessionTool
  implements LanguageModelTool<StopDebugSessionToolParameters>
{
  async invoke(
    options: LanguageModelToolInvocationOptions<StopDebugSessionToolParameters>
  ): Promise<LanguageModelToolResult> {
    const { sessionName } = options.input;
    try {
      const raw = await stopDebugSession({ sessionName });
      return new LanguageModelToolResult([
        new LanguageModelTextPart(JSON.stringify(raw)),
      ]);
    } catch (error) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          `Error stopping debug session: ${
            error instanceof Error ? error.message : String(error)
          }`
        ),
      ]);
    }
  }

  prepareInvocation?(
    options: LanguageModelToolInvocationPrepareOptions<StopDebugSessionToolParameters>
  ): ProviderResult<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Stopping debug session(s) named '${options.input.sessionName}'`,
    };
  }
}
