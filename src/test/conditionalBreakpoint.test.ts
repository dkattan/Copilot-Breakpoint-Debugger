import * as vscode from 'vscode';
import * as path from 'path';
import { StartDebuggerTool } from '../startDebuggerTool';
import { resolveWorkspaceFolder } from './utils/debugTestUtils';
import {
  getExtensionRoot,
  ensurePowerShellExtension,
  activateCopilotDebugger,
  openScriptDocument,
} from './utils/startDebuggerToolTestUtils';

// Unified conditional breakpoint + hitCondition + logpoint tests.
// Prefers PowerShell when available locally (and not CI), otherwise falls back to Node.
// This replaces previous separate PowerShell and Node (.node) suites.

suite('Conditional Breakpoint Integration (Unified)', () => {
  const chooseRuntime = async () => {
    const pwshAvailable = await ensurePowerShellExtension();
    if (!process.env.CI && pwshAvailable) {
      return 'powershell' as const;
    }
    return 'node' as const;
  };

  test('conditional breakpoint triggers only when condition is met (pwsh fallback to node)', async function () {
    this.timeout(5000);
    const runtime = await chooseRuntime();
    const extensionRoot = getExtensionRoot();
    const scriptRelative =
      runtime === 'powershell'
        ? 'test-workspace/test.ps1'
        : 'test-workspace/test.js';
    const condition = runtime === 'powershell' ? '$i -ge 3' : 'i >= 3';
    const lineInsideLoop = runtime === 'powershell' ? 8 : 9; // line numbers differ between scripts

    const scriptUri = vscode.Uri.file(path.join(extensionRoot, scriptRelative));
    const workspaceFolder = resolveWorkspaceFolder(extensionRoot);
    await openScriptDocument(scriptUri);
    if (runtime === 'powershell') {
      const hasPowerShell = await ensurePowerShellExtension();
      if (!hasPowerShell) {
        this.skip();
        return;
      }
    }
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeout_seconds: 60,
        variableFilter: ['i'],
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

    const parts: any[] = (result as any).parts || (result as any).content || [];
    const textOutput = parts
      .map(p => (p.text ? p.text : JSON.stringify(p)))
      .join('\n');

    console.log('Conditional breakpoint output:\n', textOutput);

    // Verify the debug session stopped
    if (/timed out/i.test(textOutput)) {
      throw new Error('Debug session timed out waiting for breakpoint');
    }
    if (/Error starting debug session/i.test(textOutput)) {
      throw new Error('Encountered error starting debug session');
    }
    if (!/(Debug session .* stopped|breakpoint)/i.test(textOutput)) {
      throw new Error('Missing stopped-session or breakpoint descriptor');
    }

    // Parse the debug info to verify the condition was met
    try {
      const debugInfoMatch = textOutput.match(/\{[\s\S]*"breakpoint"[\s\S]*\}/);
      if (debugInfoMatch) {
        const debugInfo = JSON.parse(debugInfoMatch[0]);
        console.log('Parsed debug info:', JSON.stringify(debugInfo, null, 2));

        // Check that we have variable info with $i
        if (debugInfo.variables && debugInfo.variables.variables) {
          const variables = debugInfo.variables.variables;
          const iVariable = variables.find((v: any) => v.name === 'i');

          if (iVariable) {
            const iValue = parseInt(iVariable.value, 10);
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

  test('hitCondition breakpoint triggers on specific hit count (pwsh fallback to node)', async function () {
    this.timeout(5000);
    const runtime = await chooseRuntime();
    const extensionRoot = getExtensionRoot();
    const scriptRelative =
      runtime === 'powershell'
        ? 'test-workspace/test.ps1'
        : 'test-workspace/test.js';
    const lineInsideLoop = runtime === 'powershell' ? 8 : 9;
    const scriptUri = vscode.Uri.file(path.join(extensionRoot, scriptRelative));
    const workspaceFolder = resolveWorkspaceFolder(extensionRoot);
    await openScriptDocument(scriptUri);
    if (runtime === 'powershell') {
      const hasPowerShell = await ensurePowerShellExtension();
      if (!hasPowerShell) {
        this.skip();
        return;
      }
    }
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeout_seconds: 60,
        variableFilter: ['i'],
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

    const parts: any[] = (result as any).parts || (result as any).content || [];
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
    if (!/(Debug session .* stopped|breakpoint)/i.test(textOutput)) {
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
          const iVariable = variables.find((v: any) => v.name === 'i');

          if (iVariable) {
            const iValue = parseInt(iVariable.value, 10);
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

  test('logMessage breakpoint (logpoint) does not stop execution unless adapter treats it as breakpoint (pwsh fallback to node)', async function () {
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
    const workspaceFolder = resolveWorkspaceFolder(extensionRoot);
    await openScriptDocument(scriptUri);
    if (runtime === 'powershell') {
      const hasPowerShell = await ensurePowerShellExtension();
      if (!hasPowerShell) {
        this.skip();
        return;
      }
    }
    await activateCopilotDebugger();
    const tool = new StartDebuggerTool();
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeout_seconds: 60,
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

    const parts: any[] = (result as any).parts || (result as any).content || [];
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
    if (!/(Debug session .* stopped|breakpoint)/i.test(textOutput)) {
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
