import { activeSessions } from './common';
import { logger } from './logger';

interface Variable {
  name: string;
  value: string;
  type?: string;
  evaluateName?: string;
  variablesReference: number;
}

interface ScopeVariables {
  scopeName: string;
  variables: Variable[];
  error?: string;
}

interface StackFrameVariablesResult {
  sessionId: string;
  frameId: number;
  threadId: number;
  variablesByScope: ScopeVariables[];
  filter?: string;
  debuggerType: string;
}

/**
 * Get variables from a specific stack frame.
 *
 * @param params - Object containing sessionId, frameId, threadId, and optional filter to get variables from.
 * @param params.sessionId - The ID of the debug session.
 * @param params.frameId - The ID of the stack frame.
 * @param params.threadId - The ID of the thread.
 * @param params.filter - Optional regex pattern to filter variables by name.
 * @param params.retryIfEmpty - Optional flag to retry once without filter if empty.
 */
export const getStackFrameVariables = async (params: {
  sessionId: string;
  frameId: number;
  threadId: number;
  filter?: string;
  retryIfEmpty?: boolean; // optional flag to retry once without filter if empty
}): Promise<StackFrameVariablesResult> => {
  const { sessionId, frameId, threadId, filter, retryIfEmpty } = params;

  // Import the output channel for logging
  logger.debug(
    `Getting variables for session ${sessionId}, frame ${frameId}, thread ${threadId}`
  );

  // Find the session with the given ID
  const session = activeSessions.find(s => s.id === sessionId);
  if (!session) {
    throw new Error(`No debug session found with ID '${sessionId}'`);
  }
  // First, get the scopes for the stack frame
  logger.debug(`Requesting scopes for frameId ${frameId}`);
  const scopes = await session.customRequest('scopes', { frameId });
  logger.trace(`Received scopes: ${JSON.stringify(scopes)}`);

  if (!scopes || !scopes.scopes || !Array.isArray(scopes.scopes)) {
    logger.warn(`Invalid scopes response: ${JSON.stringify(scopes)}`);
    throw new Error(
      `Invalid scopes response from debug adapter. This may be a limitation of the ${session.type} debug adapter.`
    );
  }

  // Then, get variables for each scope
  const variablesByScope = await Promise.all(
    scopes.scopes.map(
      async (scope: { name: string; variablesReference: number }) => {
        logger.trace(
          `Processing scope: ${scope.name}, variablesReference: ${scope.variablesReference}`
        );

        if (scope.variablesReference === 0) {
          logger.debug(
            `Scope ${scope.name} has no variables (variablesReference is 0)`
          );
          return {
            scopeName: scope.name,
            variables: [],
          };
        }

        try {
          logger.trace(
            `Requesting variables for scope ${scope.name} with reference ${scope.variablesReference}`
          );
          const response = await session.customRequest('variables', {
            variablesReference: scope.variablesReference,
          });
          logger.trace(
            `Received variables response: ${JSON.stringify(response)}`
          );

          if (
            !response ||
            !response.variables ||
            !Array.isArray(response.variables)
          ) {
            logger.warn(
              `Invalid variables response for scope ${scope.name}: ${JSON.stringify(response)}`
            );
            return {
              scopeName: scope.name,
              variables: [],
              error: `Invalid variables response from debug adapter for scope ${scope.name}`,
            };
          }

          // Apply filter if provided
          let filteredVariables = response.variables;
          if (filter) {
            const filterRegex = new RegExp(filter, 'i'); // Case insensitive match
            filteredVariables = response.variables.filter(
              (variable: { name: string }) => filterRegex.test(variable.name)
            );
            logger.debug(
              `Applied filter '${filter}', filtered from ${response.variables.length} to ${filteredVariables.length} variables`
            );
          }

          return {
            scopeName: scope.name,
            variables: filteredVariables,
          };
        } catch (scopeError) {
          logger.error(
            `Error getting variables for scope ${scope.name}: ${
              scopeError instanceof Error
                ? scopeError.message
                : String(scopeError)
            }`
          );
          return {
            scopeName: scope.name,
            variables: [],
            error: `Error getting variables: ${
              scopeError instanceof Error
                ? scopeError.message
                : String(scopeError)
            }`,
          };
        }
      }
    )
  );

  // Check if we got any variables at all
  const hasVariables = variablesByScope.some(
    scope =>
      scope.variables &&
      Array.isArray(scope.variables) &&
      scope.variables.length > 0
  );

  if (!hasVariables) {
    logger.info(
      `No variables found in any scope. This may be a limitation of the ${session.type} debug adapter or the current debugging context.`
    );
  }

  // If requested, retry once without filter when nothing captured and filter was present
  const totalVars = variablesByScope.reduce(
    (sum, s: ScopeVariables) =>
      sum + (Array.isArray(s.variables) ? s.variables.length : 0),
    0
  );
  if (retryIfEmpty && filter && totalVars === 0) {
    logger.debug(
      'Retrying variable collection without filter because first attempt returned zero variables.'
    );
    return await getStackFrameVariables({
      sessionId,
      frameId,
      threadId,
      retryIfEmpty: false,
    });
  }

  return {
    sessionId,
    frameId,
    threadId,
    variablesByScope,
    filter: filter || undefined,
    debuggerType: session.type,
  };
};
