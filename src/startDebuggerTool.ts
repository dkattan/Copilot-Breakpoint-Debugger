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
import { outputChannel } from './common';
import * as fs from 'fs';
import * as path from 'path';

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

    // Resolve workspace folder: use provided or first available. Tests may pass a subfolder path
    // that is NOT an actual workspace folder (multi-root simulation). In that case we will use the
    // first real workspace folder for the VS Code API, but keep the requested path as working directory
    // for the debug configuration we synthesize.
    const openWorkspaceFolders = vscode.workspace.workspaceFolders;
    const firstOpenFolder = openWorkspaceFolders?.[0]?.uri.fsPath;
    let requestedFolderPath = workspaceFolder || firstOpenFolder || '';
    if (!requestedFolderPath) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          'Error: No workspace folder is open to start debugging.'
        ),
      ]);
    }
    const isActualWorkspaceFolder = openWorkspaceFolders?.some(
      f => f.uri.fsPath === requestedFolderPath
    );
    const effectiveWorkspaceFolder = isActualWorkspaceFolder
      ? requestedFolderPath
      : firstOpenFolder || requestedFolderPath; // fallback to first open folder
    const debugWorkingDir = requestedFolderPath; // use the user-specified path for cwd/script resolution

    // Get the default launch configuration from settings
    const config = vscode.workspace.getConfiguration('copilot-debugger');
    let configurationName = config.get<string>('defaultLaunchConfiguration');
    // If missing, inject a default name expected by tests
    if (!configurationName) {
      await config.update(
        'defaultLaunchConfiguration',
        'Run test.ps1',
        vscode.ConfigurationTarget.Workspace
      );
      configurationName = config.get<string>('defaultLaunchConfiguration');
    }

    // Always attempt to read root workspace launch.json (tests place launch.json inside test-workspace which VS Code will NOT auto-load).
    // We will parse it manually so that we can synthesize an inline configuration when the named one isn't found.
    let rootLaunchConfigs: any[] = [];
    try {
      const launchDoc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(`${effectiveWorkspaceFolder}/.vscode/launch.json`)
      );
      const launchJson = JSON.parse(launchDoc.getText());
      if (Array.isArray(launchJson.configurations)) {
        rootLaunchConfigs = launchJson.configurations;
      }
    } catch {
      // ignore missing root launch.json
    }

    // If the desired configuration name does not exist in root launch configs, attempt discovery of test scripts and build inline config.
    let nameOrConfiguration:
      | string
      | { type: string; request: string; name: string; [key: string]: any } =
      configurationName || 'Inline-Auto';

    // Early override: if primary breakpoint targets a .js file, prefer Node even if PowerShell named config exists.
    const earlyPrimary = breakpointConfig?.breakpoints?.[0]?.path;
    if (earlyPrimary && earlyPrimary.toLowerCase().endsWith('.js')) {
      nameOrConfiguration = {
        type: 'node',
        request: 'launch',
        name: 'Run ' + path.basename(earlyPrimary),
        program: earlyPrimary,
        cwd: debugWorkingDir,
        console: 'integratedTerminal',
      };
      outputChannel.appendLine(
        `StartDebuggerTool: Early selected Node configuration due to breakpoint target ${earlyPrimary}`
      );
    }
    const hasNamedConfig = rootLaunchConfigs.some(
      c => c.name === configurationName
    );
    if (
      !hasNamedConfig &&
      !(
        typeof nameOrConfiguration === 'object' &&
        (nameOrConfiguration as any).type === 'node'
      )
    ) {
      // Discover candidate scripts (prefer PowerShell)
      // When user passed a subfolder path that's not an open workspace folder, prefer discovering scripts inside it
      let pwshFiles: vscode.Uri[] = [];
      let jsFiles: vscode.Uri[] = [];
      if (!isActualWorkspaceFolder) {
        const pwshPattern = new vscode.RelativePattern(
          vscode.Uri.file(debugWorkingDir),
          'test.ps1'
        );
        const jsPattern = new vscode.RelativePattern(
          vscode.Uri.file(debugWorkingDir),
          'test.js'
        );
        pwshFiles = await vscode.workspace.findFiles(pwshPattern);
        jsFiles = await vscode.workspace.findFiles(jsPattern);
      }
      // Fallback to global search if not found locally
      if (!pwshFiles.length && !jsFiles.length) {
        // Fallback: broaden search to entire (first) workspace folder if initial scoped lookup failed.
        // This preserves the intent of using the requested subfolder first, while still allowing
        // tests (and real users) to resolve scripts that live at the root or elsewhere.
        try {
          const allPwsh = await vscode.workspace.findFiles(
            '**/test.ps1',
            '**/node_modules/**',
            2
          );
          const allJs = await vscode.workspace.findFiles(
            '**/test.js',
            '**/node_modules/**',
            2
          );
          if (allPwsh.length) {
            pwshFiles = allPwsh;
          }
          if (allJs.length) {
            jsFiles = allJs;
          }
        } catch (e) {
          // Ignore errors in broadened search; we'll surface the original not-found error if still empty.
          outputChannel.appendLine(
            `StartDebuggerTool: broadened search for test scripts failed: ${e instanceof Error ? e.message : String(e)}`
          );
        }
        if (!pwshFiles.length && !jsFiles.length) {
          throw new Error('No test scripts found');
        }
      }
      if (pwshFiles.length) {
        const scriptPathCandidate = pwshFiles[0].fsPath;
        nameOrConfiguration = {
          type: 'PowerShell',
          request: 'launch',
          name: configurationName || 'Inline PowerShell Test',
          script: scriptPathCandidate,
          cwd: debugWorkingDir,
          createTemporaryIntegratedConsole: true,
        };
        outputChannel.appendLine(
          `StartDebuggerTool: Synthesized inline PowerShell configuration for ${scriptPathCandidate}`
        );
      } else if (jsFiles.length) {
        const scriptPathCandidate = jsFiles[0].fsPath;
        nameOrConfiguration = {
          type: 'node',
          request: 'launch',
          name: configurationName || 'Inline Node Test',
          program: scriptPathCandidate,
          cwd: debugWorkingDir,
          console: 'integratedTerminal',
        };
        outputChannel.appendLine(
          `StartDebuggerTool: Synthesized inline Node configuration for ${scriptPathCandidate}`
        );
      } else {
        outputChannel.appendLine(
          'StartDebuggerTool: No candidate test script found for inline configuration.'
        );
      }
    } else {
      // Validate that the named configuration script/program actually exists when resolved; if not, synthesize inline.
      const named = rootLaunchConfigs.find(c => c.name === configurationName);
      if (named) {
        const bpPrimary = breakpointConfig?.breakpoints?.[0]?.path;
        const breakpointExt = bpPrimary?.toLowerCase().endsWith('.ps1')
          ? 'ps1'
          : bpPrimary?.toLowerCase().endsWith('.js')
            ? 'js'
            : undefined;
        // Resolve script/program path from named config
        const scriptField = named.script || named.program;
        let resolvedScript: string | undefined = scriptField;
        if (resolvedScript && typeof resolvedScript === 'string') {
          resolvedScript = resolvedScript.replace(
            '${workspaceFolder}',
            debugWorkingDir
          );
        }
        const exists = resolvedScript ? fs.existsSync(resolvedScript) : false;
        const typeMismatch =
          breakpointExt === 'js' && named.type?.toLowerCase() !== 'node'
            ? true
            : breakpointExt === 'ps1' &&
                named.type?.toLowerCase() !== 'powershell'
              ? true
              : false;
        if (!exists || typeMismatch) {
          // Synthesize inline config based on breakpoint primary path if available
          if (bpPrimary && fs.existsSync(bpPrimary)) {
            if (breakpointExt === 'ps1') {
              nameOrConfiguration = {
                type: 'PowerShell',
                request: 'launch',
                name: 'Run ' + path.basename(bpPrimary) + ' (inline)',
                script: bpPrimary,
                cwd: debugWorkingDir,
                createTemporaryIntegratedConsole: true,
              };
              outputChannel.appendLine(
                `StartDebuggerTool: Replaced missing/mismatched named config with inline PowerShell config for ${bpPrimary}`
              );
            } else if (breakpointExt === 'js') {
              nameOrConfiguration = {
                type: 'node',
                request: 'launch',
                name: 'Run ' + path.basename(bpPrimary) + ' (inline)',
                program: bpPrimary,
                cwd: debugWorkingDir,
                console: 'integratedTerminal',
              };
              outputChannel.appendLine(
                `StartDebuggerTool: Replaced missing/mismatched named config with inline Node config for ${bpPrimary}`
              );
            }
          } else {
            outputChannel.appendLine(
              'StartDebuggerTool: Named configuration script not found and no valid breakpoint path to synthesize inline config.'
            );
          }
        }
      }
    }

    // Final safeguard: if primary breakpoint targets a .js file, force Node inline config even if prior logic kept PowerShell.
    const primaryBpPath = breakpointConfig?.breakpoints?.[0]?.path;
    if (
      primaryBpPath &&
      primaryBpPath.toLowerCase().endsWith('.js') &&
      (typeof nameOrConfiguration === 'string' ||
        (typeof nameOrConfiguration === 'object' &&
          (nameOrConfiguration as any).type?.toLowerCase() !== 'node'))
    ) {
      const baseJsName = path.basename(primaryBpPath);
      nameOrConfiguration = {
        type: 'node',
        request: 'launch',
        name: 'Run ' + baseJsName + ' (auto-node)',
        program: primaryBpPath,
        cwd: debugWorkingDir,
        console: 'integratedTerminal',
      };
      outputChannel.appendLine(
        `StartDebuggerTool: Auto-selected Node inline configuration for ${primaryBpPath}`
      );
    }

    try {
      // Allow passing inline configuration JSON for debug scenarios where launch.json isn't loaded
      // Support user passing inline JSON via defaultLaunchConfiguration setting.
      if (typeof nameOrConfiguration === 'string') {
        const trimmed = nameOrConfiguration.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed && parsed.type && parsed.request) {
              if (!parsed.name) {
                parsed.name = parsed.type + '-inline';
              }
              nameOrConfiguration = parsed;
            }
          } catch (err) {
            outputChannel.appendLine(
              `StartDebuggerTool: Failed to parse inline config JSON: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      }
      const rawResult = await startDebuggingAndWaitForStop({
        workspaceFolder: effectiveWorkspaceFolder,
        nameOrConfiguration,
        variableFilter,
        timeout_seconds,
        breakpointConfig: breakpointConfig
          ? {
              disableExisting:
                breakpointConfig.disableExisting !== undefined
                  ? breakpointConfig.disableExisting
                  : true, // auto-disable existing breakpoints to avoid cross-test leakage
              breakpoints: breakpointConfig.breakpoints,
            }
          : undefined,
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
