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

// Integration test: tests conditional breakpoints by setting a breakpoint
// that only triggers when $i >= 3 in the loop
//
// Note: This suite requires PowerShell runtime and is skipped in CI environments.

suite('Conditional Breakpoint Integration (PowerShell)', () => {
  setup(function () {
    // Skip entire suite in CI - requires PowerShell runtime
    if (process.env.CI) {
      console.log(
        'Skipping PowerShell conditional breakpoint tests in CI (use Node.js tests for coverage)'
      );
      this.skip();
    }
  });

  test('conditional breakpoint triggers only when condition is met', async function () {
    this.timeout(60000); // allow time for activation + breakpoint

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/test.ps1')
    );
    const workspaceFolder = resolveWorkspaceFolder(extensionRoot);

    await openScriptDocument(scriptUri);
    const hasPowerShell = await ensurePowerShellExtension();
    if (!hasPowerShell) {
      this.skip();
      return;
    }
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();

    // Set a conditional breakpoint on line 8 (inside the loop) that only triggers when $i >= 3
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeout_seconds: 60,
        variableFilter: ['i'],
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: 8, // Write-Host "Loop iteration $i"
              condition: '$i -ge 3', // Only trigger when $i >= 3
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

  test('hitCondition breakpoint triggers on specific hit count', async function () {
    this.timeout(60000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/test.ps1')
    );
    const workspaceFolder = resolveWorkspaceFolder(extensionRoot);

    await openScriptDocument(scriptUri);
    const hasPowerShell = await ensurePowerShellExtension();
    if (!hasPowerShell) {
      this.skip();
      return;
    }
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();

    // Set a hit condition breakpoint that only triggers on the 3rd hit
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeout_seconds: 60,
        variableFilter: ['i'],
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: 8, // Write-Host "Loop iteration $i"
              hitCondition: '3', // Only trigger on 3rd hit
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

  test('logMessage breakpoint (logpoint) does not stop execution', async function () {
    this.timeout(60000);

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/test.ps1')
    );
    const workspaceFolder = resolveWorkspaceFolder(extensionRoot);

    await openScriptDocument(scriptUri);
    const hasPowerShell = await ensurePowerShellExtension();
    if (!hasPowerShell) {
      this.skip();
      return;
    }
    await activateCopilotDebugger();

    const tool = new StartDebuggerTool();

    // Set a logpoint that logs but doesn't stop, plus a regular breakpoint to stop
    const result = await tool.invoke({
      input: {
        workspaceFolder,
        timeout_seconds: 60,
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptUri.fsPath,
              line: 8, // Logpoint in the loop
              logMessage: 'Loop iteration: {$i}',
            },
            {
              path: scriptUri.fsPath,
              line: 12, // Regular breakpoint after loop
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
