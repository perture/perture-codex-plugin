const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const FRONTEND_EXTENSIONS = new Set([
  ".css", ".scss", ".sass", ".less", ".html", ".htm",
  ".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte"
]);
const FINDING_CATEGORIES = new Set([
  "color", "typography", "spacing", "layout", "component", "asset", "iconography", "imagery", "brand", "shape", "brand-rule"
]);
const FINDING_SEVERITIES = new Set(["error", "warning", "suggestion"]);
const ICON_PACKAGE_PATTERNS = [
  "@fortawesome/fontawesome-svg-core",
  "@fortawesome/free-solid-svg-icons",
  "@heroicons/react",
  "@iconify/react",
  "@mui/icons-material",
  "@phosphor-icons/react",
  "@tabler/icons-react",
  "lucide-react",
  "react-icons"
];

const ICON_PREFIX_PACKAGES = {
  lucide: ["lucide-react", "@iconify/react"],
  "material-symbols": ["@mui/icons-material", "@iconify/react"],
  ph: ["@phosphor-icons/react", "react-icons", "@iconify/react"],
  tabler: ["@tabler/icons-react", "@iconify/react"],
  heroicons: ["@heroicons/react", "@iconify/react"],
  fa7: ["@fortawesome/fontawesome-svg-core", "@fortawesome/free-solid-svg-icons", "react-icons", "@iconify/react"],
  "fa7-solid": ["@fortawesome/fontawesome-svg-core", "@fortawesome/free-solid-svg-icons", "react-icons", "@iconify/react"],
  custom: []
};

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

function rgbToHex(red, green, blue) {
  const values = [red, green, blue].map((value) => Math.max(0, Math.min(255, Number(value))));
  if (values.some((value) => !Number.isFinite(value))) return "";
  return `#${values.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

function locationFor(source, index) {
  const before = source.slice(0, index);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function closestNumber(value, allowed) {
  if (!allowed.length) return null;
  return allowed.reduce((closest, candidate) =>
    Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest
  );
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right)));
}

function compactExpected(values, suffix = "") {
  const normalized = uniqueSorted(values.map((value) => String(value)));
  const selected = normalized.slice(0, 24).map((value) => `${value}${suffix}`);
  return `${selected.join(", ")}${normalized.length > selected.length ? ", …" : ""}`;
}

function normalizeCssValue(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .toLowerCase();
}

function maskComments(source) {
  const output = [...String(source || "")];
  let mode = "code";
  let escaped = false;
  for (let index = 0; index < output.length; index += 1) {
    const character = output[index];
    const next = output[index + 1];
    if (mode === "line_comment") {
      if (character === "\n" || character === "\r") mode = "code";
      else output[index] = " ";
      continue;
    }
    if (mode === "block_comment") {
      if (character === "*" && next === "/") {
        output[index] = " ";
        output[index + 1] = " ";
        index += 1;
        mode = "code";
      } else if (character !== "\n" && character !== "\r") {
        output[index] = " ";
      }
      continue;
    }
    if (mode !== "code") {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (
        (mode === "single_quote" && character === "'") ||
        (mode === "double_quote" && character === '"') ||
        (mode === "template" && character === "`")
      ) mode = "code";
      continue;
    }
    if (character === "/" && next === "/") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 1;
      mode = "line_comment";
      continue;
    }
    if (character === "/" && next === "*") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 1;
      mode = "block_comment";
      continue;
    }
    if (character === "'") mode = "single_quote";
    else if (character === '"') mode = "double_quote";
    else if (character === "`") mode = "template";
  }
  return output.join("");
}

function contractChecks(contract) {
  return Array.isArray(contract.checks) ? contract.checks : [];
}

function contractCheck(contract, ruleId) {
  return contractChecks(contract).find((item) => item && item.id === ruleId) || null;
}

function brandRules(contract) {
  return Array.isArray(contract.brand_contract?.rules) ? contract.brand_contract.rules : [];
}

function matchingBrandRule(contract, predicate) {
  return brandRules(contract).find((rule) => rule && predicate(rule)) || null;
}

function ruleSeverity(contract, ruleId, fallback = "warning") {
  const severity = contractCheck(contract, ruleId)?.severity;
  return FINDING_SEVERITIES.has(severity) ? severity : fallback;
}

function ruleCategory(contract, ruleId, fallback = "brand-rule") {
  const category = contractCheck(contract, ruleId)?.category;
  return FINDING_CATEGORIES.has(category) ? category : fallback;
}

function ruleKind(contract, ruleId, fallback = "contextual") {
  const kind = contractCheck(contract, ruleId)?.kind;
  return kind === "deterministic" || kind === "contextual" ? kind : fallback;
}

function findingId(finding) {
  return `fnd_${crypto.createHash("sha1")
    .update([
      finding.rule_id,
      finding.brand_rule_id,
      finding.file,
      finding.line,
      finding.column,
      finding.current_value,
      finding.expected_value,
      finding.evidence
    ].join("|"))
    .digest("hex")
    .slice(0, 12)}`;
}

function pushFinding(findings, contract, input) {
  const severity = input.severity || ruleSeverity(contract, input.rule_id);
  const finding = {
    rule_id: input.rule_id,
    brand_rule_id: input.brand_rule_id || null,
    severity: FINDING_SEVERITIES.has(severity) ? severity : "warning",
    category: FINDING_CATEGORIES.has(input.category)
      ? input.category
      : ruleCategory(contract, input.rule_id),
    kind: input.kind === "deterministic" || input.kind === "contextual"
      ? input.kind
      : ruleKind(contract, input.rule_id),
    file: input.file,
    line: input.line,
    column: input.column,
    message: input.message,
    evidence: String(input.evidence || "").slice(0, 240),
    current_value: input.current_value === undefined || input.current_value === null
      ? null
      : String(input.current_value).slice(0, 240),
    expected_value: input.expected_value === undefined || input.expected_value === null
      ? null
      : String(input.expected_value).slice(0, 500),
    fixable: input.fixable === true,
    suggestion: input.suggestion || null
  };
  findings.push({ id: findingId(finding), ...finding });
}

function approvedColors(contract) {
  const values = [];
  for (const color of contract.tokens?.colors || []) values.push(color.value);
  values.push(contract.tokens?.focus_ring?.color);
  const elevation = contract.tokens?.elevation || {};
  for (const shadow of Object.values(elevation)) {
    const text = String(shadow || "");
    for (const match of text.matchAll(/#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi)) values.push(match[0]);
    for (const match of text.matchAll(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/gi)) {
      values.push(rgbToHex(match[1], match[2], match[3]));
    }
  }
  return new Set(values.map(normalizeHex).filter(Boolean));
}

function repositoryTokenSources(repository) {
  return new Set((repository?.guidance?.token_sources || []).map((value) => String(value).replace(/\\/g, "/")));
}

function colorBrandRuleId(contract) {
  return matchingBrandRule(contract, (rule) =>
    rule.category === "color" && rule.level === "hard" && rule.enforcement === "local_static"
  )?.id || null;
}

function checkApprovedColorTokenSuggestion(contract, repository, file, source, index, literal, findings) {
  const tokenSources = repositoryTokenSources(repository);
  if (!tokenSources.size || tokenSources.has(file)) return;
  const location = locationFor(source, index);
  pushFinding(findings, contract, {
    rule_id: "frontend.color.prefer_token_reference",
    severity: "suggestion",
    category: "color",
    kind: "contextual",
    file,
    ...location,
    evidence: literal,
    current_value: literal,
    expected_value: "existing project color token",
    fixable: false,
    message: "This approved color is referenced as a raw literal outside a detected token source.",
    suggestion: "Prefer the repository's existing semantic color token when an unambiguous mapping exists."
  });
}

function checkColors(contract, repository, file, source, findings) {
  const allowed = approvedColors(contract);
  if (!allowed.size) return;
  const expected = compactExpected([...allowed]);
  const brandRuleId = colorBrandRuleId(contract);
  for (const match of source.matchAll(/#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi)) {
    const normalized = normalizeHex(match[0]);
    if (!normalized) continue;
    const index = match.index || 0;
    if (allowed.has(normalized)) {
      checkApprovedColorTokenSuggestion(contract, repository, file, source, index, match[0], findings);
      continue;
    }
    const location = locationFor(source, index);
    pushFinding(findings, contract, {
      rule_id: "frontend.color.approved_only",
      brand_rule_id: brandRuleId,
      severity: "error",
      category: "color",
      kind: "deterministic",
      file,
      ...location,
      evidence: match[0],
      current_value: match[0],
      expected_value: expected,
      fixable: true,
      message: `${match[0]} is not an approved project color.`,
      suggestion: "Replace it with an approved color token from the frontend contract."
    });
  }
  for (const match of source.matchAll(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)[^)]*\)/gi)) {
    const normalized = rgbToHex(match[1], match[2], match[3]);
    if (!normalized) continue;
    const index = match.index || 0;
    if (allowed.has(normalized)) {
      checkApprovedColorTokenSuggestion(contract, repository, file, source, index, match[0], findings);
      continue;
    }
    const location = locationFor(source, index);
    pushFinding(findings, contract, {
      rule_id: "frontend.color.approved_only",
      brand_rule_id: brandRuleId,
      severity: "error",
      category: "color",
      kind: "deterministic",
      file,
      ...location,
      evidence: match[0],
      current_value: match[0],
      expected_value: expected,
      fixable: true,
      message: `${match[0]} is not derived from an approved project color.`,
      suggestion: "Replace it with an approved color token; retain alpha only when the token permits it."
    });
  }
}

function approvedFontWeights(contract) {
  const weights = [];
  for (const family of contract.tokens?.typography || []) weights.push(...(family.weights || []));
  for (const role of contract.brand_contract?.typography?.roles || []) weights.push(role.weight);
  for (const component of contract.components || []) weights.push(component.visual?.font_weight?.value);
  return new Set(weights
    .map((value) => String(value || "").trim().toLowerCase())
    .map((value) => value === "normal" ? "400" : value === "bold" ? "700" : value)
    .filter((value) => /^\d{3}$/.test(value)));
}

function checkFonts(contract, file, source, findings) {
  const allowed = new Set((contract.tokens?.typography || [])
    .map((item) => String(item.family || "").trim().toLowerCase())
    .filter(Boolean));
  const typographyRuleId = matchingBrandRule(contract, (rule) =>
    rule.category === "typography" && rule.level === "hard" && rule.enforcement === "local_static"
  )?.id || null;
  if (allowed.size) {
    const generic = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "inherit", "initial", "unset"]);
    const expression = /(?:font-family\s*:|fontFamily\s*:)[\s]*([^;}\n]+)/gi;
    for (const match of source.matchAll(expression)) {
      const declaration = String(match[1] || "").trim().replace(/,$/, "");
      if (!declaration || /var\s*\(/i.test(declaration)) continue;
      const families = declaration
        .split(",")
        .map((value) => value.trim().replace(/^['"`]|['"`]$/g, "").toLowerCase())
        .filter(Boolean);
      if (families.some((family) => allowed.has(family)) || families.every((family) => generic.has(family))) continue;
      const location = locationFor(source, match.index || 0);
      pushFinding(findings, contract, {
        rule_id: "frontend.font.approved_only",
        brand_rule_id: typographyRuleId,
        severity: "error",
        category: "typography",
        kind: "deterministic",
        file,
        ...location,
        evidence: declaration,
        current_value: declaration,
        expected_value: compactExpected([...allowed]),
        fixable: true,
        message: "Font declaration does not include an approved project family.",
        suggestion: `Use one of: ${[...allowed].join(", ")}.`
      });
    }
  }

  const allowedWeights = approvedFontWeights(contract);
  if (!allowedWeights.size) return;
  for (const match of source.matchAll(/(?:font-weight\s*:|fontWeight\s*:)[\s]*([^;}\n,]+)/gi)) {
    const raw = String(match[1] || "").trim().replace(/^['"`]|['"`]$/g, "").toLowerCase();
    if (!raw || /var\s*\(|inherit|initial|unset|lighter|bolder/i.test(raw)) continue;
    const normalized = raw === "normal" ? "400" : raw === "bold" ? "700" : raw;
    if (!/^\d{3}$/.test(normalized) || allowedWeights.has(normalized)) continue;
    const location = locationFor(source, match.index || 0);
    pushFinding(findings, contract, {
      rule_id: "frontend.typography.weight.approved_only",
      severity: "error",
      category: "typography",
      kind: "deterministic",
      file,
      ...location,
      evidence: match[0],
      current_value: raw,
      expected_value: compactExpected([...allowedWeights]),
      fixable: true,
      message: `${raw} is not an approved typography or component weight.`,
      suggestion: "Use the weight saved for the applicable typography role or approved component."
    });
  }

  const approvedFileNames = uniqueSorted((contract.brand_contract?.typography?.families || [])
    .flatMap((family) => family.file_names || [])
    .map((value) => path.basename(String(value)).toLowerCase()));
  if (approvedFileNames.length) {
    for (const block of cssBlocks(source)) {
      if (!/@font-face/i.test(block.selector)) continue;
      for (const match of block.body.matchAll(/\bsrc\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
        const sourceUrl = String(match[1] || "").split(/[?#]/)[0];
        if (!sourceUrl || /^data:/i.test(sourceUrl)) continue;
        const fileName = path.basename(sourceUrl).toLowerCase();
        if (approvedFileNames.includes(fileName)) continue;
        const location = locationFor(source, block.body_index + (match.index || 0));
        pushFinding(findings, contract, {
          rule_id: "frontend.font.asset_traceability",
          severity: "error",
          category: "typography",
          kind: "deterministic",
          file,
          ...location,
          evidence: match[0],
          current_value: fileName,
          expected_value: compactExpected(approvedFileNames),
          fixable: false,
          message: "@font-face uses a file that is not traceable to an approved Perture font asset.",
          suggestion: "Use the approved font file or preserve its exact approved file name when it is copied locally."
        });
      }
    }
  }

  checkTypographyRoles(contract, file, source, findings);
}

function normalizedWeight(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "normal" ? "400" : raw === "bold" ? "700" : raw;
}

function typographyRoleForSelector(selector) {
  const value = String(selector || "").toLowerCase();
  if (/(?:^|[\s.#:_-])(?:h1|h2|h3|h4|h5|h6|title|heading|headline|hero-title|display)(?:$|[\s.#:_-])/.test(value)) return "title";
  if (/(?:^|[\s.#:_-])(?:caption|eyebrow|kicker|meta|overline|small|footnote|helper|label)(?:$|[\s.#:_-])/.test(value)) return "caption";
  if (/(?:^|[\s.#:_-])(?:body|copy|paragraph|description|summary|lead|lede|supporting|subtitle)(?:$|[\s.#:_-])/.test(value) || /(?:^|[\s>,+~])p(?:$|[\s.#:_-])/.test(value)) return "body";
  return "";
}

function cssDeclaration(body, property) {
  const match = String(body || "").match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;}]+)`, "i"));
  return match?.[1]?.trim() || "";
}

function checkTypographyRoles(contract, file, source, findings) {
  const roles = new Map((contract.brand_contract?.typography?.roles || []).map((role) => [role.role, role]));
  if (!roles.size) return;
  for (const block of cssBlocks(source)) {
    if (/@font-face|@keyframes/i.test(block.selector)) continue;
    const roleName = typographyRoleForSelector(block.selector);
    if (!roleName) continue;
    const role = roles.get(roleName);
    if (!role?.family) continue;
    const checks = [
      {
        property: "font-family",
        actual: cssDeclaration(block.body, "font-family").replace(/["']/g, "").split(",")[0]?.trim(),
        expected: role.family,
        equal: (actual, expected) => String(actual).toLowerCase() === String(expected).toLowerCase()
      },
      {
        property: "font-weight",
        actual: normalizedWeight(cssDeclaration(block.body, "font-weight")),
        expected: normalizedWeight(role.weight),
        equal: (actual, expected) => actual === expected
      },
      {
        property: "font-size",
        actual: cssDeclaration(block.body, "font-size"),
        expected: role.size?.value !== null && role.size?.unit ? `${role.size.value}${role.size.unit}` : "",
        equal: (actual, expected) => normalizeCssValue(actual) === normalizeCssValue(expected)
      },
      {
        property: "line-height",
        actual: cssDeclaration(block.body, "line-height"),
        expected: role.line_height || "",
        equal: (actual, expected) => normalizeCssValue(actual) === normalizeCssValue(expected)
      },
      {
        property: "letter-spacing",
        actual: cssDeclaration(block.body, "letter-spacing"),
        expected: role.letter_spacing || "",
        equal: (actual, expected) => normalizeCssValue(actual) === normalizeCssValue(expected)
      }
    ];
    for (const item of checks) {
      if (!item.actual || !item.expected || /var\s*\(/i.test(item.actual) || item.equal(item.actual, item.expected)) continue;
      const propertyIndex = block.body.search(new RegExp(item.property, "i"));
      const location = locationFor(source, block.body_index + Math.max(0, propertyIndex));
      pushFinding(findings, contract, {
        rule_id: "frontend.typography.role.metrics",
        severity: "error",
        category: "typography",
        kind: "deterministic",
        file,
        ...location,
        evidence: `${block.selector} { ${item.property}: ${item.actual} }`,
        current_value: `${roleName}.${item.property}=${item.actual}`,
        expected_value: `${roleName}.${item.property}=${item.expected}`,
        fixable: true,
        message: `${roleName} typography uses ${item.property} ${item.actual} instead of the saved ${item.expected}.`,
        suggestion: `Use the exact ${roleName} typography role from the Perture contract.`
      });
    }
  }
}

function checkNumericDeclarations(contract, file, source, findings) {
  const spacing = (contract.tokens?.spacing?.allowed_px || []).filter(Number.isFinite);
  const radii = (contract.tokens?.radius?.allowed_px || []).filter(Number.isFinite);
  const expression = /\b(margin(?:-(?:top|right|bottom|left|block|inline))?|padding(?:-(?:top|right|bottom|left|block|inline))?|gap|row-gap|column-gap|border-radius)\s*:\s*([^;}\n]+)/gi;
  for (const match of source.matchAll(expression)) {
    const property = match[1].toLowerCase();
    const isRadius = property === "border-radius";
    const allowed = isRadius ? radii : spacing;
    if (!allowed.length || /var\s*\(|calc\s*\(/i.test(match[2])) continue;
    for (const numeric of String(match[2]).matchAll(/(-?\d+(?:\.\d+)?)px\b/gi)) {
      const value = Number(numeric[1]);
      if (!Number.isFinite(value) || allowed.includes(value)) continue;
      const absoluteIndex = (match.index || 0) + String(match[0]).indexOf(numeric[0]);
      const location = locationFor(source, absoluteIndex);
      const nearest = closestNumber(value, allowed);
      const ruleId = isRadius ? "frontend.radius.token_only" : "frontend.spacing.token_only";
      const brandRuleId = matchingBrandRule(contract, (rule) =>
        rule.level === "hard" && rule.enforcement === "local_static" &&
        rule.category === (isRadius ? "shape" : "spacing")
      )?.id || null;
      pushFinding(findings, contract, {
        rule_id: ruleId,
        brand_rule_id: brandRuleId,
        severity: "error",
        category: isRadius ? "shape" : "spacing",
        kind: "deterministic",
        file,
        ...location,
        evidence: `${property}: ${numeric[0]}`,
        current_value: numeric[0],
        expected_value: compactExpected(allowed, "px"),
        fixable: nearest !== null,
        message: `${numeric[0]} is outside the approved ${isRadius ? "radius" : "spacing"} scale.`,
        suggestion: nearest === null ? null : `Use the nearest approved value (${nearest}px) or its project token.`
      });
    }
  }
}

function checkShape(contract, file, source, findings) {
  const shadows = uniqueSorted(Object.values(contract.tokens?.elevation || {}).map(normalizeCssValue).filter(Boolean));
  if (shadows.length) {
    for (const match of source.matchAll(/\b(?:box-shadow|text-shadow)\s*:\s*([^;}\n]+)/gi)) {
      const raw = String(match[1] || "").trim();
      if (!raw || /var\s*\(/i.test(raw) || shadows.includes(normalizeCssValue(raw))) continue;
      const location = locationFor(source, match.index || 0);
      pushFinding(findings, contract, {
        rule_id: "frontend.shape.shadow.consistency",
        severity: "warning",
        category: "shape",
        kind: "contextual",
        file,
        ...location,
        evidence: match[0],
        current_value: raw,
        expected_value: compactExpected(shadows),
        fixable: false,
        message: "Literal shadow does not match a saved project elevation value.",
        suggestion: "Confirm the intended elevation and use the matching project token when available."
      });
    }
  }

  const borderWidths = uniqueSorted((contract.brand_contract?.shape?.borders || [])
    .map((item) => item?.value)
    .filter((value) => typeof value === "number" && Number.isFinite(value)));
  if (!borderWidths.length) return;
  for (const match of source.matchAll(/\b(?:border(?:-(?:top|right|bottom|left))?(?:-width)?|outline-width)\s*:\s*([^;}\n]+)/gi)) {
    if (/var\s*\(|calc\s*\(/i.test(match[1])) continue;
    const numeric = String(match[1]).match(/(-?\d+(?:\.\d+)?)px\b/i);
    if (!numeric) continue;
    const value = Number(numeric[1]);
    if (!Number.isFinite(value) || borderWidths.includes(value)) continue;
    const location = locationFor(source, match.index || 0);
    pushFinding(findings, contract, {
      rule_id: "frontend.shape.border_width.consistency",
      severity: "warning",
      category: "shape",
      kind: "contextual",
      file,
      ...location,
      evidence: match[0],
      current_value: `${value}px`,
      expected_value: compactExpected(borderWidths, "px"),
      fixable: false,
      message: `${value}px is not a border width used by an approved component.`,
      suggestion: "Confirm component anatomy before replacing it with a saved border-width token."
    });
  }
}

function cssBlocks(source) {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    body: match[2],
    body_index: (match.index || 0) + String(match[0]).indexOf(match[2]),
    selector: String(match[1] || "").trim()
  }));
}

function checkControls(contract, file, source, findings) {
  const allowed = (contract.tokens?.control_height?.allowed_px || []).filter(Number.isFinite);
  if (!allowed.length) return;
  const controlSelector = /(?:^|[\s.#:\[>,+~_-])(?:button|input|select|textarea|control|field|trigger|toggle|switch)(?:$|[\s.#:\[>,+~_-])/i;
  for (const block of cssBlocks(source)) {
    if (!controlSelector.test(block.selector)) continue;
    for (const match of block.body.matchAll(/\b(?:height|min-height)\s*:\s*(-?\d+(?:\.\d+)?)px\b/gi)) {
      const value = Number(match[1]);
      if (!Number.isFinite(value) || allowed.includes(value)) continue;
      const absoluteIndex = block.body_index + (match.index || 0);
      const location = locationFor(source, absoluteIndex);
      pushFinding(findings, contract, {
        rule_id: "frontend.control.height.consistency",
        severity: "warning",
        category: "component",
        kind: "contextual",
        file,
        ...location,
        evidence: `${block.selector} { ${match[0]} }`,
        current_value: `${value}px`,
        expected_value: compactExpected(allowed, "px"),
        fixable: false,
        message: `A likely control uses ${value}px instead of a saved control height.`,
        suggestion: "Confirm the selector represents a standard control before applying the appropriate control-height token."
      });
    }
  }
}

function authoredGridColumns(contract) {
  const values = [];
  for (const grid of contract.brand_contract?.layout?.grids || []) {
    const match = String(grid?.columns || "").match(/\d+/);
    if (match) values.push(Number(match[0]));
  }
  return uniqueSorted(values.filter((value) => Number.isFinite(value)));
}

function checkLayout(contract, file, source, findings) {
  const allowed = authoredGridColumns(contract);
  if (!allowed.length) return;
  const brandRuleId = matchingBrandRule(contract, (rule) => rule.category === "layout")?.id || null;
  for (const match of source.matchAll(/grid-template-columns\s*:\s*repeat\(\s*(\d+)\s*,/gi)) {
    const columns = Number(match[1]);
    if (!Number.isFinite(columns) || allowed.includes(columns)) continue;
    const location = locationFor(source, match.index || 0);
    pushFinding(findings, contract, {
      rule_id: "frontend.layout.grid_columns.consistency",
      brand_rule_id: brandRuleId,
      severity: "warning",
      category: "layout",
      kind: "contextual",
      file,
      ...location,
      evidence: match[0],
      current_value: String(columns),
      expected_value: compactExpected(allowed),
      fixable: false,
      message: `${columns} explicit grid columns do not match an authored Perture grid.`,
      suggestion: "Confirm the route and breakpoint context before changing the grid definition."
    });
  }
}

function componentNames(source) {
  const names = [];
  const expressions = [
    /export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Z][A-Za-z0-9]*)/g,
    /export\s+(?:default\s+)?class\s+([A-Z][A-Za-z0-9]*)/g,
    /export\s+(?:const|let|var)\s+([A-Z][A-Za-z0-9]*)\s*=/g
  ];
  for (const expression of expressions) {
    for (const match of source.matchAll(expression)) names.push({ index: match.index || 0, name: match[1] });
  }
  return names;
}

function checkComponents(contract, repository, file, source, findings) {
  const primitives = repository?.components?.ui_primitives || [];
  if (!primitives.length) return;
  for (const declared of componentNames(source)) {
    const candidates = primitives.filter((primitive) => {
      const primitivePath = String(primitive.path || "").replace(/\\/g, "/");
      if (!primitive.name || primitivePath === file) return false;
      return declared.name === primitive.name || declared.name.endsWith(primitive.name);
    });
    if (!candidates.length) continue;
    const expected = uniqueSorted(candidates.map((candidate) => `${candidate.name} (${candidate.path})`));
    const location = locationFor(source, declared.index);
    pushFinding(findings, contract, {
      rule_id: "frontend.component.duplicate_primitive",
      severity: "warning",
      category: "component",
      kind: "contextual",
      file,
      ...location,
      evidence: declared.name,
      current_value: declared.name,
      expected_value: compactExpected(expected),
      fixable: false,
      message: `${declared.name} may duplicate an existing repository primitive.`,
      suggestion: "Inspect the existing component and reuse it when behavior, anatomy and variants are compatible."
    });
  }
}

function canonicalIconPackage(value) {
  const source = String(value || "");
  return ICON_PACKAGE_PATTERNS.find((candidate) => source === candidate || source.startsWith(`${candidate}/`)) || "";
}

function importedIconPackages(source) {
  const packages = [];
  for (const match of source.matchAll(/(?:from\s+|require\(\s*)["']([^"']+)["']/g)) {
    const packageName = canonicalIconPackage(match[1]);
    if (packageName) packages.push({ index: match.index || 0, package: packageName });
  }
  return packages;
}

function expectedIconPackages(contract) {
  const iconography = contract.brand_contract?.references?.iconography || [];
  const prefixes = iconography
    .map((item) => String(item?.library?.prefix || "").trim().toLowerCase())
    .filter(Boolean);
  const text = JSON.stringify(iconography).toLowerCase();
  const expected = [];
  for (const prefix of prefixes) {
    const exact = ICON_PREFIX_PACKAGES[prefix];
    if (exact) expected.push(...exact);
    const family = prefix.split("-")[0];
    if (ICON_PREFIX_PACKAGES[family]) expected.push(...ICON_PREFIX_PACKAGES[family]);
  }
  if (/lucide/.test(text)) expected.push("lucide-react");
  if (/heroicon/.test(text)) expected.push("@heroicons/react");
  if (/iconify/.test(text)) expected.push("@iconify/react");
  if (/phosphor/.test(text)) expected.push("@phosphor-icons/react");
  if (/font\s*awesome|fontawesome/.test(text)) expected.push("@fortawesome/fontawesome-svg-core", "@fortawesome/free-solid-svg-icons");
  if (/material/.test(text)) expected.push("@mui/icons-material");
  if (/react[ -]?icons/.test(text)) expected.push("react-icons");
  return uniqueSorted(expected);
}

function explicitCustomIconLibrary(contract) {
  return (contract.brand_contract?.references?.iconography || [])
    .some((item) => item?.library?.is_custom === true || item?.library?.prefix === "custom");
}

function checkAssets(contract, repository, file, source, findings) {
  const noBase64Rule = matchingBrandRule(contract, (rule) =>
    rule.category === "asset" && rule.level === "hard" && rule.enforcement === "local_static" && /base64/i.test(rule.instruction)
  );
  if (noBase64Rule) {
    for (const match of source.matchAll(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi)) {
      const location = locationFor(source, match.index || 0);
      pushFinding(findings, contract, {
        rule_id: "frontend.asset.no_base64",
        brand_rule_id: noBase64Rule.id,
        severity: "error",
        category: "asset",
        kind: "deterministic",
        file,
        ...location,
        evidence: String(match[0]).slice(0, 80),
        current_value: "embedded base64 image",
        expected_value: "official URL or repository asset reference",
        fixable: true,
        message: "A brand asset is embedded as base64, which the Brand Contract forbids.",
        suggestion: "Replace it with an authorized official asset reference; do not copy a signed URL into source."
      });
    }
  }

  const officialAssets = [
    ...(contract.brand_contract?.assets?.logos || []),
    ...(contract.brand_contract?.assets?.illustrations || []),
    ...(contract.brand_contract?.assets?.patterns || []),
    ...(contract.brand_contract?.assets?.additional || [])
  ];
  if (officialAssets.length) {
    for (const match of source.matchAll(/https?:\/\/(?:[^/\s"'`]+\.)?(?:placeholder\.com|placehold\.co|placehold\.it|picsum\.photos)(?:\/[^\s"'`)]+)?/gi)) {
      const location = locationFor(source, match.index || 0);
      pushFinding(findings, contract, {
        rule_id: "frontend.asset.placeholder.avoid",
        severity: "warning",
        category: "asset",
        kind: "contextual",
        file,
        ...location,
        evidence: match[0],
        current_value: match[0],
        expected_value: "approved Perture asset selected by usage context",
        fixable: false,
        message: "A placeholder image service is used while official Perture assets are available.",
        suggestion: "Choose the correct official asset by slot and usage rule; do not guess between ambiguous variants."
      });
    }
  }

  const expected = expectedIconPackages(contract);
  const hasIconography = (contract.brand_contract?.references?.iconography || []).length > 0;
  if (!hasIconography) return;
  const imports = importedIconPackages(source);
  const repositoryPackages = uniqueSorted(repository?.assets?.icons?.packages || []);
  const brandRuleId = matchingBrandRule(contract, (rule) => rule.category === "iconography")?.id || null;
  for (const item of imports) {
    const conflictsWithBrand = explicitCustomIconLibrary(contract) || (expected.length && !expected.includes(item.package));
    const multipleRepositoryFamilies = repositoryPackages.length > 1;
    if (!conflictsWithBrand && !multipleRepositoryFamilies) continue;
    const location = locationFor(source, item.index);
    pushFinding(findings, contract, {
      rule_id: "frontend.asset.icon_family.consistency",
      brand_rule_id: brandRuleId,
      severity: conflictsWithBrand ? "error" : "warning",
      category: "iconography",
      kind: "deterministic",
      file,
      ...location,
      evidence: item.package,
      current_value: item.package,
      expected_value: compactExpected(expected.length ? expected : repositoryPackages),
      fixable: false,
      message: conflictsWithBrand
        ? `${item.package} does not match the saved Perture iconography family.`
        : "Multiple icon packages exist in the repository; this import may continue a split icon system.",
      suggestion: "Reuse the compatible existing icon package and confirm icon semantics before substituting components."
    });
  }


  const unicodeIconPattern = /[←-⇿➔-➿★☆✓✔✕✖✚＋−×÷]/u;
  for (const match of source.matchAll(/>\s*([^<>{}\r\n]{1,4})\s*</g)) {
    const glyph = String(match[1] || "").trim();
    if (!glyph || !unicodeIconPattern.test(glyph)) continue;
    const location = locationFor(source, (match.index || 0) + String(match[0]).indexOf(glyph));
    pushFinding(findings, contract, {
      rule_id: "frontend.asset.unicode_icon.forbidden",
      brand_rule_id: brandRuleId,
      severity: "error",
      category: "iconography",
      kind: "deterministic",
      file,
      ...location,
      evidence: glyph,
      current_value: `Unicode glyph ${glyph}`,
      expected_value: expected.length ? compactExpected(expected) : "saved Perture icon asset",
      fixable: false,
      message: `${glyph} is a Unicode glyph used as an icon while Perture iconography is defined.`,
      suggestion: "Use the semantically matching icon from the saved library or an approved custom SVG asset."
    });
  }

  for (const match of source.matchAll(/<svg\b/gi)) {
    const location = locationFor(source, match.index || 0);
    pushFinding(findings, contract, {
      rule_id: "frontend.asset.inline_svg.traceability",
      brand_rule_id: brandRuleId,
      severity: "warning",
      category: "iconography",
      kind: "contextual",
      file,
      ...location,
      evidence: match[0],
      current_value: "hand-authored inline SVG",
      expected_value: expected.length ? compactExpected(expected) : "approved custom SVG asset",
      fixable: false,
      message: "Inline SVG iconography cannot be traced to the saved Perture icon system.",
      suggestion: "Import the approved icon component or reference the approved SVG asset instead of redrawing it inline."
    });
  }

  for (const block of cssBlocks(source)) {
    if (!/(?:^|[\s.#:_-])(?:img|image|screenshot|preview|mockup|visual|asset)(?:$|[\s.#:_-])/i.test(block.selector)) continue;
    const transform = cssDeclaration(block.body, "transform");
    const filter = cssDeclaration(block.body, "filter");
    const transformed = Boolean(transform) && !/^none$/i.test(transform) && !/^scale\(\s*1(?:\.0+)?\s*\)$/i.test(transform);
    const filtered = Boolean(filter) && !/^none$/i.test(filter);
    if (!transformed && !filtered) continue;
    const location = locationFor(source, block.body_index);
    pushFinding(findings, contract, {
      rule_id: "frontend.asset.raster_quality",
      severity: "warning",
      category: "imagery",
      kind: "contextual",
      file,
      ...location,
      evidence: `${block.selector} { ${[transform ? `transform: ${transform}` : "", filter ? `filter: ${filter}` : ""].filter(Boolean).join("; ")} }`,
      current_value: "visual asset transformed or filtered",
      expected_value: "native-size, unfiltered brand asset unless explicitly approved",
      fixable: false,
      message: "A visual asset is transformed or filtered and requires rendered sharpness verification.",
      suggestion: "Render at DPR 2 and remove scaling or filters when they soften embedded text, icons or brand details."
    });
  }
}

function prohibitedGradientRules(contract) {
  return brandRules(contract).filter((rule) =>
    rule?.level === "hard" &&
    /gradient/i.test(String(rule.instruction || "")) &&
    /\b(?:never|forbidden|prohibited|do not|don't|no gradients?|nunca|proibid|n[aã]o)\b/i.test(String(rule.instruction || ""))
  );
}

function checkBrandRules(contract, file, source, findings) {
  const rules = prohibitedGradientRules(contract);
  if (!rules.length) return;
  for (const match of source.matchAll(/(?:linear|radial|conic|repeating-linear|repeating-radial)-gradient\s*\(/gi)) {
    const location = locationFor(source, match.index || 0);
    for (const rule of rules) {
      pushFinding(findings, contract, {
        rule_id: "frontend.brand_rule.prohibited_gradient",
        brand_rule_id: rule.id,
        severity: "error",
        category: "brand-rule",
        kind: "deterministic",
        file,
        ...location,
        evidence: match[0],
        current_value: match[0],
        expected_value: rule.instruction,
        fixable: false,
        message: "Gradient source violates an explicit hard Perture rule.",
        suggestion: "Remove the gradient only after choosing a brand-approved solid treatment for the same semantic role."
      });
    }
  }
}

function checkImplementationEscapes(contract, file, source, findings) {
  for (const match of source.matchAll(/\bstyle\s*=\s*\{\s*\{/g)) {
    const location = locationFor(source, match.index || 0);
    pushFinding(findings, contract, {
      rule_id: "frontend.inline_style.avoid",
      severity: "warning",
      category: "component",
      kind: "contextual",
      file,
      ...location,
      evidence: match[0],
      current_value: "inline JSX style object",
      expected_value: "project styling layer and approved tokens",
      fixable: false,
      message: "Inline JSX styles bypass shared frontend tokens.",
      suggestion: "Move the style only when its dynamic behavior can be preserved in the project styling layer."
    });
  }
  for (const match of source.matchAll(/\bclass(?:Name)?\s*=\s*["'`][^"'`\n]*\[[^\]\n]+\][^"'`\n]*["'`]/g)) {
    const location = locationFor(source, match.index || 0);
    pushFinding(findings, contract, {
      rule_id: "frontend.tailwind.arbitrary.avoid",
      severity: "warning",
      category: "brand-rule",
      kind: "contextual",
      file,
      ...location,
      evidence: match[0],
      current_value: match[0],
      expected_value: "approved project token or utility",
      fixable: false,
      message: "Arbitrary utility value bypasses the saved project scale.",
      suggestion: "Replace it only when Repository Intelligence identifies an equivalent project token or utility."
    });
  }
}

function coverageFor(contract, repository, requireRepository, sources) {
  const checks = contractChecks(contract);
  const rules = brandRules(contract);
  const repositoryReadiness = repository?.agent_readiness || "not_provided";
  const truncated = repository?.scan?.truncated === true;
  const governedObjects = contract.brand_contract?.governance?.objects || [];
  const objectInventory = uniqueSorted(governedObjects.map((item) => item?.id));
  const sourceEvaluatedObjects = uniqueSorted(governedObjects
    .filter((item) => {
      const methods = Array.isArray(item?.verification_methods) ? item.verification_methods : [];
      return methods.length > 0 && methods.every((method) => method === "local_static");
    })
    .map((item) => item.id));
  const unverified = new Set([
    "rendered_visual_fidelity",
    "responsive_behavior",
    "runtime_component_behavior",
    "component_anatomy_and_states",
    "semantic_color_usage",
    "typography_hierarchy",
    "asset_visual_fidelity"
  ]);
  for (const item of repository?.coverage?.unverified || []) unverified.add(item);
  if (!sources.length) unverified.add("frontend_source_scope");
  if (truncated) unverified.add("repository_scan_truncated");
  if (requireRepository && repositoryReadiness === "not_provided") unverified.add("repository_intelligence");
  if (repositoryReadiness === "best_effort") unverified.add("best_effort_stack_coverage");
  if (repositoryReadiness === "not_ready") unverified.add("unsupported_or_missing_repository_evidence");

  let completeness = "complete";
  if (!sources.length || repositoryReadiness === "not_ready" || (requireRepository && repositoryReadiness === "not_provided")) {
    completeness = "not_ready";
  } else if (truncated || repositoryReadiness === "best_effort") {
    completeness = "partial";
  }

  return {
    completeness,
    repository_intelligence: repositoryReadiness,
    brand_objects: {
      inventory: objectInventory,
      evaluated: sourceEvaluatedObjects,
      unverified: objectInventory.filter((id) => !sourceEvaluatedObjects.includes(id))
    },
    deterministic_rules_evaluated: uniqueSorted(checks
      .filter((check) => check?.enforcement === "local_static")
      .map((check) => check.id)),
    contextual_rules_available: uniqueSorted(checks
      .filter((check) => check?.enforcement === "agent_review")
      .map((check) => check.id)),
    unavailable_rules: uniqueSorted(checks
      .filter((check) => check?.enforcement === "unavailable")
      .map((check) => check.id)),
    brand_rules: {
      local_static_evaluated: uniqueSorted(rules
        .filter((rule) => rule?.enforcement === "local_static" && rule?.verification?.available_in_v1 !== false)
        .map((rule) => rule.id)),
      agent_review_required: uniqueSorted(rules
        .filter((rule) => rule?.enforcement === "agent_review")
        .map((rule) => rule.id)),
      rendered_visual_unverified: uniqueSorted(rules
        .filter((rule) => rule?.enforcement === "rendered_visual")
        .map((rule) => rule.id)),
      unavailable: uniqueSorted(rules
        .filter((rule) => rule?.enforcement === "unavailable")
        .map((rule) => rule.id))
    },
    unverified: uniqueSorted([...unverified])
  };
}

function checkSources(contractInput, sources, options = {}) {
  const contract = contractInput?.frontend_contract || contractInput;
  if (!contract || typeof contract.contract_version !== "string") {
    throw new Error("Invalid frontend contract: contract_version is missing.");
  }
  const repository = options.repository || options.repository_intelligence || null;
  const requireRepository = options.requireRepository === true;
  const findings = [];
  for (const item of sources) {
    const source = maskComments(item.source);
    checkColors(contract, repository, item.file, source, findings);
    checkFonts(contract, item.file, source, findings);
    checkNumericDeclarations(contract, item.file, source, findings);
    checkShape(contract, item.file, source, findings);
    checkControls(contract, item.file, source, findings);
    checkLayout(contract, item.file, source, findings);
    checkComponents(contract, repository, item.file, source, findings);
    checkAssets(contract, repository, item.file, source, findings);
    checkBrandRules(contract, item.file, source, findings);
    checkImplementationEscapes(contract, item.file, source, findings);
  }
  findings.sort((left, right) =>
    String(left.file).localeCompare(String(right.file)) ||
    Number(left.line || 0) - Number(right.line || 0) ||
    left.rule_id.localeCompare(right.rule_id) ||
    left.id.localeCompare(right.id)
  );
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const suggestions = findings.filter((finding) => finding.severity === "suggestion").length;
  const coverage = coverageFor(contract, repository, requireRepository, sources);
  return {
    protocol_version: "1.3",
    contract_version: contract.contract_version,
    passed: errors === 0 && coverage.completeness === "complete",
    files_checked: sources.length,
    scope: { status: sources.length ? "checked" : "empty" },
    summary: { errors, warnings, suggestions, findings: findings.length },
    coverage,
    findings
  };
}

function gitLines(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function discoverFiles(args, cwd) {
  if (args.files) return String(args.files).split(",").map((value) => value.trim()).filter(Boolean);
  if (args.all) return gitLines(["ls-files"], cwd);
  return [...new Set([
    ...gitLines(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"], cwd),
    ...gitLines(["ls-files", "--others", "--exclude-standard"], cwd)
  ])];
}

function loadSources(files, cwd) {
  const root = path.resolve(cwd);
  const sources = [];
  for (const file of files) {
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to inspect a file outside the repository: ${file}`);
    }
    if (!FRONTEND_EXTENSIONS.has(path.extname(absolute).toLowerCase())) continue;
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    sources.push({ file: relative.replace(/\\/g, "/"), source: fs.readFileSync(absolute, "utf8") });
  }
  return sources;
}

module.exports = {
  checkSources,
  discoverFiles,
  loadSources
};
