import * as vscode from 'vscode';
import {
  LanguageModelTool,
  LanguageModelToolResult,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  ProviderResult,
  LanguageModelTextPart,
} from 'vscode';
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
      const parts: LanguageModelTextPart[] = raw.content.map(item => {
        if (item.type === 'json' && 'json' in item) {
          return new LanguageModelTextPart(JSON.stringify(item.json));
        }
        const textValue = 'text' in item ? item.text : JSON.stringify(item);
        return new LanguageModelTextPart(textValue);
      });
      return new LanguageModelToolResult(parts);
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
