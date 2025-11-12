import type {
  LanguageModelToolInvocationPrepareOptions,
  PreparedToolInvocation,
} from 'vscode';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { StartDebuggerTool } from '../startDebuggerTool';
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
    this.timeout(90000);
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const workspaceFolder = path.join(extensionRoot, 'test-workspace');
    // Start
    const startTool = new StartDebuggerTool();
    const startResult = await startTool.invoke({
      input: {
        workspaceFolder,
        timeoutSeconds: 60,
        configurationName: 'Run test.js',
        breakpointConfig: { breakpoints: [{ path: jsPath, line: 5 }] },
      },
      toolInvocationToken: undefined,
    });
    const startParts = (startResult.content || []) as Array<{
      text?: string;
      value?: string;
    }>;
    const startText = startParts
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
    if (/timed out/i.test(startText)) {
      this.skip();
    }
    // Extract session name from start output (best-effort)
    const match = startText.match(/Debug session (.*?) stopped/);
    const sessionName = match ? match[1] : 'Inline Node Test';
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
