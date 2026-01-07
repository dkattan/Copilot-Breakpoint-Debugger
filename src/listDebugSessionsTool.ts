import type * as vscode from 'vscode';
import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  LanguageModelToolResult,
  ProviderResult,
} from 'vscode';
import { createTruncatedToolResult } from './outputTruncation';
import { listDebugSessionsForTool } from './session';

export interface ListDebugSessionsToolParameters {
  // Intentionally empty: listing does not require input.
}

export class ListDebugSessionsTool
  implements LanguageModelTool<ListDebugSessionsToolParameters>
{
  async invoke(
    _options: LanguageModelToolInvocationOptions<ListDebugSessionsToolParameters>
  ): Promise<LanguageModelToolResult> {
    try {
      const result = listDebugSessionsForTool();
      return createTruncatedToolResult(result);
    } catch (error) {
      return createTruncatedToolResult(
        `Error listing debug sessions: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  prepareInvocation?(
    _options: LanguageModelToolInvocationPrepareOptions<ListDebugSessionsToolParameters>
  ): ProviderResult<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: 'Listing debug sessions',
    };
  }
}
