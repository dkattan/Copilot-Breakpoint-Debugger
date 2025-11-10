import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
} from 'vscode';
import * as vscode from 'vscode';
import { LanguageModelTextPart, LanguageModelToolResult } from 'vscode';
import { startDebuggingAndWaitForStop } from './session';

// Parameters for starting a debug session. The tool starts a debugger using the
// configured default launch configuration and waits for the first breakpoint hit,
// returning call stack and (optionally) filtered variables.
export interface StartDebuggerToolParameters {
  workspaceFolder?: string; // Optional explicit folder path; defaults to first workspace folder
  variableFilter?: string[]; // Optional variable name filters (regex fragments joined by |)
  timeoutSeconds?: number; // Optional timeout for waiting for breakpoint (defaults handled downstream)
  breakpointConfig: {
    disableExisting?: boolean;
    breakpoints: Array<{
      path: string;
      line: number;
      condition?: string; // Optional conditional expression (e.g., "x > 5")
      hitCondition?: string; // Optional hit count condition (e.g., ">10", "==5", "%3")
      logMessage?: string; // Optional log message (logpoint)
    }>;
  };
}

export class StartDebuggerTool
  implements LanguageModelTool<StartDebuggerToolParameters>
{
  async invoke(
    options: LanguageModelToolInvocationOptions<StartDebuggerToolParameters>
  ): Promise<LanguageModelToolResult> {
    const {
      workspaceFolder,
      variableFilter,
      timeoutSeconds,
      breakpointConfig,
    } = options.input;

    // Get the default launch configuration from settings
    const config = vscode.workspace.getConfiguration('copilot-debugger');
    const configurationName = config.get<string>('defaultLaunchConfiguration');

    const rawResult = await startDebuggingAndWaitForStop({
      workspaceFolder: workspaceFolder!,
      nameOrConfiguration: configurationName!,
      variableFilter,
      timeoutSeconds,
      breakpointConfig,
      sessionName: '',
    });

    // Convert rawResult into LanguageModelToolResult parts
    const parts: LanguageModelTextPart[] = rawResult.content.map(item => {
      if (item.type === 'json' && 'json' in item) {
        return new LanguageModelTextPart(JSON.stringify(item.json));
      }
      const textValue = 'text' in item ? item.text : JSON.stringify(item);
      return new LanguageModelTextPart(textValue);
    });
    return new LanguageModelToolResult(parts);
  }
}
