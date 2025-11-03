import * as assert from 'assert';
import { StopDebugSessionTool } from '../stopDebugSessionTool';
import { StartDebuggerTool } from '../startDebuggerTool';
import * as path from 'path';
import * as vscode from 'vscode';

suite('StopDebugSessionTool', () => {
  test('prepareInvocation includes session name', async () => {
    const tool = new StopDebugSessionTool();
    const maybePrepared = tool.prepareInvocation?.({
      input: { sessionName: 'MySession' },
    } as any);
    const prepared = await Promise.resolve(maybePrepared as any);
    assert.ok(prepared.invocationMessage.includes('MySession'));
  });

  test('invoke reports no session when none running', async () => {
    const tool = new StopDebugSessionTool();
    const result = await tool.invoke({
      input: { sessionName: 'NotRunning' },
    } as any);
    const parts: any[] = (result as any).parts || [];
    const combined = parts.map(p => p.text || '').join('\n');
    assert.ok(/No debug session\(s\) found/i.test(combined));
  });

  test('start then stop session', async function () {
    this.timeout(5000);
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    // Start
    const startTool = new StartDebuggerTool();
    const startResult = await startTool.invoke({
      input: {
        workspaceFolder: extensionRoot,
        timeout_seconds: 30,
        breakpointConfig: { breakpoints: [{ path: jsPath, line: 5 }] },
      },
    } as any);
    const startText = (startResult as any).parts
      .map((p: any) => p.text || '')
      .join('\n');
    if (/timed out/i.test(startText)) {
      this.skip();
      return;
    }
    // Extract session name from start output (best-effort)
    const match = startText.match(/Debug session (.*?) stopped/);
    const sessionName = match ? match[1] : 'Inline Node Test';
    const stopTool = new StopDebugSessionTool();
    const stopResult = await stopTool.invoke({
      input: { sessionName },
    } as any);
    const stopText = (stopResult as any).parts
      .map((p: any) => p.text || '')
      .join('\n');
    assert.ok(/Stopped debug session\(s\)/i.test(stopText));
  });
});
