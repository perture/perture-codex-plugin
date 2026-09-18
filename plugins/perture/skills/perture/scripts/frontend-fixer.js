const fs = require("node:fs");
const path = require("node:path");
const { checkSources } = require("./frontend-checker");

const MAX_REPAIR_FILE_BYTES = 2 * 1024 * 1024;
const SUPPORTED_RULES = new Set([
  "frontend.color.approved_only",
  "frontend.font.approved_only",
  "frontend.typography.weight.approved_only",
  "frontend.spacing.token_only",
  "frontend.radius.token_only"
]);

function frontendContract(contractInput) {
  const contract = contractInput?.frontend_contract || contractInput;
  if (!contract || typeof contract.contract_version !== "string") {
    throw new Error("Invalid frontend contract: contract_version is missing.");
  }
  return contract;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function uniqueNumbers(values) {
  return [...new Set(values.filter(Number.isFinite))].sort((left, right) => left - right);
}

function closestNumber(value, allowed) {
  return allowed.reduce((closest, candidate) => {
    const distance = Math.abs(candidate - value);
    const closestDistance = Math.abs(closest - value);
    return distance < closestDistance || (distance === closestDistance && candidate < closest)
      ? candidate
      : closest;
  });
}

function normalizeHex(value) {
  const match = String(value || "").trim().toLowerCase().match(/^#([0-9a-f]{3,8})$/i);
  if (!match) return "";
  let hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    hex = hex.split("").map((character) => character + character).join("");
  }
  if (hex.length === 8) hex = hex.slice(0, 6);
  return hex.length === 6 ? `#${hex}` : "";
}

function approvedColors(contract) {
  const colors = [];
  for (const token of contract.tokens?.colors || []) {
    const normalized = normalizeHex(token?.value);
    if (normalized && !colors.some((item) => item.normalized === normalized)) {
      colors.push({ normalized, value: String(token.value) });
    }
  }
  const focus = normalizeHex(contract.tokens?.focus_ring?.color);
  if (focus && !colors.some((item) => item.normalized === focus)) {
    colors.push({ normalized: focus, value: String(contract.tokens.focus_ring.color) });
  }
  return colors.sort((left, right) => left.normalized.localeCompare(right.normalized));
}

function approvedFontFamilies(contract) {
  return uniqueStrings((contract.tokens?.typography || []).map((item) => item?.family));
}

function approvedFontWeights(contract) {
  const values = [];
  for (const family of contract.tokens?.typography || []) values.push(...(family?.weights || []));
  for (const role of contract.brand_contract?.typography?.roles || []) values.push(role?.weight);
  for (const component of contract.components || []) values.push(component?.visual?.font_weight?.value);
  return uniqueStrings(values
    .map((value) => String(value || "").trim().toLowerCase())
    .map((value) => value === "normal" ? "400" : value === "bold" ? "700" : value)
    .filter((value) => /^\d{3}$/.test(value)));
}

function contractCheck(contract, ruleId) {
  return (contract.checks || []).find((item) => item?.id === ruleId) || null;
}

function brandRule(contract, ruleId) {
  if (!ruleId) return null;
  return (contract.brand_contract?.rules || []).find((item) => item?.id === ruleId) || null;
}

function lineRange(source, line) {
  if (!Number.isInteger(line) || line < 1) return null;
  let start = 0;
  for (let current = 1; current < line; current += 1) {
    const next = source.indexOf("\n", start);
    if (next === -1) return null;
    start = next + 1;
  }
  const newline = source.indexOf("\n", start);
  const end = newline === -1 ? source.length : newline;
  return { start, end };
}

function sourceRangeForFinding(source, finding) {
  const current = String(finding.current_value || "");
  const range = lineRange(source, Number(finding.line));
  if (!current || !range) return { reason: "missing_exact_source_value" };
  const column = Number(finding.column);
  const anchor = Number.isInteger(column) && column > 0
    ? Math.min(range.end, range.start + column - 1)
    : range.start;

  if (source.slice(anchor, anchor + current.length) === current) {
    return { start: anchor, end: anchor + current.length };
  }

  const matches = [];
  let cursor = range.start;
  while (cursor <= range.end - current.length) {
    const index = source.indexOf(current, cursor);
    if (index === -1 || index + current.length > range.end) break;
    matches.push(index);
    cursor = index + Math.max(1, current.length);
  }
  if (matches.length !== 1) {
    return { reason: matches.length ? "ambiguous_source_match" : "source_value_changed" };
  }
  return { start: matches[0], end: matches[0] + current.length };
}

function hasNonOpaqueAlpha(value) {
  const rgba = String(value || "").match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/i);
  if (rgba) return Number(rgba[1]) !== 1;
  const hex = String(value || "").trim().match(/^#([0-9a-f]{4}|[0-9a-f]{8})$/i);
  if (!hex) return false;
  const alpha = hex[1].length === 4 ? hex[1].slice(3) + hex[1].slice(3) : hex[1].slice(6);
  return parseInt(alpha, 16) !== 255;
}

function formatFamily(family, current) {
  const quote = /^(['"`]).*\1$/.exec(current.trim())?.[1] || "";
  if (quote) return `${quote}${family}${quote}`;
  const pieces = current.split(",").map((item) => item.trim()).filter(Boolean);
  const generic = new Set([
    "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
    "ui-sans-serif", "ui-serif", "ui-monospace"
  ]);
  const fallbacks = pieces.filter((item) => generic.has(item.replace(/^['"`]|['"`]$/g, "").toLowerCase()));
  const formatted = /\s/.test(family) ? `"${family}"` : family;
  return [formatted, ...fallbacks].join(", ");
}

function replacementFor(contract, finding) {
  if (!finding.fixable) return { reason: "not_marked_fixable" };
  if (finding.severity !== "error" || finding.kind !== "deterministic") {
    return { reason: "only_deterministic_errors_are_eligible" };
  }
  if (!SUPPORTED_RULES.has(finding.rule_id)) return { reason: "unsupported_repair_strategy" };
  const check = contractCheck(contract, finding.rule_id);
  if (!check || check.enforcement !== "local_static" || !check.autofix) {
    return { reason: "contract_does_not_authorize_local_autofix" };
  }
  const rule = brandRule(contract, finding.brand_rule_id);
  if (rule && rule.autofix?.safe_by_default !== true) {
    return { reason: "brand_rule_requires_manual_choice" };
  }

  if (finding.rule_id === "frontend.spacing.token_only" || finding.rule_id === "frontend.radius.token_only") {
    const current = /^(-?\d+(?:\.\d+)?)px$/i.exec(String(finding.current_value || "").trim());
    if (!current) return { reason: "unsupported_numeric_value" };
    const allowed = uniqueNumbers(
      finding.rule_id === "frontend.spacing.token_only"
        ? contract.tokens?.spacing?.allowed_px || []
        : contract.tokens?.radius?.allowed_px || []
    );
    if (!allowed.length) return { reason: "approved_scale_missing" };
    const replacement = `${closestNumber(Number(current[1]), allowed)}px`;
    return {
      replacement,
      strategy: finding.rule_id === "frontend.spacing.token_only"
        ? "replace_with_nearest_spacing_token"
        : "replace_with_nearest_radius_token"
    };
  }

  if (finding.rule_id === "frontend.color.approved_only") {
    const colors = approvedColors(contract);
    if (colors.length !== 1) return { reason: "approved_color_choice_is_ambiguous" };
    if (hasNonOpaqueAlpha(finding.current_value)) return { reason: "color_alpha_semantics_are_ambiguous" };
    return { replacement: colors[0].value, strategy: "replace_with_only_approved_color" };
  }

  if (finding.rule_id === "frontend.font.approved_only") {
    const families = approvedFontFamilies(contract);
    if (families.length !== 1) return { reason: "approved_font_choice_is_ambiguous" };
    return {
      replacement: formatFamily(families[0], String(finding.current_value || "")),
      strategy: "replace_with_only_approved_font"
    };
  }

  if (finding.rule_id === "frontend.typography.weight.approved_only") {
    const weights = approvedFontWeights(contract);
    if (weights.length !== 1) return { reason: "approved_weight_choice_is_ambiguous" };
    return { replacement: weights[0], strategy: "replace_with_only_approved_weight" };
  }

  return { reason: "unsupported_repair_strategy" };
}

function repairRecord(finding, status, reason, extra = {}) {
  return {
    finding_id: finding?.id || null,
    rule_id: finding?.rule_id || null,
    brand_rule_id: finding?.brand_rule_id || null,
    file: finding?.file || null,
    line: finding?.line || null,
    column: finding?.column || null,
    status,
    reason,
    strategy: extra.strategy || null,
    current_value: finding?.current_value ?? null,
    replacement_value: extra.replacement ?? null
  };
}

function planRepairs(contractInput, sources, baseline, options = {}) {
  const contract = frontendContract(contractInput);
  const sourceMap = new Map(sources.map((item) => [item.file, item.source]));
  const requestedIds = uniqueStrings(options.findingIds || []);
  const allSafe = options.allSafe === true;
  if (allSafe === Boolean(requestedIds.length)) {
    throw new Error("Select exactly one repair mode: --finding-ids or --all-safe.");
  }

  const findingsById = new Map((baseline.findings || []).map((finding) => [finding.id, finding]));
  const selected = allSafe
    ? (baseline.findings || []).filter((finding) => finding.fixable === true)
    : requestedIds.map((id) => findingsById.get(id)).filter(Boolean);
  const repairs = [];
  if (!allSafe) {
    for (const id of requestedIds) {
      if (!findingsById.has(id)) {
        repairs.push(repairRecord({ id }, "skipped", "finding_not_present_in_current_baseline"));
      }
    }
  }

  const editsByFile = new Map();
  for (const finding of selected) {
    if (!finding.file || !sourceMap.has(finding.file)) {
      repairs.push(repairRecord(finding, "skipped", "finding_outside_authorized_source_scope"));
      continue;
    }
    const replacement = replacementFor(contract, finding);
    if (!replacement.replacement) {
      repairs.push(repairRecord(finding, "skipped", replacement.reason));
      continue;
    }
    const range = sourceRangeForFinding(sourceMap.get(finding.file), finding);
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
      repairs.push(repairRecord(finding, "skipped", range.reason));
      continue;
    }
    const edits = editsByFile.get(finding.file) || [];
    if (edits.some((edit) => range.start < edit.end && range.end > edit.start)) {
      repairs.push(repairRecord(finding, "skipped", "overlapping_repair_conflict"));
      continue;
    }
    edits.push({ ...range, finding, ...replacement });
    editsByFile.set(finding.file, edits);
  }

  const repairedSources = sources.map((item) => {
    const edits = (editsByFile.get(item.file) || []).sort((left, right) => right.start - left.start);
    let source = item.source;
    for (const edit of edits) {
      source = `${source.slice(0, edit.start)}${edit.replacement}${source.slice(edit.end)}`;
      repairs.push(repairRecord(edit.finding, "planned", "deterministic_replacement", edit));
    }
    return { file: item.file, source };
  });

  repairs.sort((left, right) =>
    String(left.file || "").localeCompare(String(right.file || "")) ||
    Number(left.line || 0) - Number(right.line || 0) ||
    String(left.finding_id || "").localeCompare(String(right.finding_id || ""))
  );
  return {
    repairs,
    sources: repairedSources,
    changed_files: repairedSources
      .filter((item) => item.source !== sourceMap.get(item.file))
      .map((item) => item.file)
  };
}

function predictedRepairIntroducesErrors(baseline, predicted) {
  return Number(predicted.summary?.errors || 0) > Number(baseline.summary?.errors || 0);
}

function assertSafeRepairPath(cwd, relativeFile) {
  const root = fs.realpathSync(path.resolve(cwd));
  const absolute = path.resolve(root, relativeFile);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to repair a file outside the repository: ${relativeFile}`);
  }
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Refusing to repair a symbolic link: ${relativeFile}`);
  if (!stat.isFile()) throw new Error(`Repair target is not a file: ${relativeFile}`);
  if (stat.size > MAX_REPAIR_FILE_BYTES) throw new Error(`Repair target exceeds 2 MB: ${relativeFile}`);
  const real = fs.realpathSync(absolute);
  const realRelative = path.relative(root, real);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error(`Refusing to repair a resolved path outside the repository: ${relativeFile}`);
  }
  return absolute;
}

function applyRepairSources(cwd, originalSources, repairedSources, changedFiles) {
  const originals = new Map(originalSources.map((item) => [item.file, item.source]));
  const repairs = new Map(repairedSources.map((item) => [item.file, item.source]));
  const targets = changedFiles.map((file) => ({
    absolute: assertSafeRepairPath(cwd, file),
    file,
    original: originals.get(file),
    repaired: repairs.get(file)
  }));
  for (const target of targets) {
    if (fs.readFileSync(target.absolute, "utf8") !== target.original) {
      throw new Error(`Repair target changed after validation: ${target.file}`);
    }
  }
  const written = [];
  try {
    for (const target of targets) {
      fs.writeFileSync(target.absolute, target.repaired, "utf8");
      written.push(target);
    }
  } catch (error) {
    for (const target of written.reverse()) {
      try {
        fs.writeFileSync(target.absolute, target.original, "utf8");
      } catch {
        // The caller receives the original write failure and must inspect the named scope.
      }
    }
    throw error;
  }
}

function buildRepairReport(contractInput, sources, repository, options = {}) {
  const contract = frontendContract(contractInput);
  const baseline = checkSources(contract, sources, { repository, requireRepository: true });
  const plan = planRepairs(contract, sources, baseline, options);
  const predicted = checkSources(contract, plan.sources, { repository, requireRepository: true });
  const blockers = [];
  if (baseline.coverage.completeness !== "complete" || baseline.coverage.repository_intelligence !== "ready") {
    blockers.push("complete_repository_coverage_required");
  }
  if (predictedRepairIntroducesErrors(baseline, predicted)) blockers.push("predicted_repair_introduces_errors");
  return {
    repair_protocol_version: "1.0",
    contract_version: contract.contract_version,
    baseline,
    plan,
    predicted,
    blockers
  };
}

module.exports = {
  MAX_REPAIR_FILE_BYTES,
  applyRepairSources,
  buildRepairReport,
  planRepairs,
  replacementFor
};
