import type {
  LanguageModelToolInvocationPrepareOptions,
  PreparedToolInvocation,
} from 'vscode';
import * as assert from 'node:assert';
import {
  ResumeDebugSessionTool,
  type ResumeDebugSessionToolParameters,
} from '../resumeDebugSessionTool';

describe('resumeDebugSessionTool', () => {
  it('prepareInvocation includes session id', async () => {
    const tool = new ResumeDebugSessionTool();
    const maybePrepared = tool.prepareInvocation?.({
      input: { sessionId: 'session-123' },
    } as LanguageModelToolInvocationPrepareOptions<ResumeDebugSessionToolParameters>);
    const prepared = await Promise.resolve(
      maybePrepared as PreparedToolInvocation | undefined
    );
    assert.ok(prepared, 'Prepared invocation should be defined');
    const message =
      typeof prepared.invocationMessage === 'string'
        ? prepared.invocationMessage
        : prepared.invocationMessage?.value || '';
    assert.ok(
      message.includes('session-123'),
      'Invocation message should include session id'
    );
  });

  it('invoke returns error when session not found', async () => {
    const tool = new ResumeDebugSessionTool();
    const result = await tool.invoke({
      input: { sessionId: 'missing', waitForStop: false },
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
    assert.ok(
      /Error resuming debug session|No debug session found/i.test(combined),
      'Should contain an error message about resuming debug session'
    );
  });
});
