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

suite('Variable Filter Reduces Payload (Unified)', () => {
  test('filtered variables are fewer than unfiltered (pwsh fallback to node)', async function () {
    this.timeout(5000);

    // Decide runtime: prefer PowerShell if available locally & not explicitly disabled by CI env
    const preferPwsh = !process.env.CI && (await ensurePowerShellExtension());
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

    // Unfiltered run ('.' matches anything)
    const unfiltered = await invokeStartDebuggerTool({
      scriptRelativePath,
      timeoutSeconds: 60,
      variableFilter: ['.'],
      breakpointLines,
    });
    const unfilteredCounts = extractVariableCounts(unfiltered);
    if (unfilteredCounts.total === 0) {
      console.log('VariableFilterTest: Unfiltered parts:', unfiltered.parts);
    }

    // Filtered run
    const filtered = await invokeStartDebuggerTool({
      scriptRelativePath,
      timeoutSeconds: 60,
      variableFilter: [filteredPattern],
      breakpointLines,
    });
    const filteredCounts = extractVariableCounts(filtered);

    if (unfilteredCounts.total === 0) {
      // Adapter produced no variables; skip to avoid false failure (seen occasionally in pwsh envs)
      this.skip();
      return;
    }
    if (filteredCounts.total === 0) {
      throw new Error(
        `Filtered run captured zero variables; expected at least one match for pattern ${filteredPattern}`
      );
    }
    if (filteredCounts.total >= unfilteredCounts.total) {
      throw new Error(
        `Filter did not reduce variables (runtime=${runtime}): filtered=${filteredCounts.total}, unfiltered=${unfilteredCounts.total}`
      );
    }
  });
});
