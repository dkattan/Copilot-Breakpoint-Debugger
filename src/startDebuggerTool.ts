import type {
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
} from "vscode";
import type { BreakpointDefinition } from "./BreakpointDefinition";
import { LanguageModelTextPart, LanguageModelToolResult } from "vscode";
import { config } from "./config";
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
      const providedFilters = stopInfo.hitBreakpoint.variableFilter ?? [];
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
        // Choose the first scope that has at least one non-trivial variable.
        const candidateScope = scopes.find((scope) =>
          scope.variables?.some((variable) => !isTrivial(variable.name))
        );
        if (candidateScope) {
          const names: string[] = [];
          for (const variable of candidateScope.variables) {
            if (!names.includes(variable.name)) {
              names.push(variable.name);
              if (names.length >= maxAuto) {
                break;
              }
            }
          }
          activeFilters = names;
          autoCapturedScope = {
            name: candidateScope.scopeName,
            count: names.length,
          };
        }
      }

      const filterSet = new Set(activeFilters);
      const flattened: Array<{
        name: string;
        value: string;
        scope: string;
        type?: string;
      }> = [];
      for (const scope of stopInfo.scopeVariables ?? []) {
        for (const variable of scope.variables) {
          if (filterSet.size === 0) {
            // No filters provided (non-capture breakpoint) => skip reporting variables to keep output concise.
            continue;
          }
          if (filterSet.has(variable.name)) {
            flattened.push({
              name: variable.name,
              value: variable.value,
              scope: scope.scopeName,
              type: variable.type,
            });
          }
        }
      }

      const truncate = (val: string) => {
        const max = 120;
        return val.length > max ? `${val.slice(0, max)}…(${val.length})` : val;
      };
      const variableStr = flattened
        .map((v) => {
          const typePart = v.type ? `:${v.type}` : "";
          return `${v.name}=${truncate(v.value)} (${v.scope}${typePart})`;
        })
        .join("; ");
      const fileName = summary.file
        ? summary.file.split(/[/\\]/).pop()
        : "unknown";
      const header = `Breakpoint ${fileName}:${summary.line} onHit=${onHit}`;
      let bodyVars: string;
      if (flattened.length) {
        bodyVars = `Vars: ${variableStr}`;
        if (autoCapturedScope) {
          bodyVars += ` (auto-captured ${
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
        const sessionLabel = state.sessionName ?? state.sessionId ?? "unknown";
        switch (state.status) {
          case "paused":
            return `Debugger State: paused on '${sessionLabel}'. Recommended tools: resume_debug_session, get_variables, expand_variable, evaluate_expression, stop_debug_session.`;
          case "terminated":
            return "Debugger State: terminated. Recommended tool: start_debugger_with_breakpoints to begin a new session.";
          case "running":
            return `Debugger State: running. (onHit 'captureAndContinue' continued session '${sessionLabel}'). Recommended tools: wait_for_breakpoint or resume_debug_session with new breakpoints.`;
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
          "Tip: No onHit behavior was set; consider onHit 'captureAndContinue' to keep the session alive and still collect data."
        );
      }

      if (!multipleBreakpoints) {
        guidance.push(
          "Tip: You can supply multiple breakpoints, each with its own onHit (e.g., trace with captureAndContinue, then stopDebugging at a later line)."
        );
      }

      if (onHit === "captureAndContinue" && activeFilters.length === 0) {
        guidance.push(
          `Tip: captureAndContinue auto-captured ${flattened.length} variable(s); set variableFilter to focus only the names you care about.`
        );
      }

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

      const guidanceSection =
        guidance.length > 0 ? `Guidance:\n- ${guidance.join("\n- ")}` : "";

      const sections = [
        timestampLine,
        header,
        bodyVars,
        bodyLogs,
        debuggerStateLine,
        serverReadySection,
        runtimeOutputSection,
        guidanceSection,
      ].filter((section) => section && section.trim().length > 0);
      const textOutput = sections.join("\n");

      logger.info(`[StartDebuggerTool] textOutput ${textOutput}`);
      result = new LanguageModelToolResult([
        new LanguageModelTextPart(textOutput),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = new LanguageModelToolResult([
        new LanguageModelTextPart(`Error: ${message}`),
      ]);
    }
    logger.debug(`[StartDebuggerTool] result ${result}`);
    return result;
  }
}
