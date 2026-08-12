import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function safeBaseUrl() {
  const raw = process.env.PERTURE_INTEGRATION_API_BASE_URL || "https://app.perture.co/api/integrations/v1";
  const url = new URL(raw);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("Perture correction gateway requires HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

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

function requestHeaders(token, hasBody = false) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Perture-Platform": "codex",
    "X-Request-Id": crypto.randomUUID(),
    ...(hasBody ? { "Content-Type": "application/json" } : {})
  };
}

async function gateway(token, pathname, options = {}) {
  const response = await fetch(`${safeBaseUrl()}${pathname}`, {
    ...options,
    headers: requestHeaders(token, Boolean(options.body))
  });
  const text = await response.text();
  let value = null;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  if (!response.ok) return null;
  return value;
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function belongsToWorkspace(job, cwd) {
  const files = Array.isArray(job?.log?.files_changed) ? job.log.files_changed : [];
  if (!files.length) return false;
  return files.some((file) => {
    if (typeof file !== "string" || !file.trim()) return false;
    const candidate = path.resolve(cwd, file);
    return pathInside(cwd, candidate) && fs.existsSync(candidate);
  });
}

function trim(value, max = 4_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function contextFor(job, input) {
  const log = job.log;
  const findings = Array.isArray(log.findings) && log.findings.length
    ? log.findings.map((finding) => {
        const location = finding.file ? ` — ${finding.file}${finding.line ? `:${finding.line}` : ""}` : "";
        return `- [${finding.severity}/${finding.status}] ${finding.rule_id}${location}: ${finding.message}${finding.evidence ? ` Evidence: ${finding.evidence}` : ""}`;
      })
    : ["- No findings were recorded; inspect the failed or stale step before changing code."];
  const files = Array.isArray(log.files_changed) && log.files_changed.length
    ? log.files_changed.map((file) => `- ${file}`)
    : ["- No files were recorded."];
  const pluginRoot = process.env.PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT || "${PLUGIN_ROOT}";
  const adapter = path.join(pluginRoot, "scripts", "perture-integration.mjs");

  return [
    "PERTURE MANUAL CORRECTION REQUEST",
    "The signed-in user explicitly clicked Send to coding agent for this log. This authorizes only the scoped repository correction below; it does not authorize publishing, deployment, unrelated refactors, or destructive actions.",
    "Start the correction in this turn. Before editing, mark the job in_progress through the Perture adapter. Use the existing Perture frontend generation protocol, run the returned deterministic local check, and verify again.",
    "When verification passes, mark the job resolved with a concise resolution_summary. If deterministic verification returns manual_review_required, report that exact status instead. On an unrecoverable execution error, mark failed. Do not mark resolved based only on typecheck or visual inspection.",
    "Use a temporary JSON body file for status updates; never put the Perture token on the command line.",
    `Adapter: node \"${adapter}\" --operation update-correction --job ${job.id} --body-file <status.json>`,
    `Status body examples: {\"status\":\"in_progress\",\"session_id\":\"${trim(input.session_id, 240)}\",\"cwd\":${JSON.stringify(trim(input.cwd, 1000))}} and {\"status\":\"resolved\",\"resolution_summary\":\"What was fixed and revalidated\"}`,
    "",
    `Job: ${job.id}`,
    `Project: ${log.project_name} (${log.project_id})`,
    `Original log: ${log.id}`,
    `Change: ${log.change_id}`,
    `Contract: ${log.contract_version}`,
    `Result: ${log.result}`,
    `Attempt: ${log.attempt}`,
    `Summary: ${log.summary}`,
    `Route: ${log.route_hint || "—"}`,
    `Framework: ${log.framework || "—"}`,
    "",
    "Open findings:",
    ...findings,
    "",
    "Affected files:",
    ...files
  ].join("\n");
}

async function main() {
  const input = await readHookInput();
  const token = process.env.PERTURE_ACCESS_TOKEN || process.env.PERTURE_INTEGRATION_TOKEN || "";
  const cwd = path.resolve(trim(input.cwd, 1_000) || process.cwd());
  const hookEventName = input.hook_event_name === "UserPromptSubmit" ? "UserPromptSubmit" : "SessionStart";
  if (!token) return;

  const payload = await gateway(token, "/corrections");
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const pending = jobs.find((job) => belongsToWorkspace(job, cwd));
  if (!pending) return;

  const claimed = await gateway(token, `/corrections/${encodeURIComponent(pending.id)}/claim`, {
    method: "POST",
    body: JSON.stringify({ cwd, session_id: trim(input.session_id, 240) || null })
  });
  const job = claimed?.job;
  if (!job || job.status !== "delivered") return;

  process.stdout.write(JSON.stringify({
    continue: true,
    systemMessage: `Perture sent a correction request for ${job.log.project_name}.`,
    hookSpecificOutput: {
      hookEventName,
      additionalContext: contextFor(job, { ...input, cwd })
    }
  }));
}

main().catch(() => {
  // Correction delivery is best-effort and must never block a Codex session.
});
