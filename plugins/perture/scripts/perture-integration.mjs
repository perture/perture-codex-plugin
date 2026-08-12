import crypto from "node:crypto";
import fs from "node:fs/promises";

const operations = new Set([
  "list-brands",
  "context",
  "reference",
  "frontend-contract",
  "validate",
  "list-corrections",
  "claim-correction",
  "update-correction"
]);

function value(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || "" : "";
}

function usage() {
  console.error("Usage: node perture-integration.mjs --operation <list-brands|context|reference|frontend-contract|validate|list-corrections|claim-correction|update-correction> [--brand <id>] [--job <id>] [--mode <compact|full>] [--body-file <path>]");
}

function safeBaseUrl() {
  const raw = process.env.PERTURE_INTEGRATION_API_BASE_URL || "https://app.perture.co/api/integrations/v1";
  const url = new URL(raw);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("PERTURE_INTEGRATION_API_BASE_URL must use HTTPS, except for localhost development.");
  }
  return url.toString().replace(/\/$/, "");
}

async function main() {
  const args = process.argv.slice(2);
  const operation = value(args, "--operation");
  const token = process.env.PERTURE_ACCESS_TOKEN || process.env.PERTURE_INTEGRATION_TOKEN || "";
  if (!operations.has(operation) || !token) {
    usage();
    if (!token) console.error("Set PERTURE_ACCESS_TOKEN or PERTURE_INTEGRATION_TOKEN in the local environment.");
    process.exitCode = 2;
    return;
  }

  const brand = value(args, "--brand");
  const mode = value(args, "--mode") || "compact";
  const platform = process.env.PERTURE_INTEGRATION_PLATFORM || "codex";
  let path = "/brands";
  let method = "GET";
  let body;

  if (operation === "context") {
    if (!brand) throw new Error("--brand is required for context.");
    path = `/brands/${encodeURIComponent(brand)}/context?mode=${encodeURIComponent(mode)}`;
  } else if (operation === "reference") {
    if (!brand) throw new Error("--brand is required for reference.");
    path = `/brands/${encodeURIComponent(brand)}/reference`;
  } else if (operation === "frontend-contract") {
    if (!brand) throw new Error("--brand is required for frontend-contract.");
    path = `/brands/${encodeURIComponent(brand)}/frontend-contract`;
  } else if (operation === "validate") {
    if (!brand) throw new Error("--brand is required for validate.");
    const bodyFile = value(args, "--body-file");
    if (!bodyFile) throw new Error("--body-file is required for validate.");
    path = `/brands/${encodeURIComponent(brand)}/validate`;
    method = "POST";
    body = await fs.readFile(bodyFile, "utf8");
  } else if (operation === "list-corrections") {
    path = "/corrections";
  } else if (operation === "claim-correction" || operation === "update-correction") {
    const job = value(args, "--job");
    const bodyFile = value(args, "--body-file");
    if (!job) throw new Error("--job is required for correction operations.");
    if (!bodyFile) throw new Error("--body-file is required for correction operations.");
    path = `/corrections/${encodeURIComponent(job)}/${operation === "claim-correction" ? "claim" : "status"}`;
    method = "POST";
    body = await fs.readFile(bodyFile, "utf8");
  }

  const response = await fetch(`${safeBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Perture-Platform": platform,
      "X-Request-Id": crypto.randomUUID(),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body } : {})
  });
  const text = await response.text();
  let output;
  try {
    output = JSON.parse(text);
  } catch {
    output = { error: "Gateway returned a non-JSON response.", status: response.status };
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!response.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Could not call Perture integration gateway.");
  process.exitCode = 1;
});
