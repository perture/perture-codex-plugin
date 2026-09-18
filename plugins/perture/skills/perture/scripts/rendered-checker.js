#!/usr/bin/env node

const path = require("node:path");
const { createRequire } = require("node:module");

const DEFAULT_VIEWPORTS = [
  { name: "desktop", width: 1440, height: 960 },
  { name: "mobile", width: 390, height: 844 }
];
const DEVICE_SCALE_FACTOR = 2;
const EPSILON = 0.75;

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function contractBody(input) {
  return input?.frontend_contract?.brand_contract || input?.brand_contract || input;
}

function frontendBody(input) {
  return input?.frontend_contract || input;
}

function validateLoopbackUrl(value) {
  const parsed = new URL(String(value || ""));
  const hostname = parsed.hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error("Rendered validation only accepts a loopback URL (localhost or 127.0.0.1).");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("Rendered validation requires an HTTP(S) URL.");
  return parsed.toString();
}

function loadPlaywright(cwd) {
  const candidates = [
    () => createRequire(path.join(cwd, "package.json"))("playwright"),
    () => require("playwright")
  ];
  for (const candidate of candidates) {
    try {
      const loaded = candidate();
      if (loaded?.chromium) return loaded;
    } catch {
      // Try the next local runtime. Perture never downloads or installs a browser here.
    }
  }
  throw new Error("Playwright is required in the target repository to verify rendered brand fidelity.");
}

function normalizedFamily(value) {
  return String(value || "").split(",")[0].trim().replace(/^['\"]|['\"]$/g, "").toLowerCase();
}

function normalizedWeight(value) {
  const labels = { normal: "400", medium: "500", semibold: "600", bold: "700" };
  const text = String(value || "").trim().toLowerCase();
  return labels[text] || text;
}

function numericCss(value) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function roleCandidates(role) {
  const normalized = String(role || "").toLowerCase();
  if (/title|headline|heading|display/.test(normalized)) return ["h1", "h2", "h3", "[role=heading]", "[data-perture-role=title]"];
  if (/caption|subtext|label|eyebrow/.test(normalized)) return ["small", "figcaption", "[data-perture-role=caption]", ".caption", ".eyebrow"];
  return ["p", "li", "[data-perture-role=body]", "main", "body"];
}

function roleExpected(role) {
  return {
    family: normalizedFamily(role.family),
    weight: normalizedWeight(role.weight),
    size: typeof role.size?.value === "number" ? role.size.value : null,
    sizeUnit: String(role.size?.unit || "px").toLowerCase(),
    lineHeight: numericCss(role.line_height),
    letterSpacing: numericCss(role.letter_spacing)
  };
}

function expectedPixels(value, unit, rootSize = 16) {
  if (typeof value !== "number") return null;
  if (unit === "rem" || unit === "em") return value * rootSize;
  return value;
}

function colorToHex(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "transparent" || text === "rgba(0, 0, 0, 0)") return null;
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  const rgb = text.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
  if (!rgb) return null;
  return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
}

function finding({ id, severity = "error", category, ruleId, brandRuleId = null, viewport, message, suggestion, evidence }) {
  return {
    id,
    rule_id: ruleId,
    brand_rule_id: brandRuleId,
    severity,
    category,
    kind: "rendered",
    file: "[rendered interface]",
    line: 1,
    column: 1,
    viewport,
    message,
    suggestion,
    evidence
  };
}

function relevantRuleId(frontend, id) {
  return frontend?.checks?.find((check) => check.id === id)?.brand_rule_ids?.[0] || null;
}

function logoRule(contract, logo, fragment) {
  return contract.rules?.find((rule) =>
    rule.source?.source_id === logo.asset_id && rule.source?.path?.includes(fragment)
  )?.id || null;
}

async function inspectViewport(page, contract, frontend, viewport) {
  const roles = contract.typography?.roles || [];
  const logos = contract.assets?.logos || [];
  const approvedColors = unique((contract.colors?.tokens || []).map((token) => String(token.value || "").toLowerCase()));
  const iconReferences = contract.references?.iconography || [];
  const expectedIconPrefixes = unique(iconReferences.map((item) => item.library?.prefix));
  const interfaceRoleRequirements = frontend?.generation_enforcement?.applicability?.roles || [];
  const data = await page.evaluate(({ roleSelectors, logoHints, iconPrefixes, interfaceRoleRequirements }) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const rectFor = (element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const roleSamples = roleSelectors.map(({ role, selectors }) => {
      const elements = [...document.querySelectorAll(selectors.join(","))].filter(visible).slice(0, 12);
      return {
        role,
        samples: elements.map((element) => {
          const style = getComputedStyle(element);
          return {
            selector: element.tagName.toLowerCase(),
            text: String(element.textContent || "").trim().slice(0, 80),
            family: style.fontFamily,
            weight: style.fontWeight,
            size: Number.parseFloat(style.fontSize),
            lineHeight: style.lineHeight === "normal" ? null : Number.parseFloat(style.lineHeight),
            letterSpacing: style.letterSpacing === "normal" ? 0 : Number.parseFloat(style.letterSpacing)
          };
        })
      };
    });
    const images = [...document.images].filter(visible).map((image) => ({
      alt: image.alt,
      className: String(image.className || ""),
      id: image.id,
      src: image.currentSrc || image.src,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      rect: rectFor(image),
      transform: getComputedStyle(image).transform,
      filter: getComputedStyle(image).filter,
      objectFit: getComputedStyle(image).objectFit
    }));
    const allVisible = [...document.querySelectorAll("body *")].filter(visible);
    const logoCandidates = allVisible.filter((element) => {
      const descriptor = `${element.id} ${element.className || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("data-asset-id") || ""}`.toLowerCase();
      if (descriptor.includes("logo")) return true;
      if (element instanceof HTMLImageElement) {
        const src = (element.currentSrc || element.src).toLowerCase();
        return logoHints.some((hint) => hint && src.includes(hint));
      }
      return false;
    }).slice(0, 24).map((element) => {
      const rect = rectFor(element);
      const style = getComputedStyle(element);
      const neighbors = allVisible.filter((candidate) => {
        if (candidate === element || candidate.contains(element) || element.contains(candidate)) return false;
        const candidateRect = candidate.getBoundingClientRect();
        if (candidateRect.width < 2 || candidateRect.height < 2) return false;
        const candidateStyle = getComputedStyle(candidate);
        return candidateStyle.position !== "fixed" && candidateStyle.position !== "absolute";
      }).map((candidate) => {
        const other = candidate.getBoundingClientRect();
        const dx = Math.max(rect.left - other.right, other.left - rect.right, 0);
        const dy = Math.max(rect.top - other.bottom, other.top - rect.bottom, 0);
        const overlapsX = other.right > rect.left && other.left < rect.right;
        const overlapsY = other.bottom > rect.top && other.top < rect.bottom;
        const distance = overlapsX ? dy : overlapsY ? dx : Math.hypot(dx, dy);
        return { distance, tag: candidate.tagName.toLowerCase() };
      }).filter((item) => Number.isFinite(item.distance)).sort((a, b) => a.distance - b.distance);
      return {
        tag: element.tagName.toLowerCase(),
        src: element instanceof HTMLImageElement ? element.currentSrc || element.src : "",
        assetId: element.getAttribute("data-asset-id") || "",
        rect,
        nearestDistance: neighbors[0]?.distance ?? null,
        transform: style.transform,
        filter: style.filter
      };
    });
    const unicodePattern = /[\u2190-\u21ff\u2794-\u27bf\u2605\u2606\u2713\u2714\u2715\u2716\u271a\uff0b\u2212\u00d7\u00f7]/u;
    const unicodeIcons = allVisible.filter((element) => {
      if (!element.matches("button, a, [role=button], [aria-hidden=true]")) return false;
      const text = String(element.textContent || "").trim();
      return text.length <= 4 && unicodePattern.test(text);
    }).slice(0, 20).map((element) => String(element.textContent || "").trim().slice(0, 12));
    const svgIcons = allVisible.filter((element) => element instanceof SVGElement && element.tagName.toLowerCase() === "svg").slice(0, 100).map((element) => ({
      className: element.getAttribute("class") || "",
      dataIcon: element.getAttribute("data-icon") || "",
      title: element.getAttribute("aria-label") || ""
    }));
    const controls = allVisible.filter((element) => element.matches("button, input, select, textarea, [role=button]")).slice(0, 80).map((element) => {
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        height: element.getBoundingClientRect().height,
        radius: Number.parseFloat(style.borderRadius) || 0,
        text: String(element.textContent || "").trim().slice(0, 12)
      };
    });
    const interfaceRoles = interfaceRoleRequirements.map((requirement) => {
      const selectors = Array.isArray(requirement.rendered_selectors) ? requirement.rendered_selectors.filter(Boolean) : [];
      const allowedIds = Array.isArray(requirement.component_ids) ? requirement.component_ids.map(String) : [];
      const elements = selectors.length ? [...document.querySelectorAll(selectors.join(","))].filter(visible) : [];
      const instances = elements.map((element) => {
        const owner = element.closest("[data-perture-component-id]");
        const componentId = owner?.getAttribute("data-perture-component-id") || "";
        return {
          componentId,
          governed: Boolean(componentId && allowedIds.includes(componentId)),
          tag: element.tagName.toLowerCase()
        };
      });
      return {
        role: String(requirement.role || "unknown"),
        allowedIds,
        total: instances.length,
        governed: instances.filter((instance) => instance.governed).length,
        ungoverned: instances.filter((instance) => !instance.governed).length,
        invalidIds: [...new Set(instances.map((instance) => instance.componentId).filter((id) => id && !allowedIds.includes(id)))],
        renderedIds: [...new Set(instances.map((instance) => instance.componentId).filter((id) => allowedIds.includes(id)))]
      };
    });
    const colorSamples = allVisible.filter((element) => element.matches("body, main, section, header, footer, button, a, p, h1, h2, h3, input, [role=button]")).slice(0, 180).flatMap((element) => {
      const style = getComputedStyle(element);
      return [style.color, style.backgroundColor, style.borderTopColor, style.fill, style.stroke];
    });
    return {
      rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
      fontsReady: document.fonts.status === "loaded",
      loadedFontFamilies: [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family.replace(/^['\"]|['\"]$/g, "").toLowerCase()),
      roleSamples,
      images,
      logoCandidates,
      unicodeIcons,
      svgIcons,
      controls,
      interfaceRoles,
      colorSamples,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      expectedIconPrefixes: iconPrefixes
    };
  }, {
    roleSelectors: roles.map((role) => ({ role: role.role, selectors: roleCandidates(role.role) })),
    logoHints: logos.flatMap((logo) => [logo.asset_id, logo.file_name, logo.url ? String(logo.url).split("/").pop() : ""]).filter(Boolean).map((item) => String(item).toLowerCase()),
    iconPrefixes: expectedIconPrefixes,
    interfaceRoleRequirements
  });
  const interactiveTexts = await page.locator("button, a, [role=button], [aria-hidden=true]").allTextContents();

  const findings = [];
  for (const role of data.interfaceRoles) {
    if (role.ungoverned > 0) findings.push(finding({
      id: `rendered.component.interface_system.${role.role}.${viewport.name}`,
      severity: "error",
      category: "component",
      ruleId: "frontend.component.interface_system_rendered_bypass",
      viewport: viewport.name,
      message: `${role.ungoverned} rendered ${role.role} instance(s) do not originate from an approved Interface System component assigned to that role.`,
      suggestion: `Use one of the approved ${role.role} components: ${role.allowedIds.join(", ")}.`,
      evidence: `${role.governed}/${role.total} governed; invalid ids: ${role.invalidIds.join(", ") || "none"}`
    }));
  }
  if (!data.fontsReady) findings.push(finding({
    id: `rendered.fonts.not_ready.${viewport.name}`, severity: "error", category: "typography",
    ruleId: "frontend.rendered.typography", viewport: viewport.name,
    message: "The browser did not finish loading the declared fonts.",
    suggestion: "Wait for document.fonts.ready and make the approved font files available before rendering.", evidence: "document.fonts.status was not loaded"
  }));
  for (const role of roles) {
    const samples = data.roleSamples.find((item) => item.role === role.role)?.samples || [];
    const expected = roleExpected(role);
    const requiresApprovedFontAsset = Boolean(role.font_asset_id || role.font_file_name || role.font_file_url);
    if (requiresApprovedFontAsset && expected.family && !data.loadedFontFamilies.includes(expected.family)) {
      findings.push(finding({
        id: `rendered.font.asset.${role.role}.${viewport.name}`, severity: "error", category: "typography",
        ruleId: "frontend.font.asset_traceability", viewport: viewport.name,
        message: `The approved font asset for ${role.role} is not loaded in the rendered document.`,
        suggestion: `Load the exact approved ${role.font_file_name || expected.family} font face before rendering.`,
        evidence: `${expected.family} absent from loaded document FontFace entries`
      }));
    }
    if (!samples.length) continue;
    for (const sample of samples) {
      const mismatches = [];
      if (expected.family && normalizedFamily(sample.family) !== expected.family) mismatches.push(`family ${sample.family}`);
      if (expected.weight && normalizedWeight(sample.weight) !== expected.weight) mismatches.push(`weight ${sample.weight}`);
      const expectedSize = expectedPixels(expected.size, expected.sizeUnit, data.rootFontSize);
      if (expectedSize !== null && Math.abs(sample.size - expectedSize) > EPSILON) mismatches.push(`size ${sample.size}px`);
      if (expected.lineHeight !== null) {
        const expectedLineHeight = expected.lineHeight <= 3 ? sample.size * expected.lineHeight : expected.lineHeight;
        if (sample.lineHeight !== null && Math.abs(sample.lineHeight - expectedLineHeight) > EPSILON) mismatches.push(`line-height ${sample.lineHeight}px`);
      }
      if (expected.letterSpacing !== null && Math.abs(sample.letterSpacing - expected.letterSpacing) > EPSILON) mismatches.push(`letter-spacing ${sample.letterSpacing}px`);
      if (mismatches.length) findings.push(finding({
        id: `rendered.typography.${role.role}.${viewport.name}.${findings.length}`, severity: "error", category: "typography",
        ruleId: "frontend.rendered.typography", brandRuleId: relevantRuleId(frontend, "frontend.rendered.typography"), viewport: viewport.name,
        message: `${role.role} typography does not match the saved role: ${mismatches.join(", ")}.`,
        suggestion: `Apply the exact saved family, weight, size, line-height and letter-spacing for ${role.role}.`,
        evidence: `${sample.selector}: ${sample.text}`
      }));
    }
  }

  if (data.horizontalOverflow > 1) findings.push(finding({
    id: `rendered.layout.overflow.${viewport.name}`, severity: "error", category: "layout", ruleId: "frontend.rendered.responsive", viewport: viewport.name,
    message: `The page overflows horizontally by ${Math.round(data.horizontalOverflow)}px.`, suggestion: "Fix responsive widths at this viewport.", evidence: `${viewport.width}x${viewport.height}`
  }));

  const rasterImages = data.images.filter((image) => !/\.svg(?:\?|$)/i.test(image.src));
  for (const image of rasterImages) {
    if (image.naturalWidth + 1 < image.rect.width * DEVICE_SCALE_FACTOR || image.naturalHeight + 1 < image.rect.height * DEVICE_SCALE_FACTOR) {
      findings.push(finding({
        id: `rendered.asset.raster_upscale.${viewport.name}.${findings.length}`, severity: "error", category: "asset", ruleId: "frontend.asset.raster_quality", viewport: viewport.name,
        message: "A raster asset is being enlarged beyond its native resolution at the required 2x density.",
        suggestion: "Use the original SVG or a raster file with at least twice the rendered dimensions.",
        evidence: `${image.naturalWidth}x${image.naturalHeight} rendered at ${Math.round(image.rect.width)}x${Math.round(image.rect.height)} CSS px`
      }));
    }
    if (image.transform !== "none" || image.filter !== "none") findings.push(finding({
      id: `rendered.asset.transformed.${viewport.name}.${findings.length}`, severity: "warning", category: "imagery", ruleId: "frontend.asset.raster_quality", viewport: viewport.name,
      message: "A raster brand asset is rendered with a transform or filter that can change its approved appearance.",
      suggestion: "Render the approved asset without visual filters or geometric transforms unless the contract explicitly permits them.",
      evidence: `transform=${image.transform}; filter=${image.filter}`
    }));
  }

  const renderedUnicodeIcons = unique([
    ...data.unicodeIcons,
    ...data.controls.map((control) => control.text),
    ...interactiveTexts
  ].map((text) => String(text || "").trim()).filter((text) =>
    text.length <= 4 && /[←-⇿➔-➿★☆✓✔✕✖✚＋−×÷]/u.test(text)
  ));
  if (renderedUnicodeIcons.length && expectedIconPrefixes.length) findings.push(finding({
    id: `rendered.icon.unicode.${viewport.name}`, severity: "error", category: "iconography", ruleId: "frontend.asset.unicode_icon.forbidden", viewport: viewport.name,
    message: "Unicode glyphs are being used as interface icons instead of the saved icon library.",
    suggestion: `Replace them with icons from ${expectedIconPrefixes.join(", ")}.`, evidence: renderedUnicodeIcons.join(" ")
  }));
  if (expectedIconPrefixes.length && data.svgIcons.length) {
    const mismatched = data.svgIcons.filter((icon) => {
      const descriptor = `${icon.className} ${icon.dataIcon}`.toLowerCase();
      if (!descriptor.trim()) return false;
      return !expectedIconPrefixes.some((prefix) => descriptor.includes(`${prefix}:`) || descriptor.includes(`${prefix}-`) || descriptor.includes(`icon-${prefix}`));
    });
    if (mismatched.length) findings.push(finding({
      id: `rendered.icon.family.${viewport.name}`, severity: "error", category: "iconography", ruleId: "frontend.asset.icon_family", viewport: viewport.name,
      message: "Rendered interface icons include a family other than the one saved in Perture.",
      suggestion: `Use only the saved ${expectedIconPrefixes.join(", ")} library or the exact custom icon assets.`, evidence: `${mismatched.length} mismatched SVG icon(s)`
    }));
  }

  for (const logo of logos) {
    const hints = [logo.asset_id, logo.file_name, logo.url ? String(logo.url).split("/").pop() : ""].filter(Boolean).map((item) => String(item).toLowerCase());
    const candidates = data.logoCandidates.filter((candidate) => hints.some((hint) => `${candidate.src} ${candidate.assetId}`.toLowerCase().includes(hint)));
    for (const candidate of candidates) {
      if (candidate.transform !== "none" || candidate.filter !== "none") findings.push(finding({
        id: `rendered.logo.transform.${logo.asset_id}.${viewport.name}`, severity: "error", category: "asset", ruleId: "frontend.logo.official_asset",
        brandRuleId: logoRule(contract, logo, "forbidden_transform"), viewport: viewport.name,
        message: `The official ${logo.slot} logo is visually transformed.`, suggestion: "Render the exact official asset without filters or transforms.",
        evidence: `transform=${candidate.transform}; filter=${candidate.filter}`
      }));
      if (typeof logo.minimum_size?.value === "number") {
        const minimum = expectedPixels(logo.minimum_size.value, String(logo.minimum_size.unit || "px").toLowerCase(), data.rootFontSize);
        if (minimum !== null && Math.min(candidate.rect.width, candidate.rect.height) + EPSILON < minimum) findings.push(finding({
          id: `rendered.logo.minimum.${logo.asset_id}.${viewport.name}`, severity: "error", category: "asset", ruleId: "frontend.logo.minimum_size",
          brandRuleId: logoRule(contract, logo, "minimum_size"), viewport: viewport.name,
          message: `The ${logo.slot} logo is smaller than its saved minimum size.`, suggestion: `Render it at no less than ${logo.minimum_size.value}${logo.minimum_size.unit}.`,
          evidence: `${Math.round(candidate.rect.width)}x${Math.round(candidate.rect.height)} CSS px`
        }));
      }
      if (typeof logo.clear_space?.value === "number" && candidate.nearestDistance !== null) {
        const reference = String(logo.clear_space.reference || "").toLowerCase();
        const basis = /height|logo size|symbol|mark/.test(reference) ? candidate.rect.height : candidate.rect.width;
        const required = logo.clear_space.value * basis;
        if (candidate.nearestDistance + EPSILON < required) findings.push(finding({
          id: `rendered.logo.clearspace.${logo.asset_id}.${viewport.name}`, severity: "error", category: "spacing", ruleId: "frontend.logo.clear_space",
          brandRuleId: logoRule(contract, logo, "clear_space"), viewport: viewport.name,
          message: `The ${logo.slot} logo does not preserve its saved clear space.`, suggestion: `Keep at least ${logo.clear_space.value}x ${logo.clear_space.reference} around every side.`,
          evidence: `${Math.round(candidate.nearestDistance)}px measured; ${Math.round(required)}px required`
        }));
      }
    }
  }

  const allowedControlHeights = contract.interaction?.control_heights_px || [];
  if (allowedControlHeights.length) {
    for (const control of data.controls) {
      if (!allowedControlHeights.some((value) => Math.abs(Number(value) - control.height) <= EPSILON)) findings.push(finding({
        id: `rendered.component.control_height.${viewport.name}.${findings.length}`, severity: "warning", category: "component", ruleId: "frontend.component.control_height", viewport: viewport.name,
        message: `A rendered ${control.tag} has a height outside the saved control scale.`, suggestion: `Use one of: ${allowedControlHeights.join(", ")}px.`, evidence: `${Math.round(control.height)}px`
      }));
    }
  }

  const observedColors = unique(data.colorSamples.map(colorToHex));
  const disallowedColors = observedColors.filter((color) => approvedColors.length && !approvedColors.includes(color));
  if (disallowedColors.length) findings.push(finding({
    id: `rendered.color.unapproved.${viewport.name}`, severity: "warning", category: "color", ruleId: "frontend.color.literal", viewport: viewport.name,
    message: "Rendered interface colors include values outside the saved brand palette.", suggestion: "Map these values to approved semantic color tokens or document a contextual exception.",
    evidence: disallowedColors.slice(0, 12).join(", ")
  }));

  return {
    findings,
    categories: ["asset", "brand", "color", "component", "iconography", "imagery", "layout", "spacing", "typography"],
    metrics: {
      images_checked: data.images.length,
      logos_detected: data.logoCandidates.length,
      typography_samples: data.roleSamples.reduce((sum, item) => sum + item.samples.length, 0),
      controls_checked: data.controls.length,
      overflow_px: Math.max(0, data.horizontalOverflow),
      icon_prefixes_expected: expectedIconPrefixes
    },
    interfaceSystem: {
      rendered_component_ids: unique(data.interfaceRoles.flatMap((role) => role.renderedIds)),
      required_roles: unique(data.interfaceRoles.filter((role) => role.total > 0).map((role) => role.role)),
      ungoverned_instances: data.interfaceRoles.reduce((sum, role) => sum + role.ungoverned, 0)
    }
  };
}

async function runRenderedCheck({ contract: input, cwd, url, viewports = DEFAULT_VIEWPORTS }) {
  const targetUrl = validateLoopbackUrl(url);
  const contract = contractBody(input);
  const frontend = frontendBody(input);
  const playwright = loadPlaywright(cwd);
  const browser = await playwright.chromium.launch({ headless: true });
  const findings = [];
  const results = [];
  const renderedComponentIds = new Set();
  const requiredRoles = new Set();
  let ungovernedInstances = 0;
  const runtimeErrors = [];
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: DEVICE_SCALE_FACTOR
      });
      const page = await context.newPage();
      page.on("console", (message) => {
        if (message.type() === "error") runtimeErrors.push(`${viewport.name}: ${message.text().slice(0, 240)}`);
      });
      page.on("pageerror", (error) => runtimeErrors.push(`${viewport.name}: ${String(error.message || error).slice(0, 240)}`));
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(100);
      const result = await inspectViewport(page, contract, frontend, viewport);
      findings.push(...result.findings);
      for (const id of result.interfaceSystem.rendered_component_ids) renderedComponentIds.add(id);
      for (const role of result.interfaceSystem.required_roles) requiredRoles.add(role);
      ungovernedInstances += result.interfaceSystem.ungoverned_instances;
      results.push({ ...viewport, ...result.metrics });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  for (const [index, error] of runtimeErrors.entries()) findings.push(finding({
    id: `rendered.runtime.${index}`, severity: "error", category: "component", ruleId: "frontend.rendered.runtime", viewport: error.split(":")[0],
    message: "The rendered page emitted a runtime or console error.", suggestion: "Resolve the runtime error before brand verification.", evidence: error
  }));
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  return {
    status: errors ? "not_verified" : warnings ? "verified_with_warnings" : "verified",
    passed: errors === 0,
    device_scale_factor: DEVICE_SCALE_FACTOR,
    viewports_checked: results,
    categories_evaluated: ["asset", "brand", "color", "component", "iconography", "imagery", "layout", "spacing", "typography"],
    interface_system: {
      rendered_component_ids: [...renderedComponentIds].sort(),
      required_roles: [...requiredRoles].sort(),
      ungoverned_instances: ungovernedInstances,
      status: ungovernedInstances === 0 ? "verified" : "not_verified"
    },
    summary: { errors, warnings, suggestions: 0 },
    findings
  };
}

module.exports = { DEFAULT_VIEWPORTS, DEVICE_SCALE_FACTOR, runRenderedCheck, validateLoopbackUrl };
