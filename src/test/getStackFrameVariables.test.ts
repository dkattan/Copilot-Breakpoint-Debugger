import { getStackFrameVariables } from '../inspection';
import { activeSessions } from '../common';
import * as assert from 'assert';

class MockDebugSession {
  id = 'mock-session';
  name = 'mock';
  type = 'mockType';
  workspaceFolder = undefined;
  configuration: any = {};
  customRequest(method: string, args?: any): any {
    if (method === 'scopes') {
      return {
        scopes: [
          { name: 'Local', variablesReference: 1 },
          { name: 'Empty', variablesReference: 0 },
        ],
      };
    }
    if (method === 'variables') {
      if (args?.variablesReference === 1) {
        return {
          variables: [
            { name: 'alpha', value: '1' },
            { name: 'beta', value: '2' },
            { name: 'gamma', value: '3' },
          ],
        };
      }
      return { variables: [] };
    }
    throw new Error(`Unexpected method ${method}`);
  }
}

suite('getStackFrameVariables filter behavior', () => {
  setup(() => {
    // Clear and insert mock session
    activeSessions.splice(0, activeSessions.length);
    activeSessions.push(new MockDebugSession() as any);
  });

  test('returns all variables when no filter provided', async () => {
    const result: any = await getStackFrameVariables({
      sessionId: 'mock-session',
      frameId: 10,
      threadId: 1,
    });
    assert.strictEqual(result.isError, false, 'Result should not be error');
    const json = result.content[0].json;
    const localScope = json.variablesByScope.find(
      (s: any) => s.scopeName === 'Local'
    );
    assert.ok(localScope, 'Local scope missing');
    assert.strictEqual(
      localScope.variables.length,
      3,
      'Expected 3 variables unfiltered'
    );
  });

  test('filters variables by regex fragments', async () => {
    const result: any = await getStackFrameVariables({
      sessionId: 'mock-session',
      frameId: 10,
      threadId: 1,
      filter: 'alpha|gamma',
    });
    assert.strictEqual(result.isError, false, 'Result should not be error');
    const json = result.content[0].json;
    const localScope = json.variablesByScope.find(
      (s: any) => s.scopeName === 'Local'
    );
    assert.ok(localScope, 'Local scope missing');
    const names = localScope.variables.map((v: any) => v.name).sort();
    assert.deepStrictEqual(
      names,
      ['alpha', 'gamma'],
      'Filtered variables should be alpha and gamma'
    );
  });

  test('filter excluding all yields empty array', async () => {
    const result: any = await getStackFrameVariables({
      sessionId: 'mock-session',
      frameId: 10,
      threadId: 1,
      filter: 'delta',
    });
    assert.strictEqual(result.isError, false, 'Result should not be error');
    const json = result.content[0].json;
    const localScope = json.variablesByScope.find(
      (s: any) => s.scopeName === 'Local'
    );
    assert.ok(localScope, 'Local scope missing');
    assert.strictEqual(
      localScope.variables.length,
      0,
      'No variables should match filter'
    );
  });
});
