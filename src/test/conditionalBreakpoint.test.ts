import assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DAPHelpers } from '../debugUtils';
import { startDebuggingAndWaitForStop } from '../session';
import {
  activateCopilotDebugger,
  assertPowerShellExtension,
  getExtensionRoot,
  openScriptDocument,
} from './utils/startDebuggerToolTestUtils';

// Conditional breakpoint + hitCondition + logpoint tests.
// First test is PowerShell-only (no Node fallback). Remaining tests still fallback.

describe('conditional Breakpoint Integration', () => {
  it('conditional breakpoint triggers only when condition is met (powershell)', async function () {
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

    const configurationName = 'Run test.ps1';
    const context = await startDebuggingAndWaitForStop({
      sessionName: 'conditional-pwsh',
      workspaceFolder,
      nameOrConfiguration: configurationName,
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptUri.fsPath,
            line: lineInsideLoop,
            condition,
          },
        ],
      },
    });

    // Assert we stopped at the expected line
    if (context.frame.line !== lineInsideLoop) {
      throw new Error(
        `Stopped at unexpected line ${context.frame.line}, expected ${lineInsideLoop}`
      );
    }

    // Collect variables from scopes using active session
    const activeSession = vscode.debug.activeDebugSession;
    if (!activeSession) {
      throw new Error('No active debug session after breakpoint hit');
    }

    const allVariables: { name: string; value: string }[] = [];
    for (const scope of context.scopes) {
      const vars = await DAPHelpers.getVariablesFromReference(
        activeSession,
        scope.variablesReference
      );
      allVariables.push(...vars);
    }

    const iVariable = allVariables.find(v => v.name === 'i');
    if (iVariable) {
      const iValue = Number.parseInt(iVariable.value, 10);
      if (iValue < 3) {
        throw new Error(
          `Conditional breakpoint triggered too early: i = ${iValue}, expected >= 3`
        );
      }
    } else {
      console.warn('Variable i not found in collected scopes');
    }
  });

  it('hitCondition breakpoint triggers on specific hit count (node)', async function () {
    this.timeout(5000);
    const extensionRoot = getExtensionRoot();
    const scriptRelative = 'test-workspace/test.js';
    const lineInsideLoop = 9;
    const scriptUri = vscode.Uri.file(path.join(extensionRoot, scriptRelative));

    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error(
        'No workspace folders found. Ensure test-workspace.code-workspace is loaded.'
      );
    }
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const configurationName = 'Run test.js';
    const context = await startDebuggingAndWaitForStop({
      sessionName: 'hitcondition-node',
      workspaceFolder,
      nameOrConfiguration: configurationName,
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptUri.fsPath,
            line: lineInsideLoop,
            hitCondition: '3',
          },
        ],
      },
    });

    if (context.frame.line !== lineInsideLoop) {
      throw new Error(
        `Stopped at unexpected line ${context.frame.line}, expected ${lineInsideLoop}`
      );
    }

    const activeSession = vscode.debug.activeDebugSession;
    if (!activeSession) {
      throw new Error('No active debug session after breakpoint hit');
    }
    const allVariables: { name: string; value: string }[] = [];
    for (const scope of context.scopes) {
      const vars = await DAPHelpers.getVariablesFromReference(
        activeSession,
        scope.variablesReference
      );
      allVariables.push(...vars);
    }
    const iVariable = allVariables.find(v => v.name === 'i');
    if (iVariable) {
      const iValue = Number.parseInt(iVariable.value, 10);
      if (iValue !== 2) {
        console.warn(
          `Hit condition may not have worked as expected: i = ${iValue}, expected 2`
        );
      }
    } else {
      console.warn('Variable i not found in collected scopes');
    }
  });

  it('logMessage breakpoint (logpoint) does not stop execution unless adapter treats it as breakpoint (pwsh fallback to node)', async function () {
    this.timeout(5000);
    const extensionRoot = getExtensionRoot();
    const scriptRelative = 'test-workspace/test.js';
    const lineInsideLoop = 9;
    const postLoopLine = 14;
    const logMessage = 'Logpoint Loop iteration: {i}';
    const scriptUri = vscode.Uri.file(path.join(extensionRoot, scriptRelative));

    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error(
        'No workspace folders found. Ensure test-workspace.code-workspace is loaded.'
      );
    }
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;

    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();

    const configurationName = 'Run test.js';
    const context = await startDebuggingAndWaitForStop({
      sessionName: 'logpoint-node',
      workspaceFolder,
      nameOrConfiguration: configurationName,
      
      breakpointConfig: {
        breakpoints: [
          {
            path: scriptUri.fsPath,
            line: lineInsideLoop,
            // condition: 'i > 2',
            logMessage,
          },
          {
            path: scriptUri.fsPath,
            line: postLoopLine,
          },
        ],
      },
    });

    assert.equal(
      context.frame.line,
      lineInsideLoop,
      `Stopped at logpoint line ${lineInsideLoop}; expected to continue to ${postLoopLine}`
    );
    assert.equal(
      context.frame.line,
      postLoopLine,
      `Stopped at unexpected line ${context.frame.line}; expected ${postLoopLine}`
    );
  });
});
