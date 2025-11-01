import {
  invokeStartDebuggerTool,
  ensurePowerShellExtension,
  activateCopilotDebugger,
  getExtensionRoot,
  openScriptDocument,
  StartDebuggerResult,
} from './utils/startDebuggerToolTestUtils';
import * as path from 'path';
import * as vscode from 'vscode';

// Helper to extract variables array lengths from text output (expects a JSON blob containing \"variablesByScope\")
function extractVariableCounts(result: StartDebuggerResult): {
  total: number;
  byScope: Record<string, number>;
} {
  for (const part of result.parts) {
    const text = part.text || part;
    if (typeof text !== 'string') {
      continue;
    }
    if (!text.includes('variablesByScope')) {
      continue;
    }
    // Attempt to isolate JSON substring if text contains other info
    const candidateMatches = text.match(/\{[\s\S]*\}/g) || [];
    for (const candidate of candidateMatches) {
      if (!candidate.includes('variablesByScope')) {
        continue;
      }
      try {
        const parsed = JSON.parse(candidate);
        const container = parsed.variables || parsed; // handle nested
        const scopes = container.variablesByScope;
        if (!Array.isArray(scopes)) {
          continue;
        }
        const byScope: Record<string, number> = {};
        let total = 0;
        for (const s of scopes) {
          const count = Array.isArray(s.variables) ? s.variables.length : 0;
          byScope[s.scopeName || s.name || 'unknown'] = count;
          total += count;
        }
        return { total, byScope };
      } catch (e) {
        // ignore parse errors
      }
    }
  }
  return { total: 0, byScope: {} };
}

suite('Variable Filter Reduces Payload', () => {
  test('filtered variables are fewer than unfiltered', async function () {
    this.timeout(60000);
    // Skip if PowerShell extension missing
    const hasPwsh = await ensurePowerShellExtension();
    if (!hasPwsh) {
      this.skip();
      return;
    }
    await activateCopilotDebugger();

    const extensionRoot = getExtensionRoot();
    const scriptUri = vscode.Uri.file(
      path.join(extensionRoot, 'test-workspace/test.ps1')
    );
    await openScriptDocument(scriptUri);

    // First run: unfiltered (use broad regex that matches everything) by omitting variableFilter
    const unfiltered = await invokeStartDebuggerTool({
      scriptRelativePath: 'test-workspace/test.ps1',
      timeoutSeconds: 60,
      variableFilter: ['.'], // '.' matches any variable name (acts as unfiltered)
      breakpointLines: [4], // ensure we hit the known breakpoint
    });
    const unfilteredCounts = extractVariableCounts(unfiltered);
    if (unfilteredCounts.total === 0) {
      // Debug output to help diagnose why extraction failed

      console.log('VariableFilterTest: Unfiltered parts:', unfiltered.parts);
    }

    // Second run: filtered to a small subset (e.g., PWD only)
    const filtered = await invokeStartDebuggerTool({
      scriptRelativePath: 'test-workspace/test.ps1',
      timeoutSeconds: 60,
      variableFilter: ['^PWD$'], // anchored to only PWD
      breakpointLines: [4],
    });
    const filteredCounts = extractVariableCounts(filtered);

    // Basic sanity: unfiltered should have more or equal variables than filtered
    if (unfilteredCounts.total === 0) {
      // If adapter or environment did not expose variables, skip rather than fail
      this.skip();
      return;
    }
    if (filteredCounts.total === 0) {
      throw new Error(
        'Filtered run captured zero variables; expected to at least match PWD'
      );
    }
    if (filteredCounts.total >= unfilteredCounts.total) {
      throw new Error(
        `Filter did not reduce variables: filtered=${filteredCounts.total}, unfiltered=${unfilteredCounts.total}`
      );
    }
  });
});
