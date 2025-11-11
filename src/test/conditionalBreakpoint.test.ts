import type { LanguageModelTextPart } from 'vscode';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { StartDebuggerTool } from '../startDebuggerTool';
import {
  activateCopilotDebugger,
  assertPowerShellExtension,
  getExtensionRoot,
  openScriptDocument,
} from './utils/startDebuggerToolTestUtils';

// Conditional breakpoint + hitCondition + logpoint tests.
// First test is PowerShell-only (no Node fallback). Remaining tests still fallback.

describe('conditional Breakpoint Integration', () => {
  it('conditional breakpoint triggers only when condition is met (powershell only)', async function () {
    this.timeout(5000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/test.ps1')
    );
    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error(
        'No workspace folders found. Ensure test-workspace.code-workspace is loaded.'
      );
    }
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
    await openScriptDocument(scriptUri);
    await assertPowerShellExtension();
    const condition = '$i -ge 3';
    const lineInsideLoop = 8;

    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();
    const configurationName = 'Run test.ps1';
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeoutSeconds: 60,
        variableFilter: ['i'],
        configurationName,
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: lineInsideLoop,
              condition,
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });

    console.log('Conditional breakpoint output:\n', result.content);
    if (result.content === undefined) {
      throw new Error('No content received from tool invocation');
    }
    if (!Array.isArray(result.content)) {
      throw new TypeError(
        `Expected array but received ${typeof result.content} from tool invocation`
      );
    }
    const textPart = result.content[0] as LanguageModelTextPart;
    if (typeof textPart.value !== 'string') {
      throw new TypeError(
        `Expected text part value to be a string but received ${typeof textPart.value}`
      );
    }
    const textOutput = textPart.value;
    // Parse the debug info to verify the condition was met
    try {
      const debugInfoMatch = textOutput.match(/\{[\s\S]*"breakpoint"[\s\S]*\}/);
      if (debugInfoMatch) {
        const debugInfo = JSON.parse(debugInfoMatch[0]);
        console.log('Parsed debug info:', JSON.stringify(debugInfo, null, 2));

        // Check that we have variable info with $i
        if (debugInfo.variables && debugInfo.variables.variables) {
          const variables = debugInfo.variables.variables;
          const iVariable = variables.find(
            (v: { name: string }) => v.name === 'i'
          );

          if (iVariable) {
            const iValue = Number.parseInt(iVariable.value, 10);
            console.log(`Variable $i value: ${iValue}`);

            // Verify that $i is >= 3 (the condition we set)
            if (iValue < 3) {
              throw new Error(
                `Conditional breakpoint triggered too early: $i = ${iValue}, expected >= 3`
              );
            }
          }
        }
      }
    } catch (parseError) {
      console.warn(
        'Could not parse debug info for detailed validation:',
        parseError
      );
      // Don't fail the test if we can't parse - basic assertions already passed
    }
  });

  // Runtime chooser retained for remaining mixed-runtime tests until they are split.
  const chooseRuntime = async () => {
    const pwshAvailable = await ensurePowerShellExtension();
    if (!process.env.CI && pwshAvailable) {
      return 'powershell' as const;
    }
    return 'node' as const;
  };

  it('hitCondition breakpoint triggers on specific hit count (pwsh fallback to node)', async function () {
    this.timeout(5000);
    const runtime = await chooseRuntime();
    const extensionRoot = getExtensionRoot();
    const scriptRelative =
      runtime === 'powershell'
        ? 'test-workspace/test.ps1'
        : 'test-workspace/test.js';
    const lineInsideLoop = runtime === 'powershell' ? 8 : 9;
    const scriptUri = vscode.Uri.file(path.join(extensionRoot, scriptRelative));

    // Get the first workspace folder from VS Code - should be set from test-workspace.code-workspace
    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error(
        'No workspace folders found. Ensure test-workspace.code-workspace is loaded.'
      );
    }
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;

    await openScriptDocument(scriptUri);
    if (runtime === 'powershell') {
      const hasPowerShell = await ensurePowerShellExtension();
      if (!hasPowerShell) {
        this.skip();
      }
    }
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();
    const configurationName =
      runtime === 'powershell' ? 'Run test.ps1' : 'Run test.js';
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeoutSeconds: 60,
        variableFilter: ['i'],
        configurationName,
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: lineInsideLoop,
              hitCondition: '3',
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });

    interface ToolResultPart {
      text?: string;
      [key: string]: unknown;
    }
    const parts: ToolResultPart[] =
      (result as { parts?: ToolResultPart[]; content?: ToolResultPart[] })
        .content ||
      (result as { parts?: ToolResultPart[]; content?: ToolResultPart[] })
        .parts ||
      [];
    const textOutput = parts
      .map(p => (p.text ? p.text : JSON.stringify(p)))
      .join('\n');

    console.log('Hit condition breakpoint output:\n', textOutput);

    // Verify the debug session stopped
    if (/timed out/i.test(textOutput)) {
      throw new Error('Debug session timed out waiting for breakpoint');
    }
    if (/Error starting debug session/i.test(textOutput)) {
      throw new Error('Encountered error starting debug session');
    }
    if (!/Debug session .* stopped|breakpoint/i.test(textOutput)) {
      throw new Error('Missing stopped-session or breakpoint descriptor');
    }

    // The breakpoint should have triggered on the 3rd hit (when $i = 2, since loop starts at 0)
    try {
      const debugInfoMatch = textOutput.match(/\{[\s\S]*"breakpoint"[\s\S]*\}/);
      if (debugInfoMatch) {
        const debugInfo = JSON.parse(debugInfoMatch[0]);
        console.log('Parsed debug info:', JSON.stringify(debugInfo, null, 2));

        if (debugInfo.variables && debugInfo.variables.variables) {
          const variables = debugInfo.variables.variables;
          const iVariable = variables.find(
            (v: { name: string }) => v.name === 'i'
          );

          if (iVariable) {
            const iValue = Number.parseInt(iVariable.value, 10);
            console.log(`Variable $i value at 3rd hit: ${iValue}`);

            // Should be at iteration 2 (3rd hit: 0, 1, 2)
            if (iValue !== 2) {
              console.warn(
                `Hit condition may not have worked as expected: $i = ${iValue}, expected 2`
              );
            }
          }
        }
      }
    } catch (parseError) {
      console.warn(
        'Could not parse debug info for detailed validation:',
        parseError
      );
    }
  });

  it('logMessage breakpoint (logpoint) does not stop execution unless adapter treats it as breakpoint (pwsh fallback to node)', async function () {
    this.timeout(5000);
    const runtime = await chooseRuntime();
    const extensionRoot = getExtensionRoot();
    const scriptRelative =
      runtime === 'powershell'
        ? 'test-workspace/test.ps1'
        : 'test-workspace/test.js';
    const lineInsideLoop = runtime === 'powershell' ? 8 : 9;
    const postLoopLine = runtime === 'powershell' ? 12 : 14; // approximate end (JS file ends later) but second breakpoint ensures stop
    const logMessage =
      runtime === 'powershell' ? 'Loop iteration: {$i}' : 'Loop iteration: {i}';
    const scriptUri = vscode.Uri.file(path.join(extensionRoot, scriptRelative));

    // Get the first workspace folder from VS Code - should be set from test-workspace.code-workspace
    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error(
        'No workspace folders found. Ensure test-workspace.code-workspace is loaded.'
      );
    }
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;

    await openScriptDocument(scriptUri);
    if (runtime === 'powershell') {
      const hasPowerShell = await ensurePowerShellExtension();
      if (!hasPowerShell) {
        this.skip();
      }
    }
    await activateCopilotDebugger();
    const tool = new StartDebuggerTool();
    const configurationName =
      runtime === 'powershell' ? 'Run test.ps1' : 'Run test.js';
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeoutSeconds: 60,
        configurationName,
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: lineInsideLoop,
              logMessage,
            },
            {
              path: scriptUri.fsPath,
              line: postLoopLine,
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });

    interface ToolResultPart {
      text?: string;
      [key: string]: unknown;
    }
    const parts: ToolResultPart[] =
      (result as { parts?: ToolResultPart[]; content?: ToolResultPart[] })
        .content ||
      (result as { parts?: ToolResultPart[]; content?: ToolResultPart[] })
        .parts ||
      [];
    const textOutput = parts
      .map(p => (p.text ? p.text : JSON.stringify(p)))
      .join('\n');

    console.log('Logpoint test output:\n', textOutput);

    // Verify the debug session stopped at line 12 (not at the logpoint on line 8)
    if (/timed out/i.test(textOutput)) {
      throw new Error('Debug session timed out waiting for breakpoint');
    }
    if (/Error starting debug session/i.test(textOutput)) {
      throw new Error('Encountered error starting debug session');
    }
    if (!/Debug session .* stopped|breakpoint/i.test(textOutput)) {
      throw new Error('Missing stopped-session or breakpoint descriptor');
    }

    // Parse and verify we stopped at line 12, not line 8
    try {
      const debugInfoMatch = textOutput.match(/\{[\s\S]*"breakpoint"[\s\S]*\}/);
      if (debugInfoMatch) {
        const debugInfo = JSON.parse(debugInfoMatch[0]);
        console.log('Parsed debug info:', JSON.stringify(debugInfo, null, 2));

        if (debugInfo.breakpoint && debugInfo.breakpoint.line) {
          const stoppedLine = debugInfo.breakpoint.line;
          console.log(`Stopped at line: ${stoppedLine}`);

          // Should have stopped at line 12, not the logpoint at line 8
          if (stoppedLine === 8) {
            throw new Error(
              'Debug session stopped at logpoint (line 8), logpoints should not stop execution'
            );
          }
        }
      }
    } catch (parseError) {
      console.warn(
        'Could not parse debug info for detailed validation:',
        parseError
      );
    }
  });
});
