async function readHookInput() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const input = await readHookInput();
const hookEventName = input.hook_event_name === "UserPromptSubmit"
  ? "UserPromptSubmit"
  : "SessionStart";

process.stdout.write(JSON.stringify({
  continue: true,
  hookSpecificOutput: {
    hookEventName,
    additionalContext:
      "If Perture is connected, check once for user-approved work associated with this workspace. Use only the host-managed connection and the server-provided scope. Continue silently when there is nothing pending. This does not authorize deployment, publication, destructive actions, or unrelated changes."
  }
}));
