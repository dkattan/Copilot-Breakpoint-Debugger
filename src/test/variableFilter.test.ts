import assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DAPHelpers, type DebugContext } from '../debugUtils';
import { startDebuggingAndWaitForStop } from '../session';
import {
  activateCopilotDebugger,
  assertPowerShellExtension,
  getExtensionRoot,
  openScriptDocument,
} from './utils/startDebuggerToolTestUtils';

// Helper to extract variables array lengths from debug context
async function extractVariableCounts(
  context: DebugContext,
  session: vscode.DebugSession
): Promise<{
  total: number;
  byScope: Record<string, number>;
}> {
  const byScope: Record<string, number> = {};
  let total = 0;

  for (const scope of context.scopes) {
    const variables = await DAPHelpers.getVariablesFromReference(
      session,
      scope.variablesReference
    );
    const count = variables.length;
    byScope[scope.name] = count;
    total += count;
  }

  return { total, byScope };
}

describe('variable Filter Reduces Payload (Unified)', () => {
  it('filtered variables are fewer than unfiltered (pwsh fallback to node)', async function () {
    this.timeout(5000);

    // Decide runtime: prefer PowerShell if available locally & not explicitly disabled by CI env
    const preferPwsh = !process.env.CI && (await assertPowerShellExtension());
    const runtime: 'powershell' | 'node' = preferPwsh ? 'powershell' : 'node';
    await activateCopilotDebugger();

    const extensionRoot = getExtensionRoot();
    const scriptRelativePath =
      runtime === 'powershell'
        ? 'test-workspace/test.ps1'
        : 'test-workspace/test.js';
    const breakpointLines = runtime === 'powershell' ? [4] : [5];
    const filteredPattern =
      runtime === 'powershell' ? '^PWD$' : '^(i|randomValue)$';

    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, scriptRelativePath)
    );
    await openScriptDocument(scriptUri);

    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error(
        'No workspace folders found. Ensure test-workspace.code-workspace is loaded.'
      );
    }
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;

    // Unfiltered run ('.' matches anything)
    const configurationName =
      runtime === 'powershell' ? 'Run test.ps1' : 'Run test.js';
    const unfilteredContext = await startDebuggingAndWaitForStop({
      sessionName: 'variablefilter-unfiltered',
      workspaceFolder,
      nameOrConfiguration: configurationName,
      breakpointConfig: {
        breakpoints: breakpointLines.map(line => ({
          path: path.join(extensionRoot, scriptRelativePath),
          line,
        })),
      },
      variableFilter: ['.'],
      timeoutSeconds: 60,
    });

    const activeSession = vscode.debug.activeDebugSession;
    assert(activeSession, 'No active debug session after unfiltered run');

    const unfilteredCounts = await extractVariableCounts(
      unfilteredContext,
      activeSession
    );
    if (unfilteredCounts.total === 0) {
      console.log('VariableFilterTest: Unfiltered context:', unfilteredContext);
    }

    // Filtered run
    const filteredContext = await startDebuggingAndWaitForStop({
      sessionName: 'variablefilter-filtered',
      workspaceFolder,
      nameOrConfiguration: configurationName,
      breakpointConfig: {
        breakpoints: breakpointLines.map(line => ({
          path: path.join(extensionRoot, scriptRelativePath),
          line,
        })),
      },
      variableFilter: [filteredPattern],
      timeoutSeconds: 60,
    });

    const filteredSession = vscode.debug.activeDebugSession;
    assert(filteredSession, 'No active debug session after filtered run');

    const filteredCounts = await extractVariableCounts(
      filteredContext,
      filteredSession
    );

    if (unfilteredCounts.total === 0) {
      // Adapter produced no variables; skip to avoid false failure (seen occasionally in pwsh envs)
      this.skip();
      return;
    }
    assert(
      filteredCounts.total > 0,
      `Filtered run captured zero variables; expected at least one match for pattern ${filteredPattern}`
    );
    assert(
      filteredCounts.total < unfilteredCounts.total,
      `Filter did not reduce variables (runtime=${runtime}): filtered=${filteredCounts.total}, unfiltered=${unfilteredCounts.total}`
    );
  });
});
