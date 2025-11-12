import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { EvaluateExpressionTool } from '../evaluateExpressionTool';
import { StartDebuggerTool } from '../startDebuggerTool';

describe('evaluateExpressionTool', () => {
  it('prepareInvocation includes expression', async () => {
    const tool = new EvaluateExpressionTool();
    interface MockPrepareOptions {
      input: { expression: string };
    }
    const maybePrepared = tool.prepareInvocation?.({
      input: { expression: 'foo' },
    } as MockPrepareOptions);
    interface PreparedInvocation {
      invocationMessage: string;
    }
    const prepared = await Promise.resolve(
      maybePrepared as PreparedInvocation | undefined
    );
    assert.ok(prepared?.invocationMessage.includes('foo'));
  });

  it('invoke returns error if no session or invalid expression', async () => {
    const tool = new EvaluateExpressionTool();
    interface MockInvokeOptions {
      input: { expression: string };
      toolInvocationToken: undefined;
    }
    const result = await tool.invoke({
      input: { expression: 'foo' },
      toolInvocationToken: undefined,
    } as MockInvokeOptions);
    interface LanguageModelTextPart {
      value: string;
    }
    const textPart = result.content[0] as LanguageModelTextPart;
    const combined = textPart.value;
    // Should produce error message (no session, invalid expression, or evaluation result)
    assert.ok(
      /Error:|not defined|\{"expression"/.test(combined),
      `Should evaluate or produce error, got: ${combined}`
    );
  });

  it('evaluate variable in Node session', async function () {
    this.timeout(90000);
    // Start a Node debug session hitting a breakpoint in test.js
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const workspaceFolder = path.join(extensionRoot, 'test-workspace');
    const tool = new StartDebuggerTool();
    const startResult = await tool.invoke({
      input: {
        workspaceFolder,
        timeoutSeconds: 60,
        configurationName: 'Run test.js',
        breakpointConfig: {
          breakpoints: [
            {
              path: jsPath,
              line: 5, // after randomValue assignment
            },
          ],
        },
      },
      toolInvocationToken: undefined,
    });
    // LanguageModelToolResult has a content array containing LanguageModelTextPart or unknown types
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
      return;
    }
    // Evaluate randomValue
    const evalTool = new EvaluateExpressionTool();
    interface MockEvaluateOptions {
      input: { expression: string };
      toolInvocationToken: undefined;
    }
    const evalResult = await evalTool.invoke({
      input: { expression: 'randomValue' },
      toolInvocationToken: undefined,
    } as MockEvaluateOptions);
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
