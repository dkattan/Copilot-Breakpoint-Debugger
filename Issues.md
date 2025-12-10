Help me fix the following issues:

1. The HTTP request didn't work. I'm not sure if it is because the LLM provided a ._ trigger pattern while the specified launch configuration had a pattern already. This likely triggered the http request before the server was ready. I did not see anything in the logs to indicate that the trigger was hit so I'm unsure if that's because there is no logging for the httpRequest action or if the ._ pattern didn't actually work.
2. When the debugger stops (as a result of action=stopDebugging) there needs to be an indication of the state of the debug session. We should append the debugger state to the output returned by the tool so the LLM knows the state. If the debugger is stopped (as in a breakpoint was hit and it is available for inspection) recommend calling resume_debug_session, get_variables, expand_variable, evaluate_expression, or stop_debug_session. If the debug session is no longer available perhaps because specified action=stopDebugging then recommend calling start_debugger_with_breakpoints again.
3. Include in the output when the serverReady trigger was hit (or specify Not Hit)
4. Include the current time in the output
5. Truncate accumulated debug output when returning tool output
