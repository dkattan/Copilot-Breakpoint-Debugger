"use strict";
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
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode8 = __toESM(require("vscode"));

// src/evaluateExpressionTool.ts
var vscode2 = __toESM(require("vscode"));
var import_vscode2 = require("vscode");

// src/common.ts
var vscode = __toESM(require("vscode"));
var outputChannel = vscode.window.createOutputChannel("Debug Tools");
var sessionStartEventEmitter = new vscode.EventEmitter();
var onSessionStart = sessionStartEventEmitter.event;
var activeSessions = [];
var sessionTerminateEventEmitter = new vscode.EventEmitter();
var onSessionTerminate = sessionTerminateEventEmitter.event;
vscode.debug.onDidStartDebugSession((session) => {
  activeSessions.push(session);
  outputChannel.appendLine(
    `Debug session started: ${session.name} (ID: ${session.id})`
  );
  outputChannel.appendLine(`Active sessions: ${activeSessions.length}`);
  sessionStartEventEmitter.fire(session);
});
vscode.debug.onDidTerminateDebugSession((session) => {
  const index = activeSessions.indexOf(session);
  if (index >= 0) {
    activeSessions.splice(index, 1);
    outputChannel.appendLine(
      `Debug session terminated: ${session.name} (ID: ${session.id})`
    );
    outputChannel.appendLine(`Active sessions: ${activeSessions.length}`);
    sessionTerminateEventEmitter.fire({
      session
    });
  }
});
vscode.debug.onDidChangeActiveDebugSession((session) => {
  outputChannel.appendLine(
    `Active debug session changed: ${session ? session.name : "None"}`
  );
});

// src/debugUtils.ts
var import_vscode = require("vscode");
var DAPHelpers = class {
  static async getDebugContext(session, threadId) {
    const { threads } = await session.customRequest("threads");
    if (!threads || threads.length === 0) {
      throw new Error(
        `No threads available in session ${session.id} (${session.name})`
      );
    }
    const effectiveThreadId = typeof threadId === "number" ? threadId : threads[0].id;
    const thread = threads.find(
      (t) => t.id === effectiveThreadId
    );
    if (!thread) {
      throw new Error(
        `Thread with id ${effectiveThreadId} not found in session ${session.id} (${session.name})`
      );
    }
    const stackTraceResponse = await session.customRequest("stackTrace", {
      threadId: thread.id
    });
    if (!stackTraceResponse.stackFrames || stackTraceResponse.stackFrames.length === 0) {
      throw new Error(
        `No stack frames available for thread ${thread.id} in session ${session.id} (${session.name})`
      );
    }
    const topFrame = stackTraceResponse.stackFrames[0];
    const scopesResponse = await session.customRequest("scopes", {
      frameId: topFrame.id
    });
    if (!scopesResponse.scopes || scopesResponse.scopes.length === 0) {
      throw new Error(
        `No scopes available for frame ${topFrame.id} in session ${session.id} (${session.name})`
      );
    }
    return {
      thread,
      frame: topFrame,
      scopes: scopesResponse.scopes
    };
  }
  static async getVariablesFromReference(session, variablesReference) {
    let variablesResponse;
    try {
      variablesResponse = await session.customRequest("variables", {
        variablesReference
      });
    } catch {
      return [];
    }
    if (!variablesResponse?.variables) {
      return [];
    }
    return variablesResponse.variables.map((v) => ({
      name: v.evaluateName || v.name,
      value: v.value,
      type: v.type,
      isExpandable: v.variablesReference > 0
    }));
  }
  static async findVariableInScopes(session, scopes, variableName) {
    for (const scope of scopes) {
      const variables = await this.getVariablesFromReference(
        session,
        scope.variablesReference
      );
      const foundVariable = variables.find((v) => v.name === variableName);
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
    const textPart = new import_vscode.LanguageModelTextPart(`Error: ${message}`);
    return new import_vscode.LanguageModelToolResult([textPart]);
  }
};

// src/evaluateExpressionTool.ts
var EvaluateExpressionTool = class {
  async invoke(options) {
    const { expression, sessionId, threadId } = options.input;
    try {
      let session;
      if (sessionId) {
        session = activeSessions.find((s) => s.id === sessionId);
      }
      if (!session) {
        session = vscode2.debug.activeDebugSession || activeSessions[0];
      }
      if (!session) {
        return new import_vscode2.LanguageModelToolResult([
          new import_vscode2.LanguageModelTextPart(
            "Error: No active debug session found to evaluate expression."
          )
        ]);
      }
      const debugContext = await DAPHelpers.getDebugContext(session, threadId);
      const evalArgs = { expression, context: "watch" };
      if (debugContext?.frame?.id !== void 0) {
        evalArgs.frameId = debugContext.frame.id;
      }
      outputChannel.appendLine(
        `EvaluateExpressionTool: evaluating '${expression}' in session '${session.name}'.`
      );
      let evalResponse;
      try {
        evalResponse = await session.customRequest("evaluate", evalArgs);
      } catch (err) {
        const message = err instanceof Error ? err.message : JSON.stringify(err);
        return new import_vscode2.LanguageModelToolResult([
          new import_vscode2.LanguageModelTextPart(
            `Error evaluating expression '${expression}': ${message}`
          )
        ]);
      }
      const resultJson = {
        expression,
        result: evalResponse?.result,
        type: evalResponse?.type,
        presentationHint: evalResponse?.presentationHint,
        variablesReference: evalResponse?.variablesReference
      };
      return new import_vscode2.LanguageModelToolResult([
        new import_vscode2.LanguageModelTextPart(JSON.stringify(resultJson))
      ]);
    } catch (error) {
      return new import_vscode2.LanguageModelToolResult([
        new import_vscode2.LanguageModelTextPart(
          `Unexpected error evaluating expression: ${error instanceof Error ? error.message : String(error)}`
        )
      ]);
    }
  }
  prepareInvocation(options) {
    return {
      invocationMessage: `Evaluating expression '${options.input.expression}' in debug session`
    };
  }
};

// src/expandVariableTool.ts
var vscode3 = __toESM(require("vscode"));
var ExpandVariableTool = class {
  /**
   * Expand a variable and get its children as structured data.
   * @param variableName The name of the variable to expand
   * @returns ExpandedVariableData object or throws an error
   */
  async expandVariable(variableName) {
    const activeSession = vscode3.debug.activeDebugSession;
    if (!activeSession) {
      throw new Error("No active debug session found");
    }
    const debugContext = await DAPHelpers.getDebugContext(activeSession);
    if (!debugContext) {
      throw new Error(
        "Unable to get debug context (threads, frames, or scopes)"
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
      children: []
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
      const errorMessage = _error instanceof Error ? _error.message : "Unknown error occurred";
      return DAPHelpers.createErrorResult(
        `Failed to expand variable: ${errorMessage}`
      );
    }
  }
  async getOriginalVariable(session, scopes, variableName) {
    for (const scope of scopes) {
      let variablesResponse;
      try {
        variablesResponse = await session.customRequest("variables", {
          variablesReference: scope.variablesReference
        });
      } catch {
        continue;
      }
      if (variablesResponse?.variables) {
        const foundVariable = variablesResponse.variables.find(
          (v) => (v.evaluateName || v.name) === variableName
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
      invocationMessage: `Expanding variable '${options.input.variableName}'`
    };
  }
};

// src/getVariablesTool.ts
var vscode4 = __toESM(require("vscode"));
var GetVariablesTool = class {
  /**
   * Get all variables from the active debug session as structured data.
   * @returns VariablesData object or throws an error
   */
  async getVariables() {
    const activeSession = vscode4.debug.activeDebugSession;
    if (!activeSession) {
      throw new Error("No active debug session found");
    }
    const debugContext = await DAPHelpers.getDebugContext(activeSession);
    if (!debugContext) {
      throw new Error(
        "Unable to get debug context (threads, frames, or scopes)"
      );
    }
    const variablesData = {
      type: "variables",
      sessionId: activeSession.id,
      scopes: []
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
      throw new Error("No variables found in current scope");
    }
    return variablesData;
  }
  async invoke(_options) {
    try {
      const variablesData = await this.getVariables();
      const serialized = JSON.stringify(variablesData, null, 2);
      return DAPHelpers.createSuccessResult(serialized);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      return DAPHelpers.createErrorResult(
        `Failed to get variables: ${errorMessage}`
      );
    }
  }
  prepareInvocation(_options) {
    return {
      invocationMessage: "Getting all variables from debug session"
    };
  }
};

// src/resumeDebugSessionTool.ts
var import_vscode3 = require("vscode");

// src/session.ts
var vscode6 = __toESM(require("vscode"));

// src/events.ts
var vscode5 = __toESM(require("vscode"));
var breakpointEventEmitter = new vscode5.EventEmitter();
var onBreakpointHit = breakpointEventEmitter.event;
vscode5.debug.registerDebugAdapterTrackerFactory("*", {
  createDebugAdapterTracker: (session) => {
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
        if (message.type !== "event") {
          return;
        }
        const event = message;
        if (event.event !== "stopped") {
          return;
        }
        const body = event.body;
        const validReasons = [
          "breakpoint",
          "step",
          "pause",
          "exception",
          "assertion",
          "entry"
        ];
        if (!validReasons.includes(body.reason)) {
          return;
        }
        try {
          let exceptionDetails;
          if (body.reason === "exception" && body.description) {
            exceptionDetails = {
              description: body.description || "Unknown exception",
              details: body.text || "No additional details available"
            };
          }
          const retries = 3;
          let lastError;
          let callStackData;
          for (let attempt = 0; attempt < retries; attempt++) {
            try {
              if (attempt > 0) {
                await new Promise((r) => setTimeout(r, 50 * attempt));
              }
              callStackData = await DAPHelpers.getDebugContext(
                session,
                body.threadId
              );
              if (!callStackData.frame?.source?.path) {
                throw new Error(
                  `Top stack frame missing source path: ${JSON.stringify(callStackData.frame)}`
                );
              }
              break;
            } catch (err) {
              lastError = err;
              outputChannel.appendLine(
                `getDebugContext attempt ${attempt + 1} failed for thread ${body.threadId}: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }
          if (!callStackData) {
            throw new Error(
              `Unable to retrieve call stack after ${retries} attempts for thread ${body.threadId}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
            );
          }
          const eventData = {
            session,
            threadId: body.threadId,
            reason: body.reason,
            frameId: callStackData.frame.id,
            filePath: callStackData.frame.source?.path,
            line: callStackData.frame.line,
            exceptionInfo: exceptionDetails
          };
          outputChannel.appendLine(
            `Firing breakpoint event: ${JSON.stringify(eventData)}`
          );
          breakpointEventEmitter.fire(eventData);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          outputChannel.appendLine(
            `[stopped-event-error] ${msg} (reason=${body.reason})`
          );
          const errorEvent = {
            session,
            threadId: body?.threadId ?? 0,
            reason: "error"
          };
          breakpointEventEmitter.fire(errorEvent);
        }
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
  }
});
var waitForBreakpointHit = async (params) => {
  const { sessionName, timeout = 3e4 } = params;
  const breakpointHitPromise = new Promise(
    (resolve, reject) => {
      let terminateListener;
      let timeoutHandle;
      const listener = onBreakpointHit((event) => {
        outputChannel.appendLine(
          `Breakpoint hit detected for waitForBreakpointHit for session ${event.session.name} with id ${event.session.id}`
        );
        const currentSessions = activeSessions;
        if (currentSessions.length === 0) {
          throw new Error(
            `No active debug sessions found while waiting for breakpoint hit.`
          );
        }
        let targetSession = currentSessions.find(
          (s) => s.name.endsWith(sessionName) && s.parentSession
          //||
          // (s.configuration &&
          //   (s.configuration as DebugConfiguration).sessionName ===
          //     sessionName)
        );
        if (!targetSession) {
          targetSession = currentSessions[currentSessions.length - 1];
          outputChannel.appendLine(
            `Using most recent session for matching: ${targetSession.name} (${targetSession.id})`
          );
        }
        const eventMatchesTarget = (
          // event.sessionName === targetSession.id ||
          event.session.name === targetSession.name || event.session.name.startsWith(targetSession.name) || targetSession.name.startsWith(event.session.name)
        );
        if (eventMatchesTarget) {
          listener.dispose();
          terminateListener?.dispose();
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = void 0;
          }
          resolve(event);
          outputChannel.appendLine(
            `Breakpoint hit detected for waitForBreakpointHit: ${JSON.stringify(event)}`
          );
        }
      });
      terminateListener = onSessionTerminate((endEvent) => {
        outputChannel.appendLine(
          `Session termination detected for waitForBreakpointHit: ${JSON.stringify(endEvent)}`
        );
        listener.dispose();
        terminateListener?.dispose();
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = void 0;
        }
        resolve({
          session: endEvent.session,
          threadId: 0,
          reason: "terminated"
        });
      });
      timeoutHandle = setTimeout(() => {
        listener.dispose();
        terminateListener?.dispose();
        timeoutHandle = void 0;
        try {
          let targetSessions = activeSessions.filter(
            (s) => s.name.endsWith(sessionName)
          );
          if (targetSessions.length === 0 && activeSessions.length > 0) {
            targetSessions = [activeSessions[activeSessions.length - 1]];
          }
          for (const s of targetSessions) {
            void vscode5.debug.stopDebugging(s);
            outputChannel.appendLine(
              `Timeout reached; stopping debug session ${s.name} (${s.id}).`
            );
          }
        } catch (e) {
          outputChannel.appendLine(
            `Timeout cleanup error stopping sessions: ${e instanceof Error ? e.message : String(e)}`
          );
        }
        reject(
          new Error(
            `Timed out waiting for breakpoint or termination (${timeout}ms).`
          )
        );
      }, timeout);
    }
  );
  return await breakpointHitPromise;
};

// src/session.ts
var startDebuggingAndWaitForStop = async (params) => {
  const {
    sessionName,
    workspaceFolder,
    nameOrConfiguration,
    timeoutSeconds = 60,
    breakpointConfig
  } = params;
  const workspaceFolders = vscode6.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error("No workspace folders are currently open.");
  }
  outputChannel.appendLine(
    `Available workspace folders: ${workspaceFolders.map((f) => `${f.name} -> ${f.uri.fsPath}`).join(", ")}`
  );
  outputChannel.appendLine(`Looking for workspace folder: ${workspaceFolder}`);
  let folder = workspaceFolders.find((f) => f.uri?.fsPath === workspaceFolder);
  if (!folder) {
    const childOfRequested = workspaceFolders.find(
      (f) => f.uri.fsPath.startsWith(`${workspaceFolder}/`) || f.uri.fsPath.startsWith(`${workspaceFolder}\\`)
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
      (f) => workspaceFolder.startsWith(`${f.uri.fsPath}/`) || workspaceFolder.startsWith(`${f.uri.fsPath}\\`)
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
      `Workspace folder '${workspaceFolder}' not found. Available folders: ${workspaceFolders.map((f) => f.uri.fsPath).join(", ")}`
    );
  }
  const originalBreakpoints = [...vscode6.debug.breakpoints];
  if (originalBreakpoints.length) {
    outputChannel.appendLine(
      `Backing up and removing ${originalBreakpoints.length} existing breakpoint(s) for isolated debug session.`
    );
    vscode6.debug.removeBreakpoints(originalBreakpoints);
  }
  const seen = /* @__PURE__ */ new Set();
  const validated = [];
  for (const bp of breakpointConfig.breakpoints) {
    const absolutePath = bp.path.startsWith("/") ? bp.path : `${workspaceFolder}/${bp.path}`;
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
    await new Promise((resolve) => setTimeout(resolve, 500));
  } else {
    outputChannel.appendLine("No valid breakpoints to add after validation.");
  }
  const launchConfig = vscode6.workspace.getConfiguration("launch", folder.uri);
  const allConfigs = launchConfig.get(
    "configurations"
  ) || [];
  const found = allConfigs.find((c) => c.name === nameOrConfiguration);
  if (!found) {
    throw new Error(
      `Launch configuration '${nameOrConfiguration}' not found in ${folder.uri.fsPath}. Add it to .vscode/launch.json.`
    );
  }
  const resolvedConfig = { ...found };
  if (!("stopOnEntry" in resolvedConfig)) {
    resolvedConfig.stopOnEntry = true;
  } else {
    resolvedConfig.stopOnEntry = true;
  }
  const effectiveSessionName = sessionName || resolvedConfig.name || "";
  outputChannel.appendLine(
    `Starting debugger with configuration '${resolvedConfig.name}' (stopOnEntry forced to true). Waiting for first stop event.`
  );
  const stopPromise = waitForBreakpointHit({
    sessionName: effectiveSessionName,
    timeout: timeoutSeconds * 1e3
  });
  const success = await vscode6.debug.startDebugging(folder, resolvedConfig);
  if (!success) {
    throw new Error(`Failed to start debug session '${effectiveSessionName}'.`);
  }
  let remainingMs = timeoutSeconds * 1e3;
  const t0 = Date.now();
  let stopInfo;
  let debugContext;
  try {
    stopInfo = await stopPromise;
    const elapsed = Date.now() - t0;
    remainingMs = Math.max(0, remainingMs - elapsed);
    try {
      const isEntry = stopInfo.reason === "entry";
      const entryLineZeroBased = stopInfo.line !== void 0 ? stopInfo.line - 1 : -1;
      validated.some((bp) => bp.location.range.start.line === entryLineZeroBased);
      if (isEntry) {
        outputChannel.appendLine(
          "Entry stop at non-breakpoint location; continuing to reach first user breakpoint."
        );
        try {
          await stopInfo.session.customRequest("continue", {
            threadId: stopInfo.threadId
          });
          stopInfo = await waitForBreakpointHit({
            sessionName: effectiveSessionName,
            timeout: remainingMs
          });
        } catch (contErr) {
          outputChannel.appendLine(
            `Failed to continue after entry: ${contErr instanceof Error ? contErr.message : String(contErr)}`
          );
        }
      }
    } catch (parseErr) {
      outputChannel.appendLine(
        `Failed to parse first stop JSON for entry evaluation: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
      );
    }
    if (!success) {
      throw new Error(`Failed to start debug session '${sessionName}'.`);
    }
    outputChannel.appendLine(
      `Active sessions after start: ${activeSessions.map((s) => `${s.name}:${s.id}`).join(", ")}`
    );
    if (stopInfo.reason === "terminated") {
      throw new Error(
        `Debug session '${effectiveSessionName}' terminated before hitting a breakpoint.`
      );
    }
    debugContext = await DAPHelpers.getDebugContext(
      stopInfo.session,
      stopInfo.threadId
    );
    return debugContext;
  } finally {
    const current = vscode6.debug.breakpoints;
    if (current.length) {
      vscode6.debug.removeBreakpoints(current);
      outputChannel.appendLine(
        `Removed ${current.length} session breakpoint(s) before restoring originals.`
      );
    }
    if (originalBreakpoints.length) {
      vscode6.debug.addBreakpoints(originalBreakpoints);
      outputChannel.appendLine(
        `Restored ${originalBreakpoints.length} original breakpoint(s).`
      );
    } else {
      outputChannel.appendLine("No original breakpoints to restore.");
    }
  }
};
var stopDebugSession = async (params) => {
  const { sessionName } = params;
  const matchingSessions = activeSessions.filter(
    (session) => session.name === sessionName
  );
  if (matchingSessions.length === 0) {
    throw new Error(`No debug session(s) found with name '${sessionName}'.`);
  }
  for (const session of matchingSessions) {
    await vscode6.debug.stopDebugging(session);
  }
};
var resumeDebugSession = async (params) => {
  const { sessionId, breakpointConfig } = params;
  let session = activeSessions.find((s) => s.id === sessionId);
  if (!session) {
    session = activeSessions.find((s) => s.name.includes(sessionId));
  }
  if (!session) {
    return {
      content: [
        {
          type: "text",
          text: `No debug session found with ID '${sessionId}'.`
        }
      ],
      isError: true
    };
  }
  if (breakpointConfig) {
    if (breakpointConfig.disableExisting) {
      const allBreakpoints = vscode6.debug.breakpoints;
      if (allBreakpoints.length > 0) {
        vscode6.debug.removeBreakpoints(allBreakpoints);
      }
    }
    if (breakpointConfig.breakpoints && breakpointConfig.breakpoints.length > 0) {
      const workspaceFolder = session.workspaceFolder?.uri.fsPath || vscode6.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) {
        throw new Error(
          "Cannot determine workspace folder for breakpoint paths"
        );
      }
      const newBreakpoints = breakpointConfig.breakpoints.map((bp) => {
        const uri = vscode6.Uri.file(
          bp.path.startsWith("/") ? bp.path : `${workspaceFolder}/${bp.path}`
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
    sessionName: session.name
  });
  await session.customRequest("continue", { threadId: 0 });
  const stopInfo = await stopPromise;
  if (stopInfo.reason === "terminated") {
    throw new Error(
      `Debug session '${session.name}' terminated before hitting a breakpoint.`
    );
  }
  return await DAPHelpers.getDebugContext(stopInfo.session, stopInfo.threadId);
};

// src/resumeDebugSessionTool.ts
var ResumeDebugSessionTool = class {
  async invoke(options) {
    const { sessionId, breakpointConfig } = options.input;
    try {
      const stopInfo = await resumeDebugSession({
        sessionId,
        breakpointConfig
      });
      return new import_vscode3.LanguageModelToolResult([
        new import_vscode3.LanguageModelTextPart(JSON.stringify(stopInfo, null, 2))
      ]);
    } catch (error) {
      return new import_vscode3.LanguageModelToolResult([
        new import_vscode3.LanguageModelTextPart(
          `Error resuming debug session: ${error instanceof Error ? error.message : String(error)}`
        )
      ]);
    }
  }
  prepareInvocation(options) {
    return {
      invocationMessage: `Resuming debug session '${options.input.sessionId}'${options.input.waitForStop ? " and waiting for breakpoint" : ""}`
    };
  }
};

// src/startDebuggerTool.ts
var vscode7 = __toESM(require("vscode"));
var import_vscode4 = require("vscode");
var StartDebuggerTool = class {
  async invoke(options) {
    const {
      workspaceFolder,
      variableFilter,
      timeoutSeconds,
      configurationName,
      breakpointConfig
    } = options.input;
    const config = vscode7.workspace.getConfiguration("copilot-debugger");
    const effectiveConfigName = configurationName || config.get("defaultLaunchConfiguration");
    if (!effectiveConfigName) {
      return new import_vscode4.LanguageModelToolResult([
        new import_vscode4.LanguageModelTextPart(
          'Error: No launch configuration specified. Set "copilot-debugger.defaultLaunchConfiguration" in settings or provide configurationName parameter.'
        )
      ]);
    }
    const stopInfo = await startDebuggingAndWaitForStop({
      workspaceFolder,
      nameOrConfiguration: effectiveConfigName,
      variableFilter,
      timeoutSeconds,
      breakpointConfig,
      sessionName: ""
      // Empty string means match any session
    });
    return new import_vscode4.LanguageModelToolResult([
      new import_vscode4.LanguageModelTextPart(JSON.stringify(stopInfo, null, 2))
    ]);
  }
};

// src/stopDebugSessionTool.ts
var import_vscode5 = require("vscode");
var StopDebugSessionTool = class {
  async invoke(options) {
    const { sessionName } = options.input;
    try {
      const raw = await stopDebugSession({ sessionName });
      return new import_vscode5.LanguageModelToolResult([
        new import_vscode5.LanguageModelTextPart(JSON.stringify(raw))
      ]);
    } catch (error) {
      return new import_vscode5.LanguageModelToolResult([
        new import_vscode5.LanguageModelTextPart(
          `Error stopping debug session: ${error instanceof Error ? error.message : String(error)}`
        )
      ]);
    }
  }
  prepareInvocation(options) {
    return {
      invocationMessage: `Stopping debug session(s) named '${options.input.sessionName}'`
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
      "start_debugger_with_breakpoints",
      new StartDebuggerTool()
    ),
    vscode8.lm.registerTool(
      "resume_debug_session",
      new ResumeDebugSessionTool()
    ),
    vscode8.lm.registerTool("get_variables", new GetVariablesTool()),
    vscode8.lm.registerTool("expand_variable", new ExpandVariableTool()),
    vscode8.lm.registerTool("evaluate_expression", new EvaluateExpressionTool()),
    vscode8.lm.registerTool("stop_debug_session", new StopDebugSessionTool())
  );
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
