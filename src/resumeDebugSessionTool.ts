import * as vscode from 'vscode';
import {
  LanguageModelTool,
  LanguageModelToolResult,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  ProviderResult,
  LanguageModelTextPart,
} from 'vscode';
import { resumeDebugSession } from './session';

export interface ResumeDebugSessionToolParameters {
  sessionId: string; // ID of the debug session to resume
  waitForStop?: boolean; // Wait for next breakpoint after resume
  breakpointConfig?: {
    disableExisting?: boolean;
    breakpoints?: Array<{ path: string; line: number }>;
  };
}

export class ResumeDebugSessionTool
  implements LanguageModelTool<ResumeDebugSessionToolParameters>
{
  async invoke(
    options: LanguageModelToolInvocationOptions<ResumeDebugSessionToolParameters>
  ): Promise<LanguageModelToolResult> {
    const { sessionId, waitForStop, breakpointConfig } = options.input;
    try {
      const rawResult = await resumeDebugSession({
        sessionId,
        waitForStop,
        breakpointConfig,
      });
      const parts: LanguageModelTextPart[] = rawResult.content.map(item => {
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
