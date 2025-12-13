import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { startDebuggingAndWaitForStop } from '../session';
import {
  activateCopilotDebugger,
  getExtensionRoot,
  openScriptDocument,
  stopAllDebugSessions,
} from './utils/startDebuggerToolTestUtils';

describe('startDebuggingAndWaitForStop - capture-all (variableFilter omitted)', () => {
  const configurationName = 'Run test.js';
  let workspaceFolder: string;
  let scriptPath: string;
  let baseParams: { workspaceFolder: string; nameOrConfiguration: string };

  before(async () => {
    const extensionRoot = getExtensionRoot();
    const scriptRelative = 'test-workspace/b/test.js';
    const scriptUri = vscode.Uri.file(path.join(extensionRoot, scriptRelative));
    assert.ok(vscode.workspace.workspaceFolders?.length);
    workspaceFolder = vscode.workspace.workspaceFolders.find(
      (f) => f.name === 'workspace-b'
    )!.uri.fsPath;
    scriptPath = scriptUri.fsPath;
    await openScriptDocument(scriptUri);
    await activateCopilotDebugger();
    baseParams = { workspaceFolder, nameOrConfiguration: configurationName };
  });

  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it('capture action without variableFilter auto-captures variables and interpolates log message', async () => {
    const targetLine = 9; // loop line in test.js
    const context = await startDebuggingAndWaitForStop(
      Object.assign({}, baseParams, {
        sessionName: '',
        breakpointConfig: {
          breakpoints: [
            {
              path: scriptPath,
              line: targetLine,
              onHit: 'captureAndContinue' as const,
              logMessage: 'i={i}',
              // variableFilter intentionally omitted for auto-capture
            },
          ],
        },
      })
    );

    assert.strictEqual(
      context.frame.line,
      targetLine,
      'Did not pause at expected line for capture-all test'
    );
    assert.ok(context.hitBreakpoint, 'hitBreakpoint missing');
    assert.strictEqual(context.hitBreakpoint?.onHit, 'captureAndContinue');
    assert.strictEqual(
      context.hitBreakpoint?.variableFilter,
      undefined,
      'variableFilter should be undefined when omitted'
    );
    assert.ok(
      Array.isArray(context.capturedLogMessages) &&
        context.capturedLogMessages.length === 1,
      'Expected one captured log message'
    );
    assert.ok(
      /i=\d+/.test(context.capturedLogMessages![0]),
      `Log message interpolation missing expected variable value: ${
        context.capturedLogMessages![0]
      }`
    );
  });
});
