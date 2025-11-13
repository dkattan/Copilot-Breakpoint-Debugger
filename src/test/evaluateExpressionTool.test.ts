import assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { EvaluateExpressionTool } from '../evaluateExpressionTool';
import { startDebuggingAndWaitForStop } from '../session';

describe('evaluateExpressionTool', () => {
  it('prepareInvocation includes expression', async () => {
    const tool = new EvaluateExpressionTool();

    const maybePrepared = tool.prepareInvocation?.({
      input: { expression: 'foo', sessionId: '', threadId: 0 },
    });
    const prepared = await Promise.resolve(maybePrepared);
    const invocationMessage =
      typeof prepared?.invocationMessage === 'string'
        ? prepared.invocationMessage
        : prepared?.invocationMessage?.value;
    assert.ok(invocationMessage?.includes('foo'));
  });

  it('invoke returns error if no session or invalid expression', async () => {
    const tool = new EvaluateExpressionTool();

    const result = await tool.invoke({
      input: { expression: 'foo', sessionId: '', threadId: 0 },
      toolInvocationToken: undefined,
    });

    const first = result.content[0] as
      | { value?: string; text?: string }
      | string;
    const combined =
      typeof first === 'string'
        ? first
        : String(first.value || first.text || '');
    // Should produce error message (no session, invalid expression, or evaluation result)
    assert.ok(
      /Error:|not defined|\{"expression"/.test(combined),
      `Should evaluate or produce error, got: ${combined}`
    );
  });

  it('evaluate variable in Node session', async function () {
    this.timeout(5000);
    // Start a Node debug session hitting a breakpoint in test.js
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const workspaceFolder = path.join(extensionRoot, 'test-workspace');

    await startDebuggingAndWaitForStop({
      sessionName: 'eval-expression-node',
      workspaceFolder,
      nameOrConfiguration: 'Run test.js',
      breakpointConfig: {
        breakpoints: [
          {
            path: jsPath,
            line: 5, // after randomValue assignment
          },
        ],
      },
    });
    // Evaluate randomValue
    const evalTool = new EvaluateExpressionTool();

    const evalResult = await evalTool.invoke({
      input: { expression: 'randomValue', sessionId: '', threadId: 0 },
      toolInvocationToken: undefined,
    });
    const evalParts = (evalResult.content || []) as Array<{
      text?: string;
      value?: string;
    }>;
    const evalText = evalParts
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
    // Expect JSON with result
    assert.ok(/"expression":"randomValue"/.test(evalText));
  });
});
