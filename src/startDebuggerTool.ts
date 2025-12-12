import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
} from "vscode";
import type { BreakpointDefinition } from "./BreakpointDefinition";
import { LanguageModelTextPart, LanguageModelToolResult } from "vscode";
import { config } from "./config";
import { EntryStopTimeoutError } from "./events";
import { logger } from "./logger";
import { startDebuggingAndWaitForStop } from "./session";

export interface BreakpointConfiguration {
  breakpoints: BreakpointDefinition[];
}

type ServerReadyAction =
  | { shellCommand: string }
  | {
      httpRequest: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      };
    }
  | { vscodeCommand: { command: string; args?: unknown[] } }
  | {
      type: "httpRequest";
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    }
  | { type: "shellCommand"; shellCommand: string }
  | { type: "vscodeCommand"; command: string; args?: unknown[] };

export interface StartDebuggerToolParameters {
  workspaceFolder: string;
  configurationName?: string;
  breakpointConfig: BreakpointConfiguration;
  /**
   * Optional serverReady configuration.
   * trigger: defines when to run the action (breakpoint path+line OR pattern). If omitted and request === 'attach' the action runs immediately after attach (default immediate attach mode).
   * action: exactly one of shellCommand | httpRequest | vscodeCommand.
   */
  serverReady?: {
    trigger?: {
      path?: string;
      line?: number;
      pattern?: string;
    };
    action: ServerReadyAction;
  };
}

// Removed scope variable limiting; concise output filters directly.

export class StartDebuggerTool
  implements LanguageModelTool<StartDebuggerToolParameters>
{
  async invoke(
    options: LanguageModelToolInvocationOptions<StartDebuggerToolParameters>
  ): Promise<LanguageModelToolResult> {
    let result: LanguageModelToolResult;
    let success = true;
    const {
      workspaceFolder,
      configurationName,
      breakpointConfig,
      serverReady,
    } = options.input;

    try {
      // Direct invocation with new serverReady structure
      const stopInfo = await startDebuggingAndWaitForStop({
        workspaceFolder,
        nameOrConfiguration: configurationName,
        breakpointConfig,
        sessionName: "",
        serverReady,
      });

      const summary = {
        session:
          stopInfo.thread?.name ??
          stopInfo.frame?.source?.name ??
          "debug-session",
        file: stopInfo.frame?.source?.path,
        line: stopInfo.frame?.line,
        reason: stopInfo.frame?.name,
      };

      // Ensure we have a hit breakpoint
      if (!stopInfo.hitBreakpoint) {
        throw new TypeError(
          "Hit breakpoint not identifiable; no frame/line correlation."
        );
      }

      const onHit = stopInfo.hitBreakpoint.onHit ?? "stopDebugging";

      if (
        stopInfo.debuggerState.status === "terminated" &&
        onHit !== "stopDebugging"
      ) {
        // Debugger exited unexpectedly
        success = false;
      }
      const providedFilters = stopInfo.hitBreakpoint.variableFilter ?? [];
      const hasExplicitFilters = providedFilters.length > 0;
      let activeFilters: string[] = [...providedFilters];
      const maxAuto = config.captureMaxVariables ?? 40;
      const capturedLogs = stopInfo.capturedLogMessages ?? [];
      let autoCapturedScope:
        | {
            name?: string;
            count: number;
          }
        | undefined;

      // Build list of variables: explicit filters OR auto-capture from nearest scope.
      if (activeFilters.length === 0) {
        const scopes = stopInfo.scopeVariables ?? [];
        const isTrivial = (name: string) => name === "this";
        const names: string[] = [];
        const scopesUsed: string[] = [];
        for (const scope of scopes) {
          const nonTrivialVars = scope.variables?.filter((variable) => {
            if (isTrivial(variable.name)) {
              return false;
            }
            const isFunction =
              (variable.type ?? "").toLowerCase() === "function";
            return !isFunction;
          });
          if (!nonTrivialVars || nonTrivialVars.length === 0) {
            continue;
          }
          scopesUsed.push(scope.scopeName);
          for (const variable of nonTrivialVars) {
            if (!names.includes(variable.name)) {
              names.push(variable.name);
              if (names.length >= maxAuto) {
                break;
              }
            }
          }
          if (names.length >= maxAuto) {
            break;
          }
        }
        if (names.length > 0) {
          activeFilters = names;
          autoCapturedScope = {
            name: scopesUsed.length === 1 ? scopesUsed[0] : "multiple scopes",
            count: names.length,
          };
        }
      }

      const filterSet = new Set(activeFilters);
      const groupedVariables: Array<{
        scopeName: string;
        variables: Array<{ name: string; value: string; type?: string }>;
      }> = [];
      for (const scope of stopInfo.scopeVariables ?? []) {
        if (filterSet.size === 0) {
          // No filters provided (non-capture breakpoint) => skip reporting variables to keep output concise.
          continue;
        }
        const matchedVars = scope.variables
          .filter((variable) => filterSet.has(variable.name))
          .map((variable) => ({
            name: variable.name,
            value: variable.value,
            type: variable.type,
          }));
        if (matchedVars.length) {
          groupedVariables.push({
            scopeName: scope.scopeName,
            variables: matchedVars,
          });
        }
      }

      const maxValueLength = 100;
      const shouldTruncateValues = !hasExplicitFilters;
      let truncatedVariables = false;
      const formatValue = (val: string) => {
        if (!shouldTruncateValues) {
          return val;
        }
        if (val.length > maxValueLength) {
          truncatedVariables = true;
          return `${val.slice(0, maxValueLength)}…(${val.length})`;
        }
        return val;
      };
      const variableBlocks = groupedVariables.map((group) => {
        const header = `### ${group.scopeName ?? "Scope"}`;
        const lines = group.variables.map((v) => {
          const typePart = v.type ? `${v.type} = ` : "";
          const displayValue = formatValue(v.value);
          return `${v.name}: ${typePart}${displayValue}`;
        });
        return [header, "", ...lines].join("\n");
      });
      const variableStr = variableBlocks.join("\n\n");
      const fileName = summary.file
        ? summary.file.split(/[/\\]/).pop()
        : "unknown";
      const header = `Breakpoint ${fileName}:${summary.line} onHit=${onHit}`;
      let bodyVars: string;
      const totalVars = groupedVariables.reduce(
        (count, group) => count + group.variables.length,
        0
      );
      if (totalVars) {
        bodyVars = `## Vars\n\n${variableStr}`;
        if (autoCapturedScope) {
          bodyVars += `\n\n(auto-captured ${
            autoCapturedScope.count
          } variable(s) from scope '${
            autoCapturedScope.name ?? "unknown"
          }', cap=${maxAuto})`;
        }
      } else if (autoCapturedScope) {
        bodyVars = `Vars: <none> (auto-capture attempted from scope '${
          autoCapturedScope.name ?? "unknown"
        }', cap=${maxAuto})`;
      } else if (filterSet.size === 0) {
        bodyVars = "Vars: <none> (no filter provided)";
      } else {
        bodyVars = `Vars: <none> (filters: ${activeFilters.join(", ")})`;
      }

      const bodyLogs = capturedLogs.length
        ? `Logs: ${capturedLogs
            .map((log) => (log.length > 120 ? `${log.slice(0, 120)}…` : log))
            .join(" | ")}`
        : "";
      const timestampLine = `Timestamp: ${new Date().toISOString()}`;
      const debuggerStateLine = (() => {
        const state = stopInfo.debuggerState;
        const sessionId = state.sessionId ?? "unknown";
        const sessionLabel = state.sessionName ?? sessionId ?? "unknown";
        const availableTools = "resumeDebugSession, getVariables, expandVariable, evaluateExpression, stopDebugSession";
        switch (state.status) {
          case "paused":
            return [
              `Debugger State: paused on '${sessionLabel}' (id=${sessionId}).`,
              `Available tools: ${availableTools}.`,
              `Recommended tool: resumeDebugSession with sessionId='${sessionId}'.`,
            ].join("\r\n");
          case "terminated":
            return [
              "Debugger State: terminated.",
              "Available tool: startDebugSessionWithBreakpoints to begin a new session.",
              "Recommended tool: startDebugSessionWithBreakpoints to create a new session.",
            ].join("\r\n");
          case "running":
            return [
              `Debugger State: running. (onHit 'captureAndContinue' continued session '${sessionLabel}').`,
              `Available tools: ${availableTools}.`,
              `Recommended tool: resumeDebugSession with sessionId='${sessionId}' to add breakpoints and continue.`,
            ].join("\r\n");
        }
      })();

      const hasConfiguredOnHit = breakpointConfig.breakpoints.some(
        (bp) => !!bp.onHit
      );
      const multipleBreakpoints = breakpointConfig.breakpoints.length > 1;
      const guidance: string[] = [];

      if (
        stopInfo.debuggerState.status === "terminated" &&
        !hasConfiguredOnHit
      ) {
        guidance.push(
          "No onHit behavior was set; consider onHit 'captureAndContinue' to keep the session alive and still collect data."
        );
      }

      if (!multipleBreakpoints) {
        guidance.push(
          "You can supply multiple breakpoints, each with its own onHit (e.g., trace with captureAndContinue, then stopDebugging at a later line)."
        );
      }

      if (onHit === "captureAndContinue" && activeFilters.length === 0) {
        guidance.push(
          `captureAndContinue auto-captured ${totalVars} variable(s); set variableFilter to focus only the names you care about.`
        );
      }

      if (truncatedVariables) {
        guidance.push(
          "Values were truncated to 100 characters. Provide variableFilter to return full values without truncation."
        );
      }

      const guidanceSection =
        guidance.length > 0 ? `Guidance:\n- ${guidance.join("\n- ")}` : "";

      const successLine = `Success: ${success}`;
      const serverReadySection = (() => {
        const info = stopInfo.serverReadyInfo;
        if (!info?.configured) {
          return "Server Ready Trigger: Not configured";
        }
        if (!info.phases.length) {
          return `Server Ready Trigger: Not Hit (mode=${info.triggerMode})`;
        }
        const hits = info.phases
          .map(
            (entry) =>
              `${entry.phase}@${new Date(entry.timestamp).toISOString()}`
          )
          .join(", ");
        const detail = info.triggerSummary ? ` | ${info.triggerSummary}` : "";
        return `Server Ready Trigger: Hit (mode=${info.triggerMode}) ${hits}${detail}`;
      })();
      const runtimeOutputSection = (() => {
        const preview = stopInfo.runtimeOutput;
        if (!preview || preview.lines.length === 0) {
          return "Runtime Output: <none>";
        }
        const qualifier = preview.truncated
          ? `showing last ${preview.lines.length} of ${preview.totalLines} line(s)`
          : `last ${preview.lines.length} line(s)`;
        const body = preview.lines.map((line) => `- ${line}`).join("\n");
        return `Runtime Output (${qualifier}):\n${body}`;
      })();
      const sections = [
        successLine,
        timestampLine,
        header,
        bodyVars,
        bodyLogs,
        debuggerStateLine,
        ...(success ? [] : [serverReadySection, runtimeOutputSection]),
        guidanceSection,
      ].filter((section) => section && section.trim().length > 0);
      const textOutput = sections.join("\n");

      logger.info(`[StartDebuggerTool] textOutput ${textOutput}`);
      result = new LanguageModelToolResult([
        new LanguageModelTextPart(textOutput),
      ]);
    } catch (err) {
      success = false;
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout =
        err instanceof EntryStopTimeoutError || /timed out/i.test(message);
      const failureLine = isTimeout ? "Failure: timeout" : "Failure: error";
      const errorOutput = `Success: ${success}\n${failureLine}\nError: ${message}`;
      result = new LanguageModelToolResult([
        new LanguageModelTextPart(errorOutput),
      ]);
    }
    logger.debug(`[StartDebuggerTool] result ${result}`);
    return result;
  }
}
