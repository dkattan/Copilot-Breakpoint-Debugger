import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  LanguageModelToolResult,
  ProviderResult,
} from 'vscode';
import type {
  FoundVariable,
  Scope,
  Variable,
  VariableInfo,
  VariablesResponse,
} from './debugUtils';
import * as vscode from 'vscode';
import { DAPHelpers } from './debugUtils';

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
  /**
   * Expand a variable and get its children as structured data.
   * @param variableName The name of the variable to expand
   * @returns ExpandedVariableData object or throws an error
   */
  async expandVariable(variableName: string): Promise<ExpandedVariableData> {
    // Check if there's an active debug session
    const activeSession = vscode.debug.activeDebugSession;
    if (!activeSession) {
      throw new Error('No active debug session found');
    }

    // Get debug context (threads, frames, scopes)
    const debugContext = await DAPHelpers.getDebugContext(activeSession);
    if (!debugContext) {
      throw new Error(
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
      throw new Error(`Variable '${variableName}' not found in current scope`);
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

    return expandedData;
  }

  async invoke(
    options: LanguageModelToolInvocationOptions<ExpandVariableToolParameters>
  ): Promise<LanguageModelToolResult> {
    const { variableName } = options.input;

    try {
      const expandedData = await this.expandVariable(variableName);
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
    scopes: Scope[],
    variableName: string
  ): Promise<Variable | null> {
    for (const scope of scopes) {
      let variablesResponse: VariablesResponse;
      try {
        variablesResponse = await session.customRequest('variables', {
          variablesReference: scope.variablesReference,
        });
      } catch {
        continue; // Skip scopes that fail
      }
      if (variablesResponse?.variables) {
        const foundVariable = variablesResponse.variables.find(
          (v: Variable) => (v.evaluateName || v.name) === variableName
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

/**
 * Pure helper to expand a variable within a provided debug session.
 * Enables unit testing without relying on vscode.debug.activeDebugSession.
 */
export async function expandVariableInSession(
  session: vscode.DebugSession,
  variableName: string
): Promise<ExpandedVariableData> {
  const debugContext = await DAPHelpers.getDebugContext(session);
  const foundVariable: FoundVariable | null =
    await DAPHelpers.findVariableInScopes(
      session,
      debugContext.scopes,
      variableName
    );
  if (!foundVariable) {
    throw new Error(`Variable '${variableName}' not found in current scope`);
  }
  const expanded: ExpandedVariableData = {
    variable: foundVariable.variable,
    children: [],
  };
  if (foundVariable.variable.isExpandable) {
    // Retrieve original variable for variablesReference
    let original: Variable | null = null;
    for (const scope of debugContext.scopes) {
      try {
        const vars: VariablesResponse = await session.customRequest(
          'variables',
          {
            variablesReference: scope.variablesReference,
          }
        );
        original =
          (vars.variables.find(
            (v: Variable) => (v.evaluateName || v.name) === variableName
          ) as Variable | undefined) || null;
        if (original) {
          break;
        }
      } catch {
        continue;
      }
    }
    if (original && original.variablesReference > 0) {
      expanded.children = await DAPHelpers.getVariablesFromReference(
        session,
        original.variablesReference
      );
    }
  }
  return expanded;
}
