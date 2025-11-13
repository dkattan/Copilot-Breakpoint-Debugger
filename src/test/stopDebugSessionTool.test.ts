import type {
  LanguageModelToolInvocationPrepareOptions,
  PreparedToolInvocation,
} from 'vscode';
import assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { startDebuggingAndWaitForStop } from '../session';
import {
  StopDebugSessionTool,
  type StopDebugSessionToolParameters,
} from '../stopDebugSessionTool';

describe('stopDebugSessionTool', () => {
  it('prepareInvocation includes session name', async () => {
    const tool = new StopDebugSessionTool();
    const maybePrepared = tool.prepareInvocation?.({
      input: { sessionName: 'MySession' },
    } as LanguageModelToolInvocationPrepareOptions<StopDebugSessionToolParameters>);
    const prepared = await Promise.resolve(
      maybePrepared as PreparedToolInvocation | undefined
    );
    assert.ok(prepared, 'Prepared invocation should be defined');
    const message =
      typeof prepared.invocationMessage === 'string'
        ? prepared.invocationMessage
        : prepared.invocationMessage?.value || '';
    assert.ok(message.includes('MySession'));
  });

  it('invoke reports no session when none running', async () => {
    const tool = new StopDebugSessionTool();
    const result = await tool.invoke({
      input: { sessionName: 'NotRunning' },
      toolInvocationToken: undefined,
    });
    // LanguageModelToolResult has a content array containing LanguageModelTextPart or unknown types
    const parts = (result.content || []) as Array<{
      text?: string;
      value?: string;
    }>;
    const combined = parts
      .map(p => {
        if (typeof p === 'object' && p !== null) {
          if ('value' in p) {
            return (p as { value?: string }).value;
          }
          if ('value' in p) {
            return (p as { value?: string }).value;
          }
        }
        return JSON.stringify(p);
      })
      .join('\n');
    assert.ok(/No debug session\(s\) found/i.test(combined));
  });

  it('start then stop session', async function () {
    this.timeout(5000);
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const workspaceFolder = path.join(extensionRoot, 'test-workspace');

    if (!vscode.workspace.workspaceFolders?.length) {
      assert.fail(
        'No workspace folders found. Ensure test-workspace.code-workspace is loaded.'
      );
    }

    // Start debugging and wait for stop
    const context = await startDebuggingAndWaitForStop({
      sessionName: 'stop-session-test',
      workspaceFolder,
      nameOrConfiguration: 'Run test.js',
      breakpointConfig: { breakpoints: [{ path: jsPath, line: 5 }] },
    });

    // Verify we stopped at expected line
    assert.strictEqual(
      context.frame.line,
      5,
      `Stopped at unexpected line ${context.frame.line}, expected 5`
    );

    // Now test stopping the session
    const activeSession = vscode.debug.activeDebugSession;
    assert.ok(activeSession, 'No active debug session after breakpoint hit');

    const sessionName = activeSession.name;
    const stopTool = new StopDebugSessionTool();
    const stopResult = await stopTool.invoke({
      input: { sessionName },
      toolInvocationToken: undefined,
    });
    const stopParts = (stopResult.content || []) as Array<{
      text?: string;
      value?: string;
    }>;
    const stopText = stopParts
      .map(p => {
        if (typeof p === 'object' && p !== null) {
          if ('value' in p) {
            return (p as { value?: string }).value;
          }
          if ('value' in p) {
            return (p as { value?: string }).value;
          }
        }
        return JSON.stringify(p);
      })
      .join('\n');
    assert.ok(/Stopped debug session\(s\)/i.test(stopText));
  });
});
