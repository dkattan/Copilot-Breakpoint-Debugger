import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
} from 'vscode';
// Removed prompt-tsx rendering for concise text output
import * as vscode from 'vscode';
import { LanguageModelTextPart, LanguageModelToolResult } from 'vscode';
import { logger } from './logger';
// Legacy prompt component retained elsewhere; not used here.
import { startDebuggingAndWaitForStop } from './session';

// Parameters for starting a debug session. The tool starts a debugger using the
// configured default launch configuration and waits for the first breakpoint hit,
// returning call stack and (optionally) filtered variables.
// Individual breakpoint definition now includes a required variableFilter so
// each breakpoint can specify its own variable name patterns (regex fragments).
export interface BreakpointDefinition {
  path: string;
  line: number;
  variableFilter: string[]; // Required per-breakpoint variable names (exact matches, no regex)
  action?: 'break' | 'stopDebugging' | 'capture'; // 'capture' returns data then continues
  condition?: string; // Expression evaluated at breakpoint; stop only if true
  hitCount?: number; // Exact numeric hit count (3 means pause on 3rd hit)
  logMessage?: string; // Logpoint style message with {var} interpolation
}

export interface BreakpointConfiguration {
  breakpoints: BreakpointDefinition[];
}

export interface StartDebuggerToolParameters {
  workspaceFolder?: string;
  timeoutSeconds?: number;
  configurationName?: string;
  breakpointConfig: BreakpointConfiguration;
}

// Removed scope variable limiting; concise output filters directly.

export class StartDebuggerTool
  implements LanguageModelTool<StartDebuggerToolParameters>
{
  async invoke(
    options: LanguageModelToolInvocationOptions<StartDebuggerToolParameters>
  ): Promise<LanguageModelToolResult> {
    const {
      workspaceFolder,
      timeoutSeconds,
      configurationName,
      breakpointConfig,
    } = options.input;
    try {
      if (!breakpointConfig) {
        throw new TypeError('breakpointConfig is required.');
      }
      if (!breakpointConfig.breakpoints) {
        throw new TypeError('breakpointConfig.breakpoints is required.');
      }
      if (breakpointConfig.breakpoints.length === 0) {
        throw new TypeError(
          'Provide at least one breakpoint (path + line) before starting the debugger.'
        );
      }

      // Validate per-breakpoint filters (now exact variable names, no regex semantics)
      for (const bp of breakpointConfig.breakpoints) {
        if (bp.variableFilter === undefined) {
          throw new TypeError(
            `Breakpoint at ${bp.path}:${bp.line} missing required variableFilter entries.`
          );
        }
        if (bp.variableFilter.length === 0) {
          throw new TypeError(
            `Breakpoint at ${bp.path}:${bp.line} has empty variableFilter array.`
          );
        }
      }

      if (typeof workspaceFolder !== 'string') {
        throw new TypeError('workspaceFolder is required.');
      }
      if (workspaceFolder.trim().length === 0) {
        throw new TypeError('workspaceFolder must not be empty.');
      }
      const resolvedWorkspaceFolder = workspaceFolder.trim();

      // Get the configuration name from parameter or settings
      const config = vscode.workspace.getConfiguration('copilot-debugger');
      const configValue = config.get<string>('defaultLaunchConfiguration');
      if (!configurationName && !configValue) {
        throw new TypeError(
          'No launch configuration specified. Set "copilot-debugger.defaultLaunchConfiguration" or provide configurationName.'
        );
      }
      let effectiveConfigName: string;
      if (configurationName) {
        effectiveConfigName = configurationName;
      } else {
        effectiveConfigName = configValue as string;
      }

      // Note: We skip pre-validation of launch configuration existence because:
      // 1. In multi-root workspaces, getConfiguration() may not return all available configs
      // 2. VS Code's startDebugging() will provide a clear error if the config doesn't exist
      // 3. This avoids false negatives where configs exist but aren't detected via API

      const stopInfo = await startDebuggingAndWaitForStop({
        workspaceFolder: resolvedWorkspaceFolder,
        nameOrConfiguration: effectiveConfigName,
        timeoutSeconds,
        breakpointConfig,
        sessionName: '',
      });

      const summary = {
        session: stopInfo.thread?.name ?? effectiveConfigName,
        file: stopInfo.frame?.source?.path,
        line: stopInfo.frame?.line,
        reason: stopInfo.frame?.name,
      };

      // Select filter strictly from the hit breakpoint; if absent, treat as configuration error.
      if (!stopInfo.hitBreakpoint) {
        throw new TypeError(
          'Hit breakpoint not identifiable; cannot determine variable filters.'
        );
      }
      const activeFilters: string[] = stopInfo.hitBreakpoint.variableFilter;
      const action =
        (
          stopInfo.hitBreakpoint as {
            action?: 'break' | 'stopDebugging' | 'capture';
          }
        ).action ?? 'break';
      const capturedLogs = stopInfo.capturedLogMessages ?? [];
      // Exact-name filtering (case-sensitive) per requirement
      const filterSet = new Set(activeFilters);
      const flattened: Array<{
        name: string;
        value: string;
        scope: string;
        type?: string;
      }> = [];
      for (const scope of stopInfo.scopeVariables ?? []) {
        for (const variable of scope.variables) {
          if (filterSet.has(variable.name)) {
            flattened.push({
              name: variable.name,
              value: variable.value,
              scope: scope.scopeName,
              type: variable.type,
            });
          }
        }
      }
      const truncate = (val: string) => {
        const max = 120;
        return val.length > max ? `${val.slice(0, max)}…(${val.length})` : val;
      };
      const variableStr = flattened
        .map(v => {
          const typePart = v.type ? `:${v.type}` : '';
          return `${v.name}=${truncate(v.value)} (${v.scope}${typePart})`;
        })
        .join('; ');
      const fileName = summary.file
        ? summary.file.split(/[/\\]/).pop()
        : 'unknown';
      const header = `Breakpoint ${fileName}:${summary.line} action=${action}`;
      const bodyVars = flattened.length
        ? `Vars: ${variableStr}`
        : `Vars: <none> (filters: ${activeFilters.join(', ')})`;
      const bodyLogs = capturedLogs.length
        ? `Logs: ${capturedLogs.map(l => (l.length > 120 ? `${l.slice(0, 120)}…` : l)).join(' | ')}`
        : '';
      const textOutput = `${header}\n${bodyVars}${bodyLogs ? `\n${bodyLogs}` : ''}`;

      logger.info(`[StartDebuggerTool] textOutput ${textOutput}`);
      return new LanguageModelToolResult([
        new LanguageModelTextPart(textOutput),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new LanguageModelToolResult([
        new LanguageModelTextPart(`Error: ${message}`),
      ]);
    }
  }
}
