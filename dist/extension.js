'use strict';
var me = Object.create;
var O = Object.defineProperty;
var fe = Object.getOwnPropertyDescriptor;
var be = Object.getOwnPropertyNames;
var ve = Object.getPrototypeOf,
  he = Object.prototype.hasOwnProperty;
var we = (t, e) => {
    for (var n in e) O(t, n, { get: e[n], enumerable: !0 });
  },
  X = (t, e, n, o) => {
    if ((e && typeof e == 'object') || typeof e == 'function')
      for (let r of be(e))
        !he.call(t, r) &&
          r !== n &&
          O(t, r, {
            get: () => e[r],
            enumerable: !(o = fe(e, r)) || o.enumerable,
          });
    return t;
  };
var T = (t, e, n) => (
    (n = t != null ? me(ve(t)) : {}),
    X(
      e || !t || !t.__esModule
        ? O(n, 'default', { value: t, enumerable: !0 })
        : n,
      t
    )
  ),
  xe = t => X(O({}, '__esModule', { value: !0 }), t);
var De = {};
we(De, { activate: () => Se, deactivate: () => ye });
module.exports = xe(De);
var E = T(require('vscode'));
var ne = T(require('vscode')),
  S = require('vscode');
var y = T(require('vscode')),
  s = y.window.createOutputChannel('Debug Tools'),
  Y = new y.EventEmitter(),
  $e = Y.event,
  b = [],
  ee = new y.EventEmitter(),
  oe = ee.event;
y.debug.onDidStartDebugSession(t => {
  (b.push(t),
    s.appendLine(`Debug session started: ${t.name} (ID: ${t.id})`),
    s.appendLine(`Active sessions: ${b.length}`),
    Y.fire(t));
});
y.debug.onDidTerminateDebugSession(t => {
  let e = b.indexOf(t);
  e >= 0 &&
    (b.splice(e, 1),
    s.appendLine(`Debug session terminated: ${t.name} (ID: ${t.id})`),
    s.appendLine(`Active sessions: ${b.length}`),
    ee.fire({ session: t }));
});
y.debug.onDidChangeActiveDebugSession(t => {
  s.appendLine(`Active debug session changed: ${t ? t.name : 'None'}`);
});
var L = require('vscode'),
  f = class {
    static async getDebugContext(e, n) {
      let { threads: o } = await e.customRequest('threads');
      if (!o || o.length === 0)
        throw new Error(`No threads available in session ${e.id} (${e.name})`);
      let r = typeof n == 'number' ? n : o[0].id,
        a = o.find(i => i.id === r);
      if (!a)
        throw new Error(
          `Thread with id ${r} not found in session ${e.id} (${e.name})`
        );
      let l = await e.customRequest('stackTrace', { threadId: a.id });
      if (!l.stackFrames || l.stackFrames.length === 0)
        throw new Error(
          `No stack frames available for thread ${a.id} in session ${e.id} (${e.name})`
        );
      let c = l.stackFrames[0],
        p = await e.customRequest('scopes', { frameId: c.id });
      if (!p.scopes || p.scopes.length === 0)
        throw new Error(
          `No scopes available for frame ${c.id} in session ${e.id} (${e.name})`
        );
      return { thread: a, frame: c, scopes: p.scopes };
    }
    static async getVariablesFromReference(e, n) {
      let o;
      try {
        o = await e.customRequest('variables', { variablesReference: n });
      } catch {
        return [];
      }
      return o?.variables
        ? o.variables.map(r => ({
            name: r.evaluateName || r.name,
            value: r.value,
            type: r.type,
            isExpandable: r.variablesReference > 0,
          }))
        : [];
    }
    static async findVariableInScopes(e, n, o) {
      for (let r of n) {
        let l = (
          await this.getVariablesFromReference(e, r.variablesReference)
        ).find(c => c.name === o);
        if (l) return { variable: l, scopeName: r.name };
      }
      return null;
    }
    static createSuccessResult(e) {
      let n = new L.LanguageModelTextPart(e);
      return new L.LanguageModelToolResult([n]);
    }
    static createErrorResult(e) {
      let n = new L.LanguageModelTextPart(`Error: ${e}`);
      return new L.LanguageModelToolResult([n]);
    }
  };
var A = class {
  async invoke(e) {
    let { expression: n, sessionId: o, threadId: r } = e.input;
    try {
      let a;
      if (
        (o && (a = b.find(u => u.id === o)),
        a || (a = ne.debug.activeDebugSession || b[0]),
        !a)
      )
        return new S.LanguageModelToolResult([
          new S.LanguageModelTextPart(
            'Error: No active debug session found to evaluate expression.'
          ),
        ]);
      let l = await f.getDebugContext(a, r),
        c = { expression: n, context: 'watch' };
      (l?.frame?.id !== void 0 && (c.frameId = l.frame.id),
        s.appendLine(
          `EvaluateExpressionTool: evaluating '${n}' in session '${a.name}'.`
        ));
      let p;
      try {
        p = await a.customRequest('evaluate', c);
      } catch (u) {
        let m = u instanceof Error ? u.message : JSON.stringify(u);
        return new S.LanguageModelToolResult([
          new S.LanguageModelTextPart(
            `Error evaluating expression '${n}': ${m}`
          ),
        ]);
      }
      let i = {
        expression: n,
        result: p?.result,
        type: p?.type,
        presentationHint: p?.presentationHint,
        variablesReference: p?.variablesReference,
      };
      return new S.LanguageModelToolResult([
        new S.LanguageModelTextPart(JSON.stringify(i)),
      ]);
    } catch (a) {
      return new S.LanguageModelToolResult([
        new S.LanguageModelTextPart(
          `Unexpected error evaluating expression: ${a instanceof Error ? a.message : String(a)}`
        ),
      ]);
    }
  }
  prepareInvocation(e) {
    return {
      invocationMessage: `Evaluating expression '${e.input.expression}' in debug session`,
    };
  }
};
var te = T(require('vscode'));
var B = class {
  async expandVariable(e) {
    let n = te.debug.activeDebugSession;
    if (!n) throw new Error('No active debug session found');
    let o = await f.getDebugContext(n);
    if (!o)
      throw new Error(
        'Unable to get debug context (threads, frames, or scopes)'
      );
    let r = await f.findVariableInScopes(n, o.scopes, e);
    if (!r) throw new Error(`Variable '${e}' not found in current scope`);
    let a = { variable: r.variable, children: [] };
    if (r.variable.isExpandable) {
      let l = await this.getOriginalVariable(n, o.scopes, e);
      l &&
        l.variablesReference > 0 &&
        (a.children = await f.getVariablesFromReference(
          n,
          l.variablesReference
        ));
    }
    return a;
  }
  async invoke(e) {
    let { variableName: n } = e.input;
    try {
      let o = await this.expandVariable(n),
        r = JSON.stringify(o, null, 2);
      return f.createSuccessResult(r);
    } catch (o) {
      let r = o instanceof Error ? o.message : 'Unknown error occurred';
      return f.createErrorResult(`Failed to expand variable: ${r}`);
    }
  }
  async getOriginalVariable(e, n, o) {
    for (let r of n) {
      let a;
      try {
        a = await e.customRequest('variables', {
          variablesReference: r.variablesReference,
        });
      } catch {
        continue;
      }
      if (a?.variables) {
        let l = a.variables.find(c => (c.evaluateName || c.name) === o);
        if (l) return l;
      }
    }
    return null;
  }
  prepareInvocation(e) {
    return {
      invocationMessage: `Expanding variable '${e.input.variableName}'`,
    };
  }
};
var re = T(require('vscode'));
var H = class {
  async getVariables() {
    let e = re.debug.activeDebugSession;
    if (!e) throw new Error('No active debug session found');
    let n = await f.getDebugContext(e);
    if (!n)
      throw new Error(
        'Unable to get debug context (threads, frames, or scopes)'
      );
    let o = { type: 'variables', sessionId: e.id, scopes: [] };
    for (let r of n.scopes) {
      let a = await f.getVariablesFromReference(e, r.variablesReference);
      a.length > 0 && o.scopes.push({ name: r.name, variables: a });
    }
    if (o.scopes.length === 0)
      throw new Error('No variables found in current scope');
    return o;
  }
  async invoke(e) {
    try {
      let n = await this.getVariables(),
        o = JSON.stringify(n, null, 2);
      return f.createSuccessResult(o);
    } catch (n) {
      let o = n instanceof Error ? n.message : 'Unknown error occurred';
      return f.createErrorResult(`Failed to get variables: ${o}`);
    }
  }
  prepareInvocation(e) {
    return { invocationMessage: 'Getting all variables from debug session' };
  }
};
var R = require('vscode');
var w = T(require('node:path')),
  g = T(require('vscode'));
var N = T(require('vscode'));
var z = new N.EventEmitter(),
  ke = z.event;
N.debug.registerDebugAdapterTrackerFactory('*', {
  createDebugAdapterTracker: t => {
    class e {
      onWillStartSession() {
        s.appendLine(`Debug session starting: ${t.name}`);
      }
      onWillReceiveMessage(o) {
        s.appendLine(`Message received by debug adapter: ${JSON.stringify(o)}`);
      }
      async onDidSendMessage(o) {
        if (o.type !== 'event') return;
        let r = o;
        if (r.event !== 'stopped') return;
        let a = r.body;
        if (
          [
            'breakpoint',
            'step',
            'pause',
            'exception',
            'assertion',
            'entry',
          ].includes(a.reason)
        )
          try {
            let c;
            a.reason === 'exception' &&
              a.description &&
              (c = {
                description: a.description || 'Unknown exception',
                details: a.text || 'No additional details available',
              });
            let p = 3,
              i,
              u;
            for (let h = 0; h < p; h++)
              try {
                if (
                  (h > 0 && (await new Promise(x => setTimeout(x, 50 * h))),
                  (u = await f.getDebugContext(t, a.threadId)),
                  !u.frame?.source?.path)
                )
                  throw new Error(
                    `Top stack frame missing source path: ${JSON.stringify(u.frame)}`
                  );
                break;
              } catch (x) {
                ((i = x),
                  s.appendLine(
                    `getDebugContext attempt ${h + 1} failed for thread ${a.threadId}: ${x instanceof Error ? x.message : String(x)}`
                  ));
              }
            if (!u)
              throw new Error(
                `Unable to retrieve call stack after ${p} attempts for thread ${a.threadId}: ${i instanceof Error ? i.message : String(i)}`
              );
            let m = {
              session: t,
              threadId: a.threadId,
              reason: a.reason,
              frameId: u.frame.id,
              filePath: u.frame.source?.path,
              line: u.frame.line,
              exceptionInfo: c,
            };
            (s.appendLine(`Firing breakpoint event: ${JSON.stringify(m)}`),
              z.fire(m));
          } catch (c) {
            let p = c instanceof Error ? c.message : String(c);
            s.appendLine(`[stopped-event-error] ${p} (reason=${a.reason})`);
            let i = { session: t, threadId: a?.threadId ?? 0, reason: 'error' };
            z.fire(i);
          }
      }
      onWillSendMessage(o) {
        s.appendLine(`Message sent to debug adapter: ${JSON.stringify(o)}`);
      }
      onDidReceiveMessage(o) {
        s.appendLine(
          `Message received from debug adapter: ${JSON.stringify(o)}`
        );
      }
      onError(o) {
        s.appendLine(`Debug adapter error: ${o.message}`);
      }
      onExit(o, r) {
        s.appendLine(`Debug adapter exited: code=${o}, signal=${r}`);
      }
    }
    return new e();
  },
});
var J = async t => {
  let { sessionName: e, timeout: n = 3e4 } = t;
  return await new Promise((r, a) => {
    let l,
      c,
      p = ke(i => {
        s.appendLine(
          `Breakpoint hit detected for waitForBreakpointHit for session ${i.session.name} with id ${i.session.id}`
        );
        let u = b;
        if (u.length === 0)
          throw new Error(
            'No active debug sessions found while waiting for breakpoint hit.'
          );
        let m = u.find(x => x.name.endsWith(e) && x.parentSession);
        (m ||
          ((m = u[u.length - 1]),
          s.appendLine(
            `Using most recent session for matching: ${m.name} (${m.id})`
          )),
          (i.session.name === m.name ||
            i.session.name.startsWith(m.name) ||
            m.name.startsWith(i.session.name)) &&
            (p.dispose(),
            l?.dispose(),
            c && (clearTimeout(c), (c = void 0)),
            r(i),
            s.appendLine(
              `Breakpoint hit detected for waitForBreakpointHit: ${JSON.stringify(i)}`
            )));
      });
    ((l = oe(i => {
      (s.appendLine(
        `Session termination detected for waitForBreakpointHit: ${JSON.stringify(i)}`
      ),
        p.dispose(),
        l?.dispose(),
        c && (clearTimeout(c), (c = void 0)),
        r({ session: i.session, threadId: 0, reason: 'terminated' }));
    })),
      (c = setTimeout(() => {
        (p.dispose(), l?.dispose(), (c = void 0));
        try {
          let i = b.filter(u => u.name.endsWith(e));
          i.length === 0 && b.length > 0 && (i = [b[b.length - 1]]);
          for (let u of i)
            (N.debug.stopDebugging(u),
              s.appendLine(
                `Timeout reached; stopping debug session ${u.name} (${u.id}).`
              ));
        } catch (i) {
          s.appendLine(
            `Timeout cleanup error stopping sessions: ${i instanceof Error ? i.message : String(i)}`
          );
        }
        a(
          new Error(`Timed out waiting for breakpoint or termination (${n}ms).`)
        );
      }, n)));
  });
};
var ae = t => w.normalize(t).replace(/\\/g, '/').replace(/\/+$/, '');
var se = async t => {
    let {
        sessionName: e,
        workspaceFolder: n,
        nameOrConfiguration: o,
        timeoutSeconds: r = 60,
        breakpointConfig: a,
      } = t,
      l = g.extensions.getExtension(
        'dkattan.copilot-breakpoint-debugger'
      )?.extensionPath,
      c = w.isAbsolute(n) ? n : l ? w.resolve(l, n) : w.resolve(n),
      p = ae(c),
      i = g.workspace.workspaceFolders;
    if (!i || i.length === 0)
      throw new Error('No workspace folders are currently open.');
    (s.appendLine(
      `Available workspace folders: ${i.map(d => `${d.name} -> ${d.uri.fsPath}`).join(', ')}`
    ),
      s.appendLine(`Looking for workspace folder (resolved): ${c}`));
    let u = i.map(d => ({ folder: d, normalized: ae(d.uri.fsPath) })),
      m = u.find(d => d.normalized === p);
    if (!m) {
      let d = u.find(v => v.normalized.startsWith(`${p}/`));
      d &&
        ((m = d),
        s.appendLine(
          `Requested parent folder '${c}' not open; using child workspace folder '${m.folder.uri.fsPath}'.`
        ));
    }
    if (!m) {
      let d = u.find(v => p.startsWith(`${v.normalized}/`));
      d &&
        ((m = d),
        s.appendLine(
          `Requested subfolder '${c}' not open; using parent workspace folder '${m.folder.uri.fsPath}'.`
        ));
    }
    let h = m?.folder;
    if (!h)
      throw new Error(
        `Workspace folder '${n}' not found. Available folders: ${i.map(d => d.uri.fsPath).join(', ')}`
      );
    let x = h.uri.fsPath,
      P = [...g.debug.breakpoints];
    P.length &&
      (s.appendLine(
        `Backing up and removing ${P.length} existing breakpoint(s) for isolated debug session.`
      ),
      g.debug.removeBreakpoints(P));
    let G = new Set(),
      C = [];
    for (let d of a.breakpoints) {
      let v = w.isAbsolute(d.path) ? d.path : w.join(x, d.path);
      try {
        let D = (await g.workspace.openTextDocument(g.Uri.file(v))).lineCount;
        if (d.line < 1 || d.line > D) {
          s.appendLine(
            `Skipping breakpoint ${v}:${d.line} (out of range, file has ${D} lines).`
          );
          continue;
        }
        let j = `${v}:${d.line}`;
        if (G.has(j)) {
          s.appendLine(`Skipping duplicate breakpoint ${j}.`);
          continue;
        }
        G.add(j);
        let ge = g.Uri.file(v),
          ue = new g.Position(d.line - 1, 0);
        C.push(
          new g.SourceBreakpoint(
            new g.Location(ge, ue),
            !0,
            d.condition,
            d.hitCondition,
            d.logMessage
          )
        );
      } catch ($) {
        s.appendLine(
          `Failed to open file for breakpoint path ${v}: ${$ instanceof Error ? $.message : String($)}`
        );
      }
    }
    C.length
      ? (g.debug.addBreakpoints(C),
        s.appendLine(`Added ${C.length} validated breakpoint(s).`),
        await new Promise(d => setTimeout(d, 500)))
      : s.appendLine('No valid breakpoints to add after validation.');
    let Z = (
      g.workspace.getConfiguration('launch', h.uri).get('configurations') || []
    ).find(d => d.name === o);
    if (!Z)
      throw new Error(
        `Launch configuration '${o}' not found in ${h.uri.fsPath}. Add it to .vscode/launch.json.`
      );
    let I = { ...Z };
    ('stopOnEntry' in I, (I.stopOnEntry = !0));
    let F = e || I.name || '';
    s.appendLine(
      `Starting debugger with configuration '${I.name}' (stopOnEntry forced to true). Waiting for first stop event.`
    );
    let ce = J({ sessionName: F, timeout: r * 1e3 }),
      K = await g.debug.startDebugging(h, I);
    if (!K) throw new Error(`Failed to start debug session '${F}'.`);
    let _ = r * 1e3,
      pe = Date.now(),
      k,
      Q;
    try {
      k = await ce;
      let d = Date.now() - pe;
      _ = Math.max(0, _ - d);
      try {
        let v = k.reason === 'entry',
          $ = k.line !== void 0 ? k.line - 1 : -1;
        if ((C.some(D => D.location.range.start.line === $), v)) {
          s.appendLine(
            'Entry stop at non-breakpoint location; continuing to reach first user breakpoint.'
          );
          try {
            (await k.session.customRequest('continue', {
              threadId: k.threadId,
            }),
              (k = await J({ sessionName: F, timeout: _ })));
          } catch (D) {
            s.appendLine(
              `Failed to continue after entry: ${D instanceof Error ? D.message : String(D)}`
            );
          }
        }
      } catch (v) {
        s.appendLine(
          `Failed to parse first stop JSON for entry evaluation: ${v instanceof Error ? v.message : String(v)}`
        );
      }
      if (!K) throw new Error(`Failed to start debug session '${e}'.`);
      if (
        (s.appendLine(
          `Active sessions after start: ${b.map(v => `${v.name}:${v.id}`).join(', ')}`
        ),
        k.reason === 'terminated')
      )
        throw new Error(
          `Debug session '${F}' terminated before hitting a breakpoint.`
        );
      return ((Q = await f.getDebugContext(k.session, k.threadId)), Q);
    } finally {
      let d = g.debug.breakpoints;
      (d.length &&
        (g.debug.removeBreakpoints(d),
        s.appendLine(
          `Removed ${d.length} session breakpoint(s) before restoring originals.`
        )),
        P.length
          ? (g.debug.addBreakpoints(P),
            s.appendLine(`Restored ${P.length} original breakpoint(s).`))
          : s.appendLine('No original breakpoints to restore.'));
    }
  },
  ie = async t => {
    let { sessionName: e } = t,
      n = b.filter(o => o.name === e);
    if (n.length === 0)
      throw new Error(`No debug session(s) found with name '${e}'.`);
    for (let o of n) await g.debug.stopDebugging(o);
  },
  le = async t => {
    let { sessionId: e, breakpointConfig: n } = t,
      o = b.find(l => l.id === e);
    if ((o || (o = b.find(l => l.name.includes(e))), !o))
      return {
        content: [
          { type: 'text', text: `No debug session found with ID '${e}'.` },
        ],
        isError: !0,
      };
    if (n) {
      if (n.disableExisting) {
        let l = g.debug.breakpoints;
        l.length > 0 && g.debug.removeBreakpoints(l);
      }
      if (n.breakpoints && n.breakpoints.length > 0) {
        let l =
          o.workspaceFolder?.uri.fsPath ||
          g.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!l)
          throw new Error(
            'Cannot determine workspace folder for breakpoint paths'
          );
        let c = n.breakpoints.map(p => {
          let i = w.isAbsolute(p.path) ? p.path : w.join(l, p.path),
            u = g.Uri.file(i),
            m = new g.Position(p.line - 1, 0);
          return new g.SourceBreakpoint(
            new g.Location(u, m),
            !0,
            p.condition,
            p.hitCondition,
            p.logMessage
          );
        });
        g.debug.addBreakpoints(c);
      }
    }
    s.appendLine(`Resuming debug session '${o.name}' (ID: ${e})`);
    let r = J({ sessionName: o.name });
    await o.customRequest('continue', { threadId: 0 });
    let a = await r;
    if (a.reason === 'terminated')
      throw new Error(
        `Debug session '${o.name}' terminated before hitting a breakpoint.`
      );
    return await f.getDebugContext(a.session, a.threadId);
  };
var q = class {
  async invoke(e) {
    let { sessionId: n, breakpointConfig: o } = e.input;
    try {
      let r = await le({ sessionId: n, breakpointConfig: o });
      return new R.LanguageModelToolResult([
        new R.LanguageModelTextPart(JSON.stringify(r, null, 2)),
      ]);
    } catch (r) {
      return new R.LanguageModelToolResult([
        new R.LanguageModelTextPart(
          `Error resuming debug session: ${r instanceof Error ? r.message : String(r)}`
        ),
      ]);
    }
  }
  prepareInvocation(e) {
    return {
      invocationMessage: `Resuming debug session '${e.input.sessionId}'${e.input.waitForStop ? ' and waiting for breakpoint' : ''}`,
    };
  }
};
var de = T(require('vscode')),
  M = require('vscode');
var U = class {
  async invoke(e) {
    let {
        workspaceFolder: n,
        variableFilter: o,
        timeoutSeconds: r,
        configurationName: a,
        breakpointConfig: l,
      } = e.input,
      c = de.workspace.getConfiguration('copilot-debugger'),
      p = a || c.get('defaultLaunchConfiguration');
    if (!p)
      return new M.LanguageModelToolResult([
        new M.LanguageModelTextPart(
          'Error: No launch configuration specified. Set "copilot-debugger.defaultLaunchConfiguration" in settings or provide configurationName parameter.'
        ),
      ]);
    let i = await se({
      workspaceFolder: n,
      nameOrConfiguration: p,
      variableFilter: o,
      timeoutSeconds: r,
      breakpointConfig: l,
      sessionName: '',
    });
    return new M.LanguageModelToolResult([
      new M.LanguageModelTextPart(JSON.stringify(i, null, 2)),
    ]);
  }
};
var V = require('vscode');
var W = class {
  async invoke(e) {
    let { sessionName: n } = e.input;
    try {
      let o = await ie({ sessionName: n });
      return new V.LanguageModelToolResult([
        new V.LanguageModelTextPart(JSON.stringify(o)),
      ]);
    } catch (o) {
      return new V.LanguageModelToolResult([
        new V.LanguageModelTextPart(
          `Error stopping debug session: ${o instanceof Error ? o.message : String(o)}`
        ),
      ]);
    }
  }
  prepareInvocation(e) {
    return {
      invocationMessage: `Stopping debug session(s) named '${e.input.sessionName}'`,
    };
  }
};
function Se(t) {
  Te(t);
}
function Te(t) {
  t.subscriptions.push(
    E.lm.registerTool('start_debugger_with_breakpoints', new U()),
    E.lm.registerTool('resume_debug_session', new q()),
    E.lm.registerTool('get_variables', new H()),
    E.lm.registerTool('expand_variable', new B()),
    E.lm.registerTool('evaluate_expression', new A()),
    E.lm.registerTool('stop_debug_session', new W())
  );
}
function ye() {}
0 && (module.exports = { activate, deactivate });
