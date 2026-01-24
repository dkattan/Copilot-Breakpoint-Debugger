import type { BreakpointDefinition } from "./BreakpointDefinition";
import type { StartDebuggerStopInfo } from "./session";
import { markdownTable } from "markdown-table";
import { config } from "./config";
import { version } from "./generated-meta";

// Keep rendering logic shared between StartDebuggerTool and ResumeDebugSessionTool.

export interface BreakpointConfiguration {
  breakpoints: BreakpointDefinition[]
}

export function renderStopInfoMarkdown(params: {
  stopInfo: StartDebuggerStopInfo
  breakpointConfig: BreakpointConfiguration
  success: boolean
}): string {
  const { stopInfo, breakpointConfig, success } = params;

  const summary = {
    session:
      stopInfo.thread?.name ?? stopInfo.frame?.source?.name ?? "debug-session",
    file: stopInfo.frame?.source?.path,
    line: stopInfo.frame?.line,
    reason: stopInfo.frame?.name,
  };

  if (!stopInfo.hitBreakpoint && !stopInfo.exceptionInfo) {
    // If we have neither a breakpoint match nor an exception, we just report generic stop.
    // No throw.
  }

  const onHit = stopInfo.hitBreakpoint?.onHit ?? "break";
  const stepOver = stopInfo.stepOverCapture?.performed
    ? stopInfo.stepOverCapture
    : undefined;

  const providedVariable = stopInfo.hitBreakpoint?.variable;
  const providedFilters
    = !providedVariable || providedVariable === "*" ? [] : [providedVariable];
  const hasExplicitFilters = providedFilters.length > 0;
  let activeFilters: string[] = [...providedFilters];
  const maxAuto = config.captureMaxVariables ?? 40;
  const capturedLogs = stopInfo.capturedLogMessages ?? [];
  let autoCapturedScope:
    | {
      name?: string
      count: number
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
        const isFunction = (variable.type ?? "").toLowerCase() === "function";
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
    scopeName: string
    variables: Array<{
      name: string
      type?: string
      value: string
      beforeValue?: string
      afterValue?: string
    }>
  }> = [];

  const beforeLookup = (() => {
    if (!stepOver) {
      return undefined;
    }
    const map = new Map<string, { value: string, type?: string }>();
    for (const scope of stepOver.before ?? []) {
      for (const v of scope.variables ?? []) {
        map.set(v.name, { value: v.value, type: v.type });
      }
    }
    return map;
  })();
  const afterLookup = (() => {
    if (!stepOver) {
      return undefined;
    }
    const map = new Map<string, { value: string, type?: string }>();
    for (const scope of stepOver.after ?? []) {
      for (const v of scope.variables ?? []) {
        map.set(v.name, { value: v.value, type: v.type });
      }
    }
    return map;
  })();

  for (const scope of stopInfo.scopeVariables ?? []) {
    if (filterSet.size === 0) {
      // No filters provided (non-capture breakpoint) => skip reporting variables to keep output concise.
      continue;
    }
    const matchedVars = scope.variables
      .filter(variable => filterSet.has(variable.name))
      .map((variable) => {
        if (!stepOver || !beforeLookup || !afterLookup) {
          return {
            name: variable.name,
            value: variable.value,
            type: variable.type,
          };
        }
        const before = beforeLookup.get(variable.name);
        const after = afterLookup.get(variable.name);
        return {
          name: variable.name,
          type: variable.type ?? after?.type ?? before?.type,
          value: after?.value ?? variable.value,
          beforeValue: before?.value,
          afterValue: after?.value ?? variable.value,
        };
      });
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

  const variableTables = groupedVariables.map((group) => {
    const header = `### ${group.scopeName ?? "Scope"}`;
    const rows = group.variables.map((v) => {
      const typePart = v.type ?? "";
      if (!stepOver) {
        const displayValue = formatValue(v.value);
        return [v.name, typePart, displayValue];
      }
      const beforeVal = v.beforeValue ?? "<unavailable>";
      const afterVal = v.afterValue ?? v.value ?? "<unavailable>";
      const displayBefore = formatValue(beforeVal);
      const displayAfter = formatValue(afterVal);
      return [v.name, typePart, displayBefore, displayAfter];
    });
    const table = stepOver
      ? markdownTable([["Name", "Type", "Before", "After"], ...rows])
      : markdownTable([["Name", "Type", "Value"], ...rows]);
    return [header, "", table].join("\n");
  });

  const variableStr = variableTables.join("\n\n");
  const fileName = summary.file ? summary.file.split(/[/\\]/).pop() : "unknown";
  let header: string;
  if (stopInfo.exceptionInfo) {
    header = `Exception: ${stopInfo.exceptionInfo.description} (see Exception Details below)`;
  }
  else if (stopInfo.hitBreakpoint) {
    if (stepOver?.performed && stepOver.fromLine && stepOver.toLine) {
      header = `Breakpoint ${fileName}:${stepOver.fromLine} onHit=${onHit} (autoStepOver -> stopped at line ${stepOver.toLine})`;
    }
    else {
      header = `Breakpoint ${fileName}:${summary.line} onHit=${onHit}`;
    }
  }
  else {
    header = `Stopped: reason=${stopInfo.reason ?? "unknown"} at ${fileName}:${
      summary.line
    }`;
  }

  let bodyVars: string;
  const totalVars = groupedVariables.reduce(
    (count, group) => count + group.variables.length,
    0,
  );

  if (totalVars) {
    bodyVars = variableStr;
    if (autoCapturedScope) {
      bodyVars += `\n\n(auto-captured ${
        autoCapturedScope.count
      } variable(s) from scope '${
        autoCapturedScope.name ?? "unknown"
      }', cap=${maxAuto})`;
    }
  }
  else if (autoCapturedScope) {
    bodyVars = `Vars: <none> (auto-capture attempted from scope '${
      autoCapturedScope.name ?? "unknown"
    }', cap=${maxAuto})`;
  }
  else if (filterSet.size === 0) {
    bodyVars = "Vars: <none> (no filter provided)";
  }
  else {
    bodyVars = `Vars: <none> (filters: ${activeFilters.join(", ")})`;
  }

  const bodyLogs = capturedLogs.length
    ? capturedLogs
        .map(log => (log.length > 120 ? `${log.slice(0, 120)}…` : log))
        .map(log => `- ${log}`)
        .join("\n")
    : "";

  const timestampLine = `Timestamp: ${new Date().toISOString()}`;

  const debuggerStateLine = (() => {
    const state = stopInfo.debuggerState;
    const sessionId = state.sessionId ?? "unknown";
    const sessionLabel = state.sessionName ?? sessionId ?? "unknown";
    const availableTools
      = "resumeDebugSession, getVariables, expandVariable, evaluateExpression, stopDebugSession";
    switch (state.status) {
      case "paused":
        return [
          `Debugger State: paused on '${sessionLabel}' (id=${sessionId}).`,
          `Available tools: ${availableTools}.`,
          "Hard rule: while paused, do NOT run external HTTP requests (curl/wget/browser/fetch) against the debuggee. Only use debugger operations until you resume.",
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

  const protocolSection = (() => {
    const protocol = stopInfo.protocol;
    if (!protocol) {
      return "";
    }
    const allowed = protocol.allowedNextActions?.length
      ? protocol.allowedNextActions.map(a => `- ${a}`).join("\n")
      : "- <none>";
    const forbidden = protocol.forbiddenNextActions?.length
      ? protocol.forbiddenNextActions.map(a => `- ${a}`).join("\n")
      : "- <none>";
    return [
      "### Allowed next actions",
      allowed,
      "",
      "### Forbidden next actions",
      forbidden,
      "",
      `Next step: ${protocol.nextStepSuggestion}`,
    ].join("\n");
  })();

  const hasConfiguredOnHit = breakpointConfig.breakpoints.some(
    bp => !!bp.onHit,
  );
  const multipleBreakpoints = breakpointConfig.breakpoints.length > 1;
  const guidance: string[] = [];

  if (stopInfo.debuggerState.status === "terminated" && !hasConfiguredOnHit) {
    guidance.push(
      "No onHit behavior was set; consider onHit 'captureAndContinue' to keep the session alive and still collect data.",
    );
  }

  if (!multipleBreakpoints) {
    guidance.push(
      "You can supply multiple breakpoints, each with its own onHit (e.g., trace with captureAndContinue, then captureAndStopDebugging at a later line).",
    );
  }

  if (onHit === "captureAndContinue" && activeFilters.length === 0) {
    guidance.push(
      `captureAndContinue auto-captured ${totalVars} variable(s); set 'variable' to focus only the name you care about (or use '*' to keep auto-capture).`,
    );
  }

  if (truncatedVariables) {
    guidance.push(
      "Values were truncated to 100 characters. Provide 'variable' to focus output and reduce truncation.",
    );
  }

  const guidanceSection
    = guidance.length > 0 ? guidance.map(item => `- ${item}`).join("\n") : "";

  const successLine = `Success: ${success}`;
  const versionLine = `Plugin Version: ${version}`;

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
        entry => `${entry.phase}@${new Date(entry.timestamp).toISOString()}`,
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
    const body = preview.lines.map(line => `- ${line}`).join("\n");
    return `Runtime Output (${qualifier}):\n${body}`;
  })();

  const exceptionSection = (() => {
    if (!stopInfo.exceptionInfo) {
      return undefined;
    }
    return {
      title: "Exception Details",
      body: `**${stopInfo.exceptionInfo.description}**\n\n\`\`\`text\n${stopInfo.exceptionInfo.details}\n\`\`\``,
    };
  })();

  const sections: Array<{ title: string, body: string }> = [
    {
      title: "Summary",
      body: [successLine, versionLine, timestampLine, header]
        .filter(entry => entry && entry.trim().length > 0)
        .join("\n"),
    },
    exceptionSection ?? { title: "", body: "" },
    { title: "Vars", body: bodyVars },
    { title: "Logs", body: bodyLogs },
    { title: "Debugger State", body: debuggerStateLine },
    { title: "Protocol", body: protocolSection },
    ...(!success
      ? [
          { title: "Server Ready", body: serverReadySection },
          { title: "Runtime Output", body: runtimeOutputSection },
        ]
      : []),
    { title: "Guidance", body: guidanceSection },
  ].filter(section => section.body && section.body.trim().length > 0);

  return sections
    .map(section => `## ${section.title}\n${section.body}`)
    .join("\n\n");
}
