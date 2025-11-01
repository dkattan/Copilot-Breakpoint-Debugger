import * as assert from 'assert';
import { ResumeDebugSessionTool } from '../resumeDebugSessionTool';

suite('ResumeDebugSessionTool', () => {
  test('prepareInvocation includes session id', async () => {
    const tool = new ResumeDebugSessionTool();
    const maybePrepared = tool.prepareInvocation?.({
      input: { sessionId: 'session-123' },
    } as any);
    const prepared = await Promise.resolve(maybePrepared as any);
    assert.ok(prepared, 'Prepared invocation should be defined');
    assert.ok(
      prepared.invocationMessage.includes('session-123'),
      'Invocation message should include session id'
    );
  });

  test('invoke returns error when session not found', async () => {
    const tool = new ResumeDebugSessionTool();
    const result = await tool.invoke({
      input: { sessionId: 'missing', waitForStop: false },
    } as any);
    // LanguageModelToolResult is iterable via its parts array (content). Use any cast due to API typing.
    const parts: any[] = (result as any).parts || (result as any).content || [];
    const combined = parts
      .map(p =>
        'text' in p ? p.text : 'value' in p ? p.value : JSON.stringify(p)
      )
      .join('\n');
    assert.ok(
      /Error resuming debug session|No debug session found/i.test(combined),
      'Should contain an error message about resuming debug session'
    );
  });
});
