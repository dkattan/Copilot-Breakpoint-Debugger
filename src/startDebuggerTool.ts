import * as vscode from 'vscode';
import {
  LanguageModelTool,
  LanguageModelToolResult,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  ProviderResult,
  LanguageModelTextPart,
} from 'vscode';
import { startDebuggingAndWaitForStop } from './session';

// Parameters for starting a debug session. The tool starts a debugger using the
// configured default launch configuration and waits for the first breakpoint hit,
// returning call stack and (optionally) filtered variables.
export interface StartDebuggerToolParameters {
  workspaceFolder?: string; // Optional explicit folder path; defaults to first workspace folder
  variableFilter?: string[]; // Optional variable name filters (regex fragments joined by |)
  timeout_seconds?: number; // Optional timeout for waiting for breakpoint (defaults handled downstream)
  breakpointConfig?: {
    disableExisting?: boolean;
    breakpoints?: Array<{
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
      timeout_seconds,
      breakpointConfig,
    } = options.input;

    // Resolve workspace folder: use provided or first available
    const folderPath =
      workspaceFolder ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      '';
    if (!folderPath) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          'Error: No workspace folder is open to start debugging.'
        ),
      ]);
    }

    // Get the default launch configuration from settings
    const config = vscode.workspace.getConfiguration('copilot-debugger');
    const configurationName = config.get<string>('defaultLaunchConfiguration');

    if (!configurationName) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          'Error: No default launch configuration is set. Please configure "copilot-debugger.defaultLaunchConfiguration" in your settings.'
        ),
      ]);
    }

    try {
      // Allow passing inline configuration JSON for debug scenarios where launch.json isn't loaded
      let nameOrConfiguration:
        | string
        | { type: string; request: string; name: string; [key: string]: any } =
        configurationName;
      const trimmed = configurationName.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (
            parsed &&
            typeof parsed === 'object' &&
            parsed.type &&
            parsed.request
          ) {
            if (!parsed.name) {
              parsed.name = parsed.type + '-inline';
            }
            nameOrConfiguration = parsed as any;
          }
        } catch (err) {
          // Non-fatal: fall back to treating configurationName as a launch config name
          vscode.debug.activeDebugConsole?.appendLine?.(
            `StartDebuggerTool: Failed to parse inline config JSON: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      const rawResult = await startDebuggingAndWaitForStop({
        workspaceFolder: folderPath,
        nameOrConfiguration,
        variableFilter,
        timeout_seconds,
        breakpointConfig,
      });

      // Convert rawResult into LanguageModelToolResult parts
      const parts: LanguageModelTextPart[] = rawResult.content.map(item => {
        if (item.type === 'json' && 'json' in item) {
          return new LanguageModelTextPart(JSON.stringify(item.json));
        }
        // Fall back to text if present
        const textValue = 'text' in item ? item.text : JSON.stringify(item);
        return new LanguageModelTextPart(textValue);
      });
      return new LanguageModelToolResult(parts);
    } catch (error) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          `Error starting debug session: ${
            error instanceof Error ? error.message : String(error)
          }`
        ),
      ]);
    }
  }

  prepareInvocation?(
    _options: LanguageModelToolInvocationPrepareOptions<StartDebuggerToolParameters>
  ): ProviderResult<vscode.PreparedToolInvocation> {
    const config = vscode.workspace.getConfiguration('copilot-debugger');
    const configurationName =
      config.get<string>('defaultLaunchConfiguration') || 'default';
    return {
      invocationMessage: `Starting debugger with configuration "${configurationName}"`,
    };
  }
}
