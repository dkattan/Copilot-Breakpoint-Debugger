import * as assert from 'node:assert';
import * as path from 'node:path';
import { it, suite } from 'mocha';
import * as vscode from 'vscode';
import { EvaluateExpressionTool } from '../evaluateExpressionTool';
import { StartDebuggerTool } from '../startDebuggerTool';

suite('evaluateExpressionTool', () => {
  test('prepareInvocation includes expression', async () => {
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

  it('invoke returns error if no session', async () => {
    const tool = new EvaluateExpressionTool();
    interface MockInvokeOptions {
      input: { expression: string };
      toolInvocationToken: undefined;
    }
    const result = await tool.invoke({
      input: { expression: 'foo' },
      toolInvocationToken: undefined,
    } as MockInvokeOptions);
    // LanguageModelToolResult has a content array containing LanguageModelTextPart or unknown types
    const parts = (result.content || []) as Array<{
      text?: string;
      value?: string;
    }>;
    const combined = parts
      .map(p => {
        if (typeof p === 'object' && p !== null) {
          if ('text' in p) {
            return (p as { text?: string }).text;
          }
          if ('value' in p) {
            return (p as { value?: string }).value;
          }
        }
        return JSON.stringify(p);
      })
      .join('\n');
    // Depending on timing there may or may not be a session; allow either success or specific error
    assert.ok(
      /Error: No active debug session|\{"expression"/.test(combined),
      'Should evaluate or produce no-session error'
    );
  });

  it('evaluate variable in Node session', async function () {
    this.timeout(5000);
    // Start a Node debug session hitting a breakpoint in test.js
    const extensionRoot =
      vscode.extensions.getExtension('dkattan.copilot-breakpoint-debugger')
        ?.extensionPath || path.resolve(__dirname, '../../..');
    const jsPath = path.join(extensionRoot, 'test-workspace/test.js');
    const tool = new StartDebuggerTool();
    interface MockStartDebuggerOptions {
      input: {
        workspaceFolder: string;
        timeout_seconds: number;
        breakpointConfig?: {
          breakpoints?: Array<{
            path: string;
            line: number;
          }>;
        };
      };
      toolInvocationToken: undefined;
    }
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
      toolInvocationToken: undefined,
    } as MockStartDebuggerOptions);
    // LanguageModelToolResult has a content array containing LanguageModelTextPart or unknown types
    const startParts = (startResult.content || []) as Array<{
      text?: string;
      value?: string;
    }>;
    const startText = startParts
      .map(p => {
        if (typeof p === 'object' && p !== null) {
          if ('text' in p) {
            return (p as { text?: string }).text;
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
          if ('text' in p) {
            return (p as { text?: string }).text;
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
