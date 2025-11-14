import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
} from 'vscode';
import { renderElementJSON } from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import {
  LanguageModelPromptTsxPart,
  LanguageModelTextPart,
  LanguageModelToolResult,
} from 'vscode';
import { StartDebuggerPrompt } from './prompts/startDebuggerPrompt';
import { startDebuggingAndWaitForStop } from './session';

// Parameters for starting a debug session. The tool starts a debugger using the
// configured default launch configuration and waits for the first breakpoint hit,
// returning call stack and (optionally) filtered variables.
export interface StartDebuggerToolParameters {
  workspaceFolder?: string; // Optional explicit folder path; defaults to first workspace folder
  variableFilter: string[]; // Required variable name filters (regex fragments joined by |)
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

const MAX_VARIABLES_PER_SCOPE = 50;

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

    if (!variableFilter || variableFilter.length === 0) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          'Error: Provide at least one variableFilter entry (regex fragment) to limit the returned variables.'
        ),
      ]);
    }

    if (!breakpointConfig?.breakpoints?.length) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          'Error: Provide at least one breakpoint (path + line) before starting the debugger.'
        ),
      ]);
    }

    const resolvedWorkspaceFolder =
      workspaceFolder?.trim() ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!resolvedWorkspaceFolder) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          'Error: No workspace folder available. Open a folder in VS Code or pass workspaceFolder explicitly.'
        ),
      ]);
    }

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

    const stopInfo = await startDebuggingAndWaitForStop({
      workspaceFolder: resolvedWorkspaceFolder,
      nameOrConfiguration: effectiveConfigName,
      variableFilter,
      timeoutSeconds,
      breakpointConfig,
      sessionName: '', // Empty string means match any session
    });

    const summary = {
      session: stopInfo.thread?.name ?? effectiveConfigName,
      file: stopInfo.frame?.source?.path,
      line: stopInfo.frame?.line,
      reason: stopInfo.frame?.name,
    };

    const promptJson = await renderElementJSON(
      StartDebuggerPrompt,
      {
        summary,
        thread: stopInfo.thread
          ? { id: stopInfo.thread.id, name: stopInfo.thread.name }
          : undefined,
        frame: stopInfo.frame
          ? {
              id: stopInfo.frame.id,
              name: stopInfo.frame.name,
              source: stopInfo.frame.source,
              line: stopInfo.frame.line,
              column: stopInfo.frame.column,
            }
          : undefined,
        scopes: (stopInfo.scopeVariables ?? []).map(scope => ({
          scopeName: scope.scopeName,
          variables: scope.variables
            .slice(0, MAX_VARIABLES_PER_SCOPE)
            .map(variable => ({
              name: variable.name,
              value: variable.value,
            })),
        })),
      },
      options.tokenizationOptions
    );

    const fallback = `Breakpoint hit in ${summary.file ?? 'unknown file'}:${summary.line ?? '?'}`;

    return new LanguageModelToolResult([
      new LanguageModelPromptTsxPart(promptJson),
      new LanguageModelTextPart(fallback),
    ]);
  }
}
