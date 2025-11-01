import * as vscode from 'vscode';
import {
  LanguageModelTool,
  LanguageModelToolResult,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  ProviderResult,
} from 'vscode';
import { DAPHelpers, VariableInfo, FoundVariable } from './debugUtils';

export interface ExpandVariableToolParameters {
  variableName: string;
}

export interface ExpandedVariableData {
  variable: VariableInfo;
  children: VariableInfo[];
}

export class ExpandVariableTool
  implements LanguageModelTool<ExpandVariableToolParameters>
{
  async invoke(
    options: LanguageModelToolInvocationOptions<ExpandVariableToolParameters>
  ): Promise<LanguageModelToolResult> {
    const { variableName } = options.input;

    try {
      // Check if there's an active debug session
      const activeSession = vscode.debug.activeDebugSession;
      if (!activeSession) {
        return DAPHelpers.createErrorResult('No active debug session found');
      }

      // Get debug context (threads, frames, scopes)
      const debugContext = await DAPHelpers.getDebugContext(activeSession);
      if (!debugContext) {
        return DAPHelpers.createErrorResult(
          'Unable to get debug context (threads, frames, or scopes)'
        );
      }

      // Find the target variable in all scopes
      const foundVariable: FoundVariable | null =
        await DAPHelpers.findVariableInScopes(
          activeSession,
          debugContext.scopes,
          variableName
        );

      if (!foundVariable) {
        return DAPHelpers.createErrorResult(
          `Variable '${variableName}' not found in current scope`
        );
      }

      // Prepare the expanded variable data
      const expandedData: ExpandedVariableData = {
        variable: foundVariable.variable,
        children: [],
      };

      // If the variable is expandable, get its children
      if (foundVariable.variable.isExpandable) {
        // Get the original Variable object to access variablesReference
        const originalVariable = await this.getOriginalVariable(
          activeSession,
          debugContext.scopes,
          variableName
        );

        if (originalVariable && originalVariable.variablesReference > 0) {
          expandedData.children = await DAPHelpers.getVariablesFromReference(
            activeSession,
            originalVariable.variablesReference
          );
        }
      }

      const result = JSON.stringify(expandedData, null, 2);
      return DAPHelpers.createSuccessResult(result);
    } catch (_error) {
      const errorMessage =
        _error instanceof Error ? _error.message : 'Unknown error occurred';
      return DAPHelpers.createErrorResult(
        `Failed to expand variable: ${errorMessage}`
      );
    }
  }

  private async getOriginalVariable(
    session: vscode.DebugSession,
    scopes: any[],
    variableName: string
  ): Promise<any | null> {
    for (const scope of scopes) {
      let variablesResponse: any;
      try {
        variablesResponse = await session.customRequest('variables', {
          variablesReference: scope.variablesReference,
        });
      } catch {
        continue; // Skip scopes that fail
      }
      if (variablesResponse?.variables) {
        const foundVariable = variablesResponse.variables.find(
          (v: any) => (v.evaluateName || v.name) === variableName
        );
        if (foundVariable) {
          return foundVariable;
        }
      }
    }
    return null;
  }

  prepareInvocation?(
    options: LanguageModelToolInvocationPrepareOptions<ExpandVariableToolParameters>
  ): ProviderResult<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Expanding variable '${options.input.variableName}'`,
    };
  }
}
