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

// Test serverReady vscodeCommand action variant: executes VS Code command when readiness breakpoint hit, then continues.

describe('serverReady vscodeCommand action', function () {
  this.timeout(60_000);
  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it('executes vscodeCommand at serverReady breakpoint then pauses at user breakpoint', async () => {
    await activateCopilotDebugger();
    const extensionRoot = getExtensionRoot();
    const workspaceFolder = path.join(extensionRoot, 'test-workspace', 'b');
    const serverPath = path.join(workspaceFolder, 'server.js');
    const serverDoc = await vscode.workspace.openTextDocument(serverPath);
    await openScriptDocument(serverDoc.uri);

    const readyLine =
      serverDoc
        .getText()
        .split(/\r?\n/)
        .findIndex((l) => l.includes('LINE_FOR_SERVER_READY')) + 1;
    assert.ok(readyLine > 0, 'Did not find serverReady marker line');
    const userBreakpointSnippet = 'Server listening on http://localhost:';
    const userBreakpointLine =
      serverDoc
        .getText()
        .split(/\r?\n/)
        .findIndex((l) => l.includes(userBreakpointSnippet)) + 1;
    assert.ok(userBreakpointLine > 0, 'Did not find user breakpoint snippet line');

    const context = await startDebuggingAndWaitForStop({
      sessionName: '',
      workspaceFolder,
      nameOrConfiguration: 'Run b/server.js',
      timeoutSeconds: 20,
      breakpointConfig: {
        breakpoints: [
          {
            path: serverPath,
            code: userBreakpointSnippet,
            variableFilter: ['started'],
            onHit: 'break',
          },
        ],
      },
      serverReady: {
        trigger: { path: serverPath, line: readyLine },
        action: {
          type: 'vscodeCommand',
          command: 'workbench.action.closePanel',
        },
      },
    });

    assert.strictEqual(
      context.frame.line,
      userBreakpointLine,
      'Did not pause at expected user breakpoint line after serverReady continue (vscodeCommand)'
    );
    assert.ok(context.hitBreakpoint, 'hitBreakpoint missing (vscodeCommand)');
    assert.strictEqual(
      context.hitBreakpoint?.line,
      userBreakpointLine,
      'hitBreakpoint line mismatch (vscodeCommand)'
    );
  });
});
