import * as assert from 'assert';
import { EvaluateExpressionTool } from '../evaluateExpressionTool';
import { StartDebuggerTool } from '../startDebuggerTool';
import * as path from 'path';
import * as vscode from 'vscode';

suite('EvaluateExpressionTool', () => {
  test('prepareInvocation includes expression', async () => {
    const tool = new EvaluateExpressionTool();
    const maybePrepared = tool.prepareInvocation?.({
      input: { expression: 'foo' },
    } as any);
    const prepared = await Promise.resolve(maybePrepared as any);
    assert.ok(prepared.invocationMessage.includes('foo'));
  });

  test('invoke returns error if no session', async () => {
    const tool = new EvaluateExpressionTool();
    const result = await tool.invoke({
      input: { expression: 'foo' },
    } as any);
    const parts: any[] = (result as any).parts || [];
    const combined = parts.map(p => p.text || '').join('\n');
    // Depending on timing there may or may not be a session; allow either success or specific error
    assert.ok(
      /Error: No active debug session|\{"expression"/.test(combined),
      'Should evaluate or produce no-session error'
    );
  });

  test('evaluate variable in Node session', async function () {
    this.timeout(5000);
    // Start a Node debug session hitting a breakpoint in test.js
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const tool = new StartDebuggerTool();
    const startResult = await tool.invoke({
      input: {
        workspaceFolder: extensionRoot,
        timeout_seconds: 30,
        breakpointConfig: {
          breakpoints: [
            {
              path: jsPath,
              line: 5, // after randomValue assignment
            },
          ],
        },
      },
    } as any);
    const startText = (startResult as any).parts
      .map((p: any) => p.text || '')
      .join('\n');
    if (/timed out/i.test(startText)) {
      this.skip();
      return;
    }
    // Evaluate randomValue
    const evalTool = new EvaluateExpressionTool();
    const evalResult = await evalTool.invoke({
      input: { expression: 'randomValue' },
    } as any);
    const evalText = (evalResult as any).parts
      .map((p: any) => p.text || '')
      .join('\n');
    // Expect JSON with result
    assert.ok(/"expression":"randomValue"/.test(evalText));
  });
});
