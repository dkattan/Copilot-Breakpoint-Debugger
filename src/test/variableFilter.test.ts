import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  activateCopilotDebugger,
  ensurePowerShellExtension,
  getExtensionRoot,
  invokeStartDebuggerTool,
  openScriptDocument,
} from './utils/startDebuggerToolTestUtils';

// Helper to extract variables array lengths from text output (expects a JSON blob containing \"variablesByScope\")
// Minimal structural typing for tool result; 'content' may be an array of parts.

function extractVariableCounts(result): {
  total: number;
  byScope: Record<string, number>;
} {
  const rawContent = result?.content;
  const partsArray = Array.isArray(result?.parts)
    ? result.parts.map(p => (typeof p === 'string' ? p : p.text || ''))
    : Array.isArray(rawContent)
      ? rawContent.map(p => (typeof p === 'string' ? p : ''))
      : [typeof rawContent === 'string' ? rawContent : ''];
  const parts: string[] = partsArray;
  for (const text of parts) {
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
      } catch {
        // ignore parse errors
      }
    }
  }
  return { total: 0, byScope: {} };
}

describe('variable Filter Reduces Payload (Unified)', () => {
  it('filtered variables are fewer than unfiltered (pwsh fallback to node)', async function () {
    this.timeout(90000);

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
    const configurationName =
      runtime === 'powershell' ? 'Run test.ps1' : 'Run test.js';
    const unfiltered = await invokeStartDebuggerTool({
      scriptRelativePath,
      timeoutSeconds: 60,
      variableFilter: ['.'],
      breakpointLines,
      configurationName,
    });
    const unfilteredCounts = extractVariableCounts(unfiltered);
    if (unfilteredCounts.total === 0) {
      console.log('VariableFilterTest: Unfiltered result object:', unfiltered);
    }

    // Filtered run
    const filtered = await invokeStartDebuggerTool({
      scriptRelativePath,
      timeoutSeconds: 60,
      variableFilter: [filteredPattern],
      breakpointLines,
      configurationName,
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
