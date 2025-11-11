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
  configurationName?: string; // Optional launch configuration name (overrides setting)
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
      configurationName,
      breakpointConfig,
    } = options.input;

    // Get the configuration name from parameter or settings
    const config = vscode.workspace.getConfiguration('copilot-debugger');
    const effectiveConfigName =
      configurationName || config.get<string>('defaultLaunchConfiguration');

    if (!effectiveConfigName) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          'Error: No launch configuration specified. Set "copilot-debugger.defaultLaunchConfiguration" in settings or provide configurationName parameter.'
        ),
      ]);
    }

    // Note: We skip pre-validation of launch configuration existence because:
    // 1. In multi-root workspaces, getConfiguration() may not return all available configs
    // 2. VS Code's startDebugging() will provide a clear error if the config doesn't exist
    // 3. This avoids false negatives where configs exist but aren't detected via API

    const rawResult = await startDebuggingAndWaitForStop({
      workspaceFolder: workspaceFolder!,
      nameOrConfiguration: effectiveConfigName,
      variableFilter,
      timeoutSeconds,
      breakpointConfig,
      sessionName: '', // Empty string means match any session
    });

    // Convert rawResult into LanguageModelToolResult parts
    // For LLM consumption, we stringify JSON, but tests can access the structured rawResult
    const parts: LanguageModelTextPart[] = rawResult.content.map(item => {
      if (item.type === 'json' && 'json' in item) {
        return new LanguageModelTextPart(JSON.stringify(item.json, null, 2));
      }
      const textValue =
        'text' in item && item.text ? item.text : JSON.stringify(item);
      return new LanguageModelTextPart(textValue);
    });

    // Attach the raw structured result for test validation
    const result = new LanguageModelToolResult(parts);
    // eslint-disable-next-line ts/no-explicit-any
    (result as any).__rawResult = rawResult;
    return result;
  }
}
