import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
  invokeStartDebuggerTool,
  stopAllDebugSessions,
} from './utils/startDebuggerToolTestUtils';

describe('startDebuggerTool prompt-tsx output', () => {
  afterEach(async () => {
    await stopAllDebugSessions();
  });

  it('returns a prompt-tsx part with breakpoint + scope context', async function () {
    this.timeout(15000);

    if (!vscode.workspace.workspaceFolders?.length) {
      this.skip();
      return;
    }

    const result = await invokeStartDebuggerTool({
      scriptRelativePath: 'test-workspace/b/test.js',
      configurationName: 'Run b/test.js',
      variableFilter: ['i'],
      breakpointLines: [9],
      timeoutSeconds: 30,
    });

    const { content } = result;
    assert.ok(content.length === 1, 'tool should return a single prompt part');
    const promptPart = content[0];
    assert.ok(
      promptPart instanceof vscode.LanguageModelPromptTsxPart,
      'expected LanguageModelPromptTsxPart'
    );

    const promptJson = promptPart.value as { node?: unknown };
    assert.ok(
      promptJson && typeof promptJson === 'object',
      'prompt JSON missing'
    );
    assert.ok('node' in promptJson, 'prompt JSON missing root node');

    const serialized = JSON.stringify(promptJson);
    assert.match(serialized, /Breakpoint Summary/, 'summary chunk missing');
    assert.match(serialized, /Scope/, 'scope chunk missing');

    console.log('[prompt-tsx] serialized length:', serialized.length);
    console.log(
      '[prompt-tsx] preview:',
      serialized.slice(0, Math.min(400, serialized.length))
    );
  });
});
