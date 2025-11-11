'use strict';
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === 'object') || typeof from === 'function') {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (
  (target = mod != null ? __create(__getProtoOf(mod)) : {}),
  __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule
      ? __defProp(target, 'default', { value: mod, enumerable: true })
      : target,
    mod
  )
);
var __toCommonJS = mod =>
  __copyProps(__defProp({}, '__esModule', { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate,
});
module.exports = __toCommonJS(extension_exports);
var vscode8 = __toESM(require('vscode'));

// src/evaluateExpressionTool.ts
var vscode2 = __toESM(require('vscode'));
var import_vscode2 = require('vscode');

// src/common.ts
var vscode = __toESM(require('vscode'));
var outputChannel = vscode.window.createOutputChannel('Debug Tools');
var sessionStartEventEmitter = new vscode.EventEmitter();
var onSessionStart = sessionStartEventEmitter.event;
var activeSessions = [];
var sessionTerminateEventEmitter = new vscode.EventEmitter();
var onSessionTerminate = sessionTerminateEventEmitter.event;
var getCallStack = async params => {
  const { sessionName } = params;
  let sessions = activeSessions;
  if (sessionName) {
    sessions = activeSessions.filter(session => session.name === sessionName);
    if (sessions.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No debug session found with name '${sessionName}'.`,
          },
        ],
        isError: true,
      };
    }
  }
  if (sessions.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No active debug sessions found.',
        },
      ],
      isError: true,
    };
  }
  try {
    const callStacks = await Promise.all(
      sessions.map(async session => {
        try {
          const threads = await session.customRequest('threads');
          const stackTraces = await Promise.all(
            threads.threads.map(async thread => {
              try {
                const stackTrace = await session.customRequest('stackTrace', {
                  threadId: thread.id,
                });
                return {
                  threadId: thread.id,
                  threadName: thread.name,
                  stackFrames: stackTrace.stackFrames.map(frame => ({
                    id: frame.id,
                    name: frame.name,
                    source: frame.source
                      ? {
                          name: frame.source.name,
                          path: frame.source.path,
                        }
                      : void 0,
                    line: frame.line,
                    column: frame.column,
                  })),
                };
              } catch (error) {
                return {
                  threadId: thread.id,
                  threadName: thread.name,
                  error: error instanceof Error ? error.message : String(error),
                };
              }
            })
          );
          return {
            sessionId: session.id,
            sessionName: session.name,
            threads: stackTraces,
          };
        } catch (error) {
          return {
            sessionId: session.id,
            sessionName: session.name,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );
    return {
      content: [
        {
          type: 'json',
          json: { callStacks },
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting call stack: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
};
vscode.debug.onDidStartDebugSession(session => {
  activeSessions.push(session);
  outputChannel.appendLine(
    `Debug session started: ${session.name} (ID: ${session.id})`
  );
  outputChannel.appendLine(`Active sessions: ${activeSessions.length}`);
  sessionStartEventEmitter.fire(session);
});
vscode.debug.onDidTerminateDebugSession(session => {
  const index = activeSessions.indexOf(session);
  if (index >= 0) {
    activeSessions.splice(index, 1);
    outputChannel.appendLine(
      `Debug session terminated: ${session.name} (ID: ${session.id})`
    );
    outputChannel.appendLine(`Active sessions: ${activeSessions.length}`);
    sessionTerminateEventEmitter.fire({
      sessionId: session.id,
      sessionName: session.name,
    });
  }
});
vscode.debug.onDidChangeActiveDebugSession(session => {
  outputChannel.appendLine(
    `Active debug session changed: ${session ? session.name : 'None'}`
  );
});

// src/debugUtils.ts
var import_vscode = require('vscode');
var DAPHelpers = class {
  static async getDebugContext(session) {
    try {
      const threadsResponse = await session.customRequest('threads');
      if (!threadsResponse.threads || threadsResponse.threads.length === 0) {
        return null;
      }
      const firstThread = threadsResponse.threads[0];
      const stackTraceResponse = await session.customRequest('stackTrace', {
        threadId: firstThread.id,
      });
      if (
        !stackTraceResponse.stackFrames ||
        stackTraceResponse.stackFrames.length === 0
      ) {
        return null;
      }
      const topFrame = stackTraceResponse.stackFrames[0];
      const scopesResponse = await session.customRequest('scopes', {
        frameId: topFrame.id,
      });
      if (!scopesResponse.scopes || scopesResponse.scopes.length === 0) {
        return null;
      }
      return {
        thread: firstThread,
        frame: topFrame,
        scopes: scopesResponse.scopes,
      };
    } catch {
      return null;
    }
  }
  static async getVariablesFromReference(session, variablesReference) {
    let variablesResponse;
    try {
      variablesResponse = await session.customRequest('variables', {
        variablesReference,
      });
    } catch {
      return [];
    }
    if (!variablesResponse?.variables) {
      return [];
    }
    return variablesResponse.variables.map(v => ({
      name: v.evaluateName || v.name,
      value: v.value,
      type: v.type,
      isExpandable: v.variablesReference > 0,
    }));
  }
  static async findVariableInScopes(session, scopes, variableName) {
    for (const scope of scopes) {
      const variables = await this.getVariablesFromReference(
        session,
        scope.variablesReference
      );
      const foundVariable = variables.find(v => v.name === variableName);
      if (foundVariable) {
        return { variable: foundVariable, scopeName: scope.name };
      }
    }
    return null;
  }
  static createSuccessResult(message) {
    const textPart = new import_vscode.LanguageModelTextPart(message);
    return new import_vscode.LanguageModelToolResult([textPart]);
  }
  static createErrorResult(message) {
    const textPart = new import_vscode.LanguageModelTextPart(
      `Error: ${message}`
    );
    return new import_vscode.LanguageModelToolResult([textPart]);
  }
};

// src/evaluateExpressionTool.ts
var EvaluateExpressionTool = class {
  async invoke(options) {
    const { expression, sessionId } = options.input;
    try {
      let session;
      if (sessionId) {
        session = activeSessions.find(s => s.id === sessionId);
      }
      if (!session) {
        session = vscode2.debug.activeDebugSession || activeSessions[0];
      }
      if (!session) {
        return new import_vscode2.LanguageModelToolResult([
          new import_vscode2.LanguageModelTextPart(
            'Error: No active debug session found to evaluate expression.'
          ),
        ]);
      }
      const debugContext = await DAPHelpers.getDebugContext(session);
      const evalArgs = { expression, context: 'watch' };
      if (debugContext?.frame?.id !== void 0) {
        evalArgs.frameId = debugContext.frame.id;
      }
      outputChannel.appendLine(
        `EvaluateExpressionTool: evaluating '${expression}' in session '${session.name}'.`
      );
      let evalResponse;
      try {
        evalResponse = await session.customRequest('evaluate', evalArgs);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : JSON.stringify(err);
        return new import_vscode2.LanguageModelToolResult([
          new import_vscode2.LanguageModelTextPart(
            `Error evaluating expression '${expression}': ${message}`
          ),
        ]);
      }
      const resultJson = {
        expression,
        result: evalResponse?.result,
        type: evalResponse?.type,
        presentationHint: evalResponse?.presentationHint,
        variablesReference: evalResponse?.variablesReference,
      };
      return new import_vscode2.LanguageModelToolResult([
        new import_vscode2.LanguageModelTextPart(JSON.stringify(resultJson)),
      ]);
    } catch (error) {
      return new import_vscode2.LanguageModelToolResult([
        new import_vscode2.LanguageModelTextPart(
          `Unexpected error evaluating expression: ${error instanceof Error ? error.message : String(error)}`
        ),
      ]);
    }
  }
  prepareInvocation(options) {
    return {
      invocationMessage: `Evaluating expression '${options.input.expression}' in debug session`,
    };
  }
};

// src/expandVariableTool.ts
var vscode3 = __toESM(require('vscode'));
var ExpandVariableTool = class {
  /**
   * Expand a variable and get its children as structured data.
   * @param variableName The name of the variable to expand
   * @returns ExpandedVariableData object or throws an error
   */
  async expandVariable(variableName) {
    const activeSession = vscode3.debug.activeDebugSession;
    if (!activeSession) {
      throw new Error('No active debug session found');
    }
    const debugContext = await DAPHelpers.getDebugContext(activeSession);
    if (!debugContext) {
      throw new Error(
        'Unable to get debug context (threads, frames, or scopes)'
      );
    }
    const foundVariable = await DAPHelpers.findVariableInScopes(
      activeSession,
      debugContext.scopes,
      variableName
    );
    if (!foundVariable) {
      throw new Error(`Variable '${variableName}' not found in current scope`);
    }
    const expandedData = {
      variable: foundVariable.variable,
      children: [],
    };
    if (foundVariable.variable.isExpandable) {
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
  async invoke(options) {
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
  async getOriginalVariable(session, scopes, variableName) {
    for (const scope of scopes) {
      let variablesResponse;
      try {
        variablesResponse = await session.customRequest('variables', {
          variablesReference: scope.variablesReference,
        });
      } catch {
        continue;
      }
      if (variablesResponse?.variables) {
        const foundVariable = variablesResponse.variables.find(
          v => (v.evaluateName || v.name) === variableName
        );
        if (foundVariable) {
          return foundVariable;
        }
      }
    }
    return null;
  }
  prepareInvocation(options) {
    return {
      invocationMessage: `Expanding variable '${options.input.variableName}'`,
    };
  }
};

// src/getVariablesTool.ts
var vscode4 = __toESM(require('vscode'));
var GetVariablesTool = class {
  /**
   * Get all variables from the active debug session as structured data.
   * @returns VariablesData object or throws an error
   */
  async getVariables() {
    const activeSession = vscode4.debug.activeDebugSession;
    if (!activeSession) {
      throw new Error('No active debug session found');
    }
    const debugContext = await DAPHelpers.getDebugContext(activeSession);
    if (!debugContext) {
      throw new Error(
        'Unable to get debug context (threads, frames, or scopes)'
      );
    }
    const variablesData = {
      type: 'variables',
      sessionId: activeSession.id,
      scopes: [],
    };
    for (const scope of debugContext.scopes) {
      const variables = await DAPHelpers.getVariablesFromReference(
        activeSession,
        scope.variablesReference
      );
      if (variables.length > 0) {
        variablesData.scopes.push({ name: scope.name, variables });
      }
    }
    if (variablesData.scopes.length === 0) {
      throw new Error('No variables found in current scope');
    }
    return variablesData;
  }
  async invoke(_options) {
    try {
      const variablesData = await this.getVariables();
      const serialized = JSON.stringify(variablesData, null, 2);
      return DAPHelpers.createSuccessResult(serialized);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      return DAPHelpers.createErrorResult(
        `Failed to get variables: ${errorMessage}`
      );
    }
  }
  prepareInvocation(_options) {
    return {
      invocationMessage: 'Getting all variables from debug session',
    };
  }
};

// src/resumeDebugSessionTool.ts
var import_vscode3 = require('vscode');

// src/session.ts
var vscode6 = __toESM(require('vscode'));

// src/events.ts
var vscode5 = __toESM(require('vscode'));
var breakpointEventEmitter = new vscode5.EventEmitter();
var onBreakpointHit = breakpointEventEmitter.event;
vscode5.debug.registerDebugAdapterTrackerFactory('*', {
  createDebugAdapterTracker: session => {
    class DebugAdapterTrackerImpl {
      onWillStartSession() {
        outputChannel.appendLine(`Debug session starting: ${session.name}`);
      }
      onWillReceiveMessage(message) {
        outputChannel.appendLine(
          `Message received by debug adapter: ${JSON.stringify(message)}`
        );
      }
      async onDidSendMessage(message) {
        if (message.type === 'event') {
          const event = message;
          if (event.event === 'stopped') {
            const body = event.body;
            const validReasons = [
              'breakpoint',
              'step',
              'pause',
              'exception',
              'assertion',
              'entry',
            ];
            if (validReasons.includes(body.reason)) {
              try {
                let exceptionDetails;
                if (body.reason === 'exception' && body.description) {
                  exceptionDetails = {
                    description: body.description || 'Unknown exception',
                    details: body.text || 'No additional details available',
                  };
                }
                let callStackResult;
                let threadData;
                const retries = 3;
                for (let attempt = 0; attempt < retries; attempt++) {
                  if (attempt > 0) {
                    await new Promise(resolve =>
                      setTimeout(resolve, 50 * attempt)
                    );
                  }
                  callStackResult = await getCallStack({
                    sessionName: session.name,
                  });
                  if (callStackResult.isError) {
                    const errorText =
                      'text' in callStackResult.content[0]
                        ? callStackResult.content[0].text
                        : 'Unknown error';
                    throw new Error(`Failed to get call stack: ${errorText}`);
                  }
                  if (!('json' in callStackResult.content[0])) {
                    throw new Error(
                      'Call stack result does not contain JSON content'
                    );
                  }
                  const callStackData =
                    callStackResult.content[0].json?.callStacks[0];
                  if (!callStackData || !('threads' in callStackData)) {
                    throw new Error(
                      `Call stack data missing threads: ${JSON.stringify(callStackData)}`
                    );
                  }
                  if (!Array.isArray(callStackData.threads)) {
                    throw new TypeError(
                      `Call stack threads is not an array: ${typeof callStackData.threads}`
                    );
                  }
                  threadData = callStackData.threads.find(
                    t => t.threadId === body.threadId
                  );
                  if (!threadData) {
                    throw new Error(
                      `Thread ${body.threadId} not found in call stack. Available threads: ${callStackData.threads.map(t => t.threadId).join(', ')}`
                    );
                  }
                  if (
                    threadData.stackFrames &&
                    threadData.stackFrames.length > 0
                  ) {
                    break;
                  }
                  if (attempt === retries - 1) {
                    throw new Error(
                      `Thread ${body.threadId} has no stack frames after ${retries} attempts`
                    );
                  }
                }
                const topFrame = threadData.stackFrames[0];
                if (!topFrame.source?.path) {
                  throw new Error(
                    `Top stack frame missing source path: ${JSON.stringify(topFrame)}`
                  );
                }
                const eventData = {
                  sessionId: session.id,
                  sessionName: session.name,
                  threadId: body.threadId,
                  reason: body.reason,
                  frameId: topFrame.id,
                  filePath: topFrame.source.path,
                  line: topFrame.line,
                  exceptionInfo: exceptionDetails,
                };
                outputChannel.appendLine(
                  `Firing breakpoint event: ${JSON.stringify(eventData)}`
                );
                breakpointEventEmitter.fire(eventData);
              } catch (error) {
                console.error('Error processing debug event:', error);
                const exceptionDetails =
                  body.reason === 'exception'
                    ? {
                        description: body.description || 'Unknown exception',
                        details: body.text || 'No details available',
                      }
                    : void 0;
                breakpointEventEmitter.fire({
                  sessionId: session.id,
                  sessionName: session.name,
                  threadId: body.threadId,
                  reason: body.reason,
                  exceptionInfo: exceptionDetails,
                });
              }
            }
          }
        }
        outputChannel.appendLine(
          `Message from debug adapter: ${JSON.stringify(message)}`
        );
      }
      onWillSendMessage(message) {
        outputChannel.appendLine(
          `Message sent to debug adapter: ${JSON.stringify(message)}`
        );
      }
      onDidReceiveMessage(message) {
        outputChannel.appendLine(
          `Message received from debug adapter: ${JSON.stringify(message)}`
        );
      }
      onError(error) {
        outputChannel.appendLine(`Debug adapter error: ${error.message}`);
      }
      onExit(code, signal) {
        outputChannel.appendLine(
          `Debug adapter exited: code=${code}, signal=${signal}`
        );
      }
    }
    return new DebugAdapterTrackerImpl();
  },
});
var waitForBreakpointHit = async params => {
  const { sessionName, timeout = 3e4, includeTermination = true } = params;
  try {
    const breakpointHitPromise = new Promise((resolve, reject) => {
      let terminateListener;
      const listener = onBreakpointHit(event => {
        outputChannel.appendLine(
          `Breakpoint hit detected for waitForBreakpointHit for session ${event.sessionName} with id ${event.sessionName}`
        );
        let targetSession;
        const currentSessions = activeSessions;
        const session = currentSessions.find(
          s =>
            s.id === sessionName ||
            s.name === sessionName ||
            (s.configuration && s.configuration.sessionName === sessionName)
        );
        if (session) {
          targetSession = session;
        }
        if (!sessionName && !targetSession && currentSessions.length > 0) {
          targetSession = currentSessions[currentSessions.length - 1];
          outputChannel.appendLine(
            `Using most recent session for matching: ${targetSession.name} (${targetSession.id})`
          );
        }
        const eventMatchesTarget =
          targetSession !== void 0 &&
          (event.sessionName === targetSession.id ||
            event.sessionName === targetSession.name ||
            event.sessionName.startsWith(targetSession.name) ||
            targetSession.name.startsWith(event.sessionName));
        if (eventMatchesTarget) {
          listener.dispose();
          terminateListener?.dispose();
          resolve(event);
          outputChannel.appendLine(
            `Breakpoint hit detected for waitForBreakpointHit: ${JSON.stringify(event)}`
          );
        }
      });
      if (includeTermination) {
        terminateListener = onSessionTerminate(endEvent => {
          const matches = sessionName
            ? endEvent.sessionName === sessionName
            : true;
          if (matches) {
            outputChannel.appendLine(
              `Session termination detected for waitForBreakpointHit: ${JSON.stringify(endEvent)}`
            );
            listener.dispose();
            terminateListener?.dispose();
            resolve({
              sessionId: endEvent.sessionId,
              sessionName: endEvent.sessionName,
              threadId: 0,
              reason: 'terminated',
            });
          }
        });
      }
      setTimeout(() => {
        listener.dispose();
        terminateListener?.dispose();
        reject(
          new Error(
            `Timed out waiting for breakpoint or termination (${timeout}ms).`
          )
        );
      }, timeout);
    });
    const result = await breakpointHitPromise;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result),
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error waiting for breakpoint: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
};

// src/inspection.ts
var getStackFrameVariables = async params => {
  const { sessionId, frameId, threadId, filter, retryIfEmpty } = params;
  outputChannel.appendLine(
    `Getting variables for session ${sessionId}, frame ${frameId}, thread ${threadId}`
  );
  const session = activeSessions.find(s => s.id === sessionId);
  if (!session) {
    outputChannel.appendLine(`No debug session found with ID '${sessionId}'`);
    return {
      content: [
        {
          type: 'text',
          text: `No debug session found with ID '${sessionId}'.`,
        },
      ],
      isError: true,
    };
  }
  try {
    outputChannel.appendLine(`Requesting scopes for frameId ${frameId}`);
    const scopes = await session.customRequest('scopes', { frameId });
    outputChannel.appendLine(`Received scopes: ${JSON.stringify(scopes)}`);
    if (!scopes || !scopes.scopes || !Array.isArray(scopes.scopes)) {
      outputChannel.appendLine(
        `Invalid scopes response: ${JSON.stringify(scopes)}`
      );
      return {
        content: [
          {
            type: 'text',
            text: `Invalid scopes response from debug adapter. This may be a limitation of the ${session.type} debug adapter.`,
          },
        ],
        isError: true,
      };
    }
    const variablesByScope = await Promise.all(
      scopes.scopes.map(async scope => {
        outputChannel.appendLine(
          `Processing scope: ${scope.name}, variablesReference: ${scope.variablesReference}`
        );
        if (scope.variablesReference === 0) {
          outputChannel.appendLine(
            `Scope ${scope.name} has no variables (variablesReference is 0)`
          );
          return {
            scopeName: scope.name,
            variables: [],
          };
        }
        try {
          outputChannel.appendLine(
            `Requesting variables for scope ${scope.name} with reference ${scope.variablesReference}`
          );
          const response = await session.customRequest('variables', {
            variablesReference: scope.variablesReference,
          });
          outputChannel.appendLine(
            `Received variables response: ${JSON.stringify(response)}`
          );
          if (
            !response ||
            !response.variables ||
            !Array.isArray(response.variables)
          ) {
            outputChannel.appendLine(
              `Invalid variables response for scope ${scope.name}: ${JSON.stringify(response)}`
            );
            return {
              scopeName: scope.name,
              variables: [],
              error: `Invalid variables response from debug adapter for scope ${scope.name}`,
            };
          }
          let filteredVariables = response.variables;
          if (filter) {
            const filterRegex = new RegExp(filter, 'i');
            filteredVariables = response.variables.filter(variable =>
              filterRegex.test(variable.name)
            );
            outputChannel.appendLine(
              `Applied filter '${filter}', filtered from ${response.variables.length} to ${filteredVariables.length} variables`
            );
          }
          return {
            scopeName: scope.name,
            variables: filteredVariables,
          };
        } catch (scopeError) {
          outputChannel.appendLine(
            `Error getting variables for scope ${scope.name}: ${scopeError instanceof Error ? scopeError.message : String(scopeError)}`
          );
          return {
            scopeName: scope.name,
            variables: [],
            error: `Error getting variables: ${scopeError instanceof Error ? scopeError.message : String(scopeError)}`,
          };
        }
      })
    );
    const hasVariables = variablesByScope.some(
      scope =>
        scope.variables &&
        Array.isArray(scope.variables) &&
        scope.variables.length > 0
    );
    if (!hasVariables) {
      outputChannel.appendLine(
        `No variables found in any scope. This may be a limitation of the ${session.type} debug adapter or the current debugging context.`
      );
    }
    const totalVars = variablesByScope.reduce(
      (sum, s) => sum + (Array.isArray(s.variables) ? s.variables.length : 0),
      0
    );
    if (retryIfEmpty && filter && totalVars === 0) {
      outputChannel.appendLine(
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
      content: [
        {
          type: 'json',
          json: {
            sessionId,
            frameId,
            threadId,
            variablesByScope,
            filter: filter || void 0,
            debuggerType: session.type,
          },
        },
      ],
      isError: false,
    };
  } catch (error) {
    outputChannel.appendLine(
      `Error in getStackFrameVariables: ${error instanceof Error ? error.message : String(error)}`
    );
    outputChannel.appendLine(
      `Error stack: ${error instanceof Error ? error.stack : 'No stack available'}`
    );
    return {
      content: [
        {
          type: 'text',
          text: `Error getting variables: ${error instanceof Error ? error.message : String(error)}. This may be a limitation of the ${session.type} debug adapter.`,
        },
      ],
      isError: true,
    };
  }
};

// src/session.ts
async function resolveBreakpointInfo(breakpointInfo, variableFilter) {
  try {
    const callStackResult = await getCallStack({
      sessionName: breakpointInfo.sessionName,
    });
    let callStackData = null;
    if (!callStackResult.isError && 'json' in callStackResult.content[0]) {
      callStackData = callStackResult.content[0].json;
    }
    let variablesData = null;
    let variablesError = null;
    if (
      breakpointInfo.frameId !== void 0 &&
      breakpointInfo.sessionId &&
      breakpointInfo.threadId !== void 0
    ) {
      outputChannel.appendLine(
        `Attempting to get variables for frameId ${breakpointInfo.frameId}`
      );
      const activeSession = activeSessions.find(
        s => s.name === breakpointInfo.sessionName
      );
      if (!activeSession) {
        variablesError = `Could not find active session with name: ${breakpointInfo.sessionName}`;
        outputChannel.appendLine(variablesError);
      } else {
        try {
          const variablesResult = await getStackFrameVariables({
            sessionId: activeSession.id,
            frameId: breakpointInfo.frameId,
            threadId: breakpointInfo.threadId,
            filter: variableFilter ? variableFilter.join('|') : void 0,
          });
          if (
            !variablesResult.isError &&
            'json' in variablesResult.content[0]
          ) {
            const variablesJson = variablesResult.content[0].json;
            variablesData = variablesJson.variablesByScope;
            outputChannel.appendLine(
              `Successfully retrieved variables: ${JSON.stringify(variablesData)}`
            );
          } else {
            variablesError = variablesResult.isError
              ? 'text' in variablesResult.content[0]
                ? variablesResult.content[0].text
                : 'Unknown error'
              : 'Invalid response format';
            outputChannel.appendLine(
              `Failed to get variables: ${variablesError}`
            );
          }
        } catch (error) {
          variablesError =
            error instanceof Error ? error.message : String(error);
          outputChannel.appendLine(
            `Exception getting variables: ${variablesError}`
          );
        }
      }
    } else {
      variablesError = 'Missing required information for variable inspection';
      outputChannel.appendLine(
        `Cannot get variables: ${variablesError} - frameId: ${breakpointInfo.frameId}, sessionId: ${breakpointInfo.sessionId}, threadId: ${breakpointInfo.threadId}`
      );
    }
    const debugInfo = {
      breakpoint: breakpointInfo,
      callStack: callStackData,
      variables: variablesData,
      variablesError,
    };
    return {
      content: [
        {
          type: 'text',
          text: `Debug session ${breakpointInfo.sessionName} stopped at ${breakpointInfo.reason === 'breakpoint' ? 'a breakpoint' : `due to ${breakpointInfo.reason}`}.`,
        },
        {
          type: 'json',
          json: debugInfo,
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Debug session ${breakpointInfo.sessionName} stopped successfully.`,
        },
        {
          type: 'text',
          text: `Warning: Failed to wait for debug session to stop: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: false,
    };
  }
}
var startDebuggingAndWaitForStop = async params => {
  const {
    sessionName,
    workspaceFolder,
    nameOrConfiguration,
    variableFilter,
    timeoutSeconds = 60,
    breakpointConfig,
  } = params;
  const workspaceFolders = vscode6.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('No workspace folders are currently open.');
  }
  outputChannel.appendLine(
    `Available workspace folders: ${workspaceFolders.map(f => `${f.name} -> ${f.uri.fsPath}`).join(', ')}`
  );
  outputChannel.appendLine(`Looking for workspace folder: ${workspaceFolder}`);
  let folder = workspaceFolders.find(f => f.uri?.fsPath === workspaceFolder);
  if (!folder) {
    const childOfRequested = workspaceFolders.find(
      f =>
        f.uri.fsPath.startsWith(`${workspaceFolder}/`) ||
        f.uri.fsPath.startsWith(`${workspaceFolder}\\`)
    );
    if (childOfRequested) {
      folder = childOfRequested;
      outputChannel.appendLine(
        `Requested parent folder '${workspaceFolder}' not open; using child workspace folder '${folder.uri.fsPath}'.`
      );
    }
  }
  if (!folder) {
    const parentOfRequested = workspaceFolders.find(
      f =>
        workspaceFolder.startsWith(`${f.uri.fsPath}/`) ||
        workspaceFolder.startsWith(`${f.uri.fsPath}\\`)
    );
    if (parentOfRequested) {
      folder = parentOfRequested;
      outputChannel.appendLine(
        `Requested subfolder '${workspaceFolder}' not open; using parent workspace folder '${folder.uri.fsPath}'.`
      );
    }
  }
  if (!folder) {
    throw new Error(
      `Workspace folder '${workspaceFolder}' not found. Available folders: ${workspaceFolders.map(f => f.uri.fsPath).join(', ')}`
    );
  }
  if (breakpointConfig.disableExisting) {
    const allBreakpoints = vscode6.debug.breakpoints;
    if (allBreakpoints.length > 0) {
      vscode6.debug.removeBreakpoints(allBreakpoints);
    }
  }
  const seen = /* @__PURE__ */ new Set();
  const validated = [];
  for (const bp of breakpointConfig.breakpoints) {
    const absolutePath = bp.path.startsWith('/')
      ? bp.path
      : `${workspaceFolder}/${bp.path}`;
    try {
      const doc = await vscode6.workspace.openTextDocument(
        vscode6.Uri.file(absolutePath)
      );
      const lineCount = doc.lineCount;
      if (bp.line < 1 || bp.line > lineCount) {
        outputChannel.appendLine(
          `Skipping breakpoint ${absolutePath}:${bp.line} (out of range, file has ${lineCount} lines).`
        );
        continue;
      }
      const key = `${absolutePath}:${bp.line}`;
      if (seen.has(key)) {
        outputChannel.appendLine(`Skipping duplicate breakpoint ${key}.`);
        continue;
      }
      seen.add(key);
      const uri = vscode6.Uri.file(absolutePath);
      const location = new vscode6.Position(bp.line - 1, 0);
      validated.push(
        new vscode6.SourceBreakpoint(
          new vscode6.Location(uri, location),
          true,
          bp.condition,
          bp.hitCondition,
          bp.logMessage
        )
      );
    } catch (e) {
      outputChannel.appendLine(
        `Failed to open file for breakpoint path ${absolutePath}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  if (validated.length) {
    vscode6.debug.addBreakpoints(validated);
    outputChannel.appendLine(
      `Added ${validated.length} validated breakpoint(s).`
    );
    await new Promise(resolve => setTimeout(resolve, 300));
  } else {
    outputChannel.appendLine('No valid breakpoints to add after validation.');
  }
  let resolvedConfig;
  const launchConfig = vscode6.workspace.getConfiguration('launch', folder.uri);
  const allConfigs = launchConfig.get('configurations') || [];
  const found = allConfigs.find(c => c.name === nameOrConfiguration);
  if (!found) {
    throw new Error(
      `Launch configuration '${nameOrConfiguration}' not found in ${folder.uri.fsPath}. Add it to .vscode/launch.json.`
    );
  }
  resolvedConfig = { ...found };
  if (!('stopOnEntry' in resolvedConfig)) {
    resolvedConfig.stopOnEntry = true;
  } else {
    resolvedConfig.stopOnEntry = true;
  }
  const effectiveSessionName = sessionName || resolvedConfig.name || '';
  outputChannel.appendLine(
    `Starting debugger with configuration '${resolvedConfig.name}' (stopOnEntry forced to true). Waiting for first stop event.`
  );
  const stopPromise = waitForBreakpointHit({
    sessionName: effectiveSessionName,
    timeout: timeoutSeconds * 1e3,
  });
  const success = await vscode6.debug.startDebugging(folder, resolvedConfig);
  if (!success) {
    throw new Error(`Failed to start debug session '${effectiveSessionName}'.`);
  }
  let remainingMs = timeoutSeconds * 1e3;
  const t0 = Date.now();
  let firstStop = await stopPromise;
  const elapsed = Date.now() - t0;
  remainingMs = Math.max(0, remainingMs - elapsed);
  if (
    !firstStop.isError &&
    firstStop.content[0].type === 'text' &&
    /"reason":"entry"/.test(firstStop.content[0].text) &&
    validated.length > 0 &&
    remainingMs > 0
  ) {
    outputChannel.appendLine(
      'Initial stop reason was entry; continuing to wait for breakpoint hit.'
    );
    const active =
      activeSessions.find(s => s.name === effectiveSessionName) ||
      activeSessions.at(-1);
    if (active) {
      try {
        await active.customRequest('continue', { threadId: 0 });
        firstStop = await waitForBreakpointHit({
          sessionName: effectiveSessionName,
          timeout: remainingMs,
        });
      } catch (contErr) {
        outputChannel.appendLine(
          `Failed to continue after entry: ${contErr instanceof Error ? contErr.message : String(contErr)}`
        );
      }
    }
  }
  if (!success) {
    throw new Error(`Failed to start debug session '${sessionName}'.`);
  }
  outputChannel.appendLine(
    `Active sessions after start: ${activeSessions.map(s => `${s.name}:${s.id}`).join(', ')}`
  );
  let breakpointHitResult = firstStop;
  if (
    !breakpointHitResult.isError &&
    breakpointHitResult.content[0].type === 'text'
  ) {
    try {
      const breakpointInfo = JSON.parse(breakpointHitResult.content[0].text);
      return await resolveBreakpointInfo(breakpointInfo, variableFilter);
    } catch (_parseErr) {
      outputChannel.appendLine(
        `Failed to parse breakpoint hit result JSON; returning raw result. (${_parseErr instanceof Error ? _parseErr.message : 'unknown'})`
      );
      return breakpointHitResult;
    }
  }
  return breakpointHitResult;
};
var stopDebugSession = async params => {
  const { sessionName } = params;
  const matchingSessions = activeSessions.filter(
    session => session.name === sessionName
  );
  if (matchingSessions.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No debug session(s) found with name '${sessionName}'.`,
        },
      ],
      isError: true,
    };
  }
  for (const session of matchingSessions) {
    await vscode6.debug.stopDebugging(session);
  }
  return {
    content: [
      {
        type: 'text',
        text: `Stopped debug session(s) with name '${sessionName}'.`,
      },
    ],
    isError: false,
  };
};
var resumeDebugSession = async params => {
  const { sessionId, waitForStop = false, breakpointConfig } = params;
  let session = activeSessions.find(s => s.id === sessionId);
  if (!session) {
    session = activeSessions.find(s => s.name.includes(sessionId));
  }
  if (!session) {
    return {
      content: [
        {
          type: 'text',
          text: `No debug session found with ID '${sessionId}'.`,
        },
      ],
      isError: true,
    };
  }
  try {
    if (breakpointConfig) {
      if (breakpointConfig.disableExisting) {
        const allBreakpoints = vscode6.debug.breakpoints;
        if (allBreakpoints.length > 0) {
          vscode6.debug.removeBreakpoints(allBreakpoints);
        }
      }
      if (
        breakpointConfig.breakpoints &&
        breakpointConfig.breakpoints.length > 0
      ) {
        const workspaceFolder =
          session.workspaceFolder?.uri.fsPath ||
          vscode6.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceFolder) {
          throw new Error(
            'Cannot determine workspace folder for breakpoint paths'
          );
        }
        const newBreakpoints = breakpointConfig.breakpoints.map(bp => {
          const uri = vscode6.Uri.file(
            bp.path.startsWith('/') ? bp.path : `${workspaceFolder}/${bp.path}`
          );
          const location = new vscode6.Position(bp.line - 1, 0);
          return new vscode6.SourceBreakpoint(
            new vscode6.Location(uri, location),
            true,
            // enabled
            bp.condition,
            bp.hitCondition,
            bp.logMessage
          );
        });
        vscode6.debug.addBreakpoints(newBreakpoints);
      }
    }
    outputChannel.appendLine(
      `Resuming debug session '${session.name}' (ID: ${sessionId})`
    );
    const stopPromise = waitForBreakpointHit({
      sessionName: session.name,
      includeTermination: true,
    });
    await session.customRequest('continue', { threadId: 0 });
    if (waitForStop) {
      const stopResult = await stopPromise;
      if (!stopResult.isError && stopResult.content[0].type === 'text') {
        try {
          const info = JSON.parse(stopResult.content[0].text);
          if (info.reason === 'terminated') {
            return {
              content: [
                {
                  type: 'text',
                  text: `Debug session '${session.name}' terminated before hitting another breakpoint.`,
                },
                { type: 'text', text: JSON.stringify(info) },
              ],
              isError: false,
            };
          }
          return await resolveBreakpointInfo(info);
        } catch (_resumeParseErr) {
          outputChannel.appendLine(
            `Failed to parse stopResult JSON after resume; returning raw event. (${_resumeParseErr instanceof Error ? _resumeParseErr.message : 'unknown'})`
          );
          return stopResult;
        }
      }
      return stopResult;
    }
    return {
      content: [
        {
          type: 'text',
          text: `Resumed debug session '${session.name}'.`,
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error resuming debug session: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
};

// src/resumeDebugSessionTool.ts
var ResumeDebugSessionTool = class {
  async invoke(options) {
    const { sessionId, waitForStop, breakpointConfig } = options.input;
    try {
      const rawResult = await resumeDebugSession({
        sessionId,
        waitForStop,
        breakpointConfig,
      });
      const parts = rawResult.content.map(item => {
        if (item.type === 'json' && 'json' in item) {
          return new import_vscode3.LanguageModelTextPart(
            JSON.stringify(item.json)
          );
        }
        const textValue =
          'text' in item && item.text ? item.text : JSON.stringify(item);
        return new import_vscode3.LanguageModelTextPart(textValue);
      });
      return new import_vscode3.LanguageModelToolResult(parts);
    } catch (error) {
      return new import_vscode3.LanguageModelToolResult([
        new import_vscode3.LanguageModelTextPart(
          `Error resuming debug session: ${error instanceof Error ? error.message : String(error)}`
        ),
      ]);
    }
  }
  prepareInvocation(options) {
    return {
      invocationMessage: `Resuming debug session '${options.input.sessionId}'${options.input.waitForStop ? ' and waiting for breakpoint' : ''}`,
    };
  }
};

// src/startDebuggerTool.ts
var vscode7 = __toESM(require('vscode'));
var import_vscode4 = require('vscode');
var StartDebuggerTool = class {
  async invoke(options) {
    const {
      workspaceFolder,
      variableFilter,
      timeoutSeconds,
      configurationName,
      breakpointConfig,
    } = options.input;
    const config = vscode7.workspace.getConfiguration('copilot-debugger');
    const effectiveConfigName =
      configurationName || config.get('defaultLaunchConfiguration');
    if (!effectiveConfigName) {
      return new import_vscode4.LanguageModelToolResult([
        new import_vscode4.LanguageModelTextPart(
          'Error: No launch configuration specified. Set "copilot-debugger.defaultLaunchConfiguration" in settings or provide configurationName parameter.'
        ),
      ]);
    }
    const rawResult = await startDebuggingAndWaitForStop({
      workspaceFolder,
      nameOrConfiguration: effectiveConfigName,
      variableFilter,
      timeoutSeconds,
      breakpointConfig,
      sessionName: '',
      // Empty string means match any session
    });
    const parts = rawResult.content.map(item => {
      if (item.type === 'json' && 'json' in item) {
        return new import_vscode4.LanguageModelTextPart(
          JSON.stringify(item.json, null, 2)
        );
      }
      const textValue =
        'text' in item && item.text ? item.text : JSON.stringify(item);
      return new import_vscode4.LanguageModelTextPart(textValue);
    });
    const result = new import_vscode4.LanguageModelToolResult(parts);
    result.__rawResult = rawResult;
    return result;
  }
};

// src/stopDebugSessionTool.ts
var import_vscode5 = require('vscode');
var StopDebugSessionTool = class {
  async invoke(options) {
    const { sessionName } = options.input;
    try {
      const raw = await stopDebugSession({ sessionName });
      const parts = raw.content.map(item => {
        if (item.type === 'json' && 'json' in item) {
          return new import_vscode5.LanguageModelTextPart(
            JSON.stringify(item.json)
          );
        }
        const textValue = 'text' in item ? item.text : JSON.stringify(item);
        return new import_vscode5.LanguageModelTextPart(textValue);
      });
      return new import_vscode5.LanguageModelToolResult(parts);
    } catch (error) {
      return new import_vscode5.LanguageModelToolResult([
        new import_vscode5.LanguageModelTextPart(
          `Error stopping debug session: ${error instanceof Error ? error.message : String(error)}`
        ),
      ]);
    }
  }
  prepareInvocation(options) {
    return {
      invocationMessage: `Stopping debug session(s) named '${options.input.sessionName}'`,
    };
  }
};

// src/extension.ts
function activate(context) {
  registerTools(context);
}
function registerTools(context) {
  context.subscriptions.push(
    vscode8.lm.registerTool(
      'start_debugger_with_breakpoints',
      new StartDebuggerTool()
    ),
    vscode8.lm.registerTool(
      'resume_debug_session',
      new ResumeDebugSessionTool()
    ),
    vscode8.lm.registerTool('get_variables', new GetVariablesTool()),
    vscode8.lm.registerTool('expand_variable', new ExpandVariableTool()),
    vscode8.lm.registerTool(
      'evaluate_expression',
      new EvaluateExpressionTool()
    ),
    vscode8.lm.registerTool('stop_debug_session', new StopDebugSessionTool())
  );
}
function deactivate() {}
// Annotate the CommonJS export names for ESM import in node:
0 &&
  (module.exports = {
    activate,
    deactivate,
  });
//# sourceMappingURL=extension.js.map
