#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { checkSources, discoverFiles, loadSources } = require("./frontend-checker");
const { applyRepairSources, buildRepairReport } = require("./frontend-fixer");
const { inspectRepository } = require("./repository-inspector");
const { runRenderedCheck } = require("./rendered-checker");
const { inspectInterfaceSources, compareInterfaceInventory, loadInterfaceSourceClosure, sha256 } = require("./interface-provenance");
const { hashBuildOutput } = require("./build-evidence");
const { execFileSync } = require("node:child_process");

const MAX_CONTRACT_BYTES = 5 * 1024 * 1024;
const MAX_INTERFACE_VALIDATION_BYTES = 1024 * 1024;
const REQUIRED_FRONTEND_CONTRACT_PROTOCOL = "1.3";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return flags;
}

async function readStdinJson() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > MAX_CONTRACT_BYTES) throw new Error("Contract stdin exceeded the 5 MB safety limit.");
    chunks.push(chunk);
  }
  const source = Buffer.concat(chunks).toString("utf8").trim();
  if (!source) throw new Error("Contract stdin was empty.");
  return JSON.parse(source);
}

function assertContractCompatibility(contractInput) {
  const contract = contractInput?.frontend_contract || contractInput;
  if (!contract || typeof contract !== "object") {
    throw new Error("A valid Perture Frontend Contract is required.");
  }
  if (
    contract.schema_version !== REQUIRED_FRONTEND_CONTRACT_PROTOCOL ||
    contract?.protocol?.version !== REQUIRED_FRONTEND_CONTRACT_PROTOCOL
  ) {
    throw new Error(
      `Perture Frontend Contract ${REQUIRED_FRONTEND_CONTRACT_PROTOCOL} is required. Reconnect or update Perture before editing; an older contract cannot prove Interface System enforcement.`
    );
  }
  const compatibility = contract.runtime_compatibility;
  if (
    compatibility?.contract_schema_version !== REQUIRED_FRONTEND_CONTRACT_PROTOCOL ||
    compatibility?.local_validator_protocol !== REQUIRED_FRONTEND_CONTRACT_PROTOCOL
  ) {
    throw new Error("The Perture runtime compatibility handshake is missing or stale. Reconnect Perture before editing.");
  }
  if (compatibility.interface_evidence_protocol !== "interface-evidence.v1") throw new Error("The component evidence protocol is missing or stale. Refresh the contract before claiming verification.");
  const enforcement = contract.generation_enforcement;
  const eligibleIds = enforcement?.required_manifest?.eligible_component_ids;
  if (
    enforcement?.mode !== "fail_closed" ||
    !Array.isArray(eligibleIds) ||
    !Array.isArray(enforcement?.applicability?.roles)
  ) {
    throw new Error("The Perture contract does not contain the fail-closed Interface System gate.");
  }
  const requiredTools = Array.isArray(compatibility.required_tools) ? compatibility.required_tools : [];
  if (eligibleIds.length > 0) {
    for (const tool of ["get_interface_component_implementation", "validate_interface_system_usage"]) {
      if (!requiredTools.includes(tool)) {
        throw new Error(`The Perture contract is missing required Interface System capability '${tool}'.`);
      }
    }
  }
  if (Array.isArray(contract.components) && contract.components.length > 0 && eligibleIds.length === 0) {
    throw new Error("The active Interface System contains components but has no eligible verified implementation target.");
  }
  return contractInput;
}

async function loadContract(args, required) {
  let contract = null;
  if (args.contractStdin) contract = await readStdinJson();
  else if (args.contract) contract = JSON.parse(fs.readFileSync(path.resolve(String(args.contract)), "utf8"));
  else if (required) throw new Error("A frontend contract is required. Use --contract-stdin or --contract <file>.");
  return contract ? assertContractCompatibility(contract) : null;
}

function printInspection(report, json) {
  if (json) {
    console.log(JSON.stringify(report));
    return;
  }
  console.log(`Perture repository intelligence: ${report.status}`);
  console.log(`Framework: ${report.stack.framework.primary_framework}`);
  console.log(`Styling: ${report.styling.systems.map((item) => item.label).join(", ") || "not detected"}`);
  console.log(`Reusable components: ${report.components.reusable.length}`);
  console.log(`Brand Contract V2: ${report.brand_contract?.contract_version || "not provided"}`);
  console.log(`Agent readiness: ${report.agent_readiness}`);
  for (const warning of report.warnings) console.log(`WARNING ${warning}`);
}

function printCheck(report, json) {
  if (json) {
    console.log(JSON.stringify(report));
    return;
  }
  console.log(`Perture frontend check: ${report.passed ? "passed" : "failed"}`);
  console.log(`${report.files_checked} files, ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.suggestions} suggestions`);
  console.log(`Coverage: ${report.coverage.completeness}; Repository Intelligence: ${report.coverage.repository_intelligence}`);
  for (const finding of report.findings) {
    console.log(`${finding.severity.toUpperCase()} ${finding.file}:${finding.line}:${finding.column} ${finding.rule_id} - ${finding.message}`);
  }
}

function printRepair(report, json) {
  if (json) {
    console.log(JSON.stringify(report));
    return;
  }
  console.log(`Perture frontend repair: ${report.outcome}`);
  console.log(`Dry run: ${report.dry_run ? "yes" : "no"}; changed files: ${report.changed_files.length}`);
  console.log(`Before: ${report.before.summary.errors} errors, ${report.before.summary.warnings} warnings, ${report.before.summary.suggestions} suggestions`);
  console.log(`After: ${report.after.summary.errors} errors, ${report.after.summary.warnings} warnings, ${report.after.summary.suggestions} suggestions`);
  for (const repair of report.repairs) {
    console.log(`${repair.status.toUpperCase()} ${repair.file || "unknown"}:${repair.line || 0} ${repair.rule_id || repair.finding_id} - ${repair.reason}`);
  }
  for (const blocker of report.blockers) console.log(`BLOCKED ${blocker}`);
}

function verificationReportFor(report) {
  const remoteCategory = (category) => {
    if (category === "iconography" || category === "imagery") return "asset";
    if (category === "brand") return "brand-rule";
    if (category === "interaction") return "component";
    return category;
  };

  return {
    protocol_version: report.protocol_version,
    contract_version: report.contract_version,
    passed: report.passed,
    files_checked: report.files_checked,
    coverage: report.coverage,
    rendered: report.rendered ? {
      status: report.rendered.status,
      passed: report.rendered.passed,
      device_scale_factor: report.rendered.device_scale_factor,
      viewports_checked: report.rendered.viewports_checked,
      categories_evaluated: report.rendered.categories_evaluated,
      evidence_hash: report.rendered.evidence_hash,
      route: report.rendered.route,
      summary: report.rendered.summary
    } : null,
    findings: report.findings.map((finding) => ({
      id: finding.id,
      rule_id: finding.rule_id,
      brand_rule_id: finding.brand_rule_id,
      severity: finding.severity,
      category: remoteCategory(finding.category),
      kind: finding.kind,
      file: finding.file,
      line: finding.line,
      column: finding.column,
      message: finding.message,
      fixable: finding.fixable,
      suggestion: finding.suggestion
    }))
  };
}

function loadObjectReport(args, cwd) {
  if (!args.objectReport) return [];
  const root = path.resolve(cwd);
  const absolute = path.resolve(root, String(args.objectReport));
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The brand object applicability report must stay inside the repository.");
  }
  const parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
  return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.objects) ? parsed.objects : [];
}

function loadInterfaceSystemValidation(args) {
  if (!args.interfaceSystemValidation) return null;
  const absolute = path.resolve(String(args.interfaceSystemValidation));
  const stat = fs.statSync(absolute);
  if (stat.size > MAX_INTERFACE_VALIDATION_BYTES) {
    throw new Error("Interface System validation exceeded the 1 MB safety limit.");
  }
  const parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
  return parsed?.structuredContent || parsed;
}

function normalizedSourcePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function sourceMatchesImmutableArtifact(sources, target) {
  const artifact = target?.artifact;
  const files = Array.isArray(artifact?.files) ? artifact.files : [];
  if (artifact?.kind !== "perture-figma-svg-react" || artifact?.version !== "2" || artifact?.source_fidelity !== "figma-outlined-svg" || !/^[a-f0-9]{64}$/.test(String(artifact?.source_hash || "")) || !Number.isInteger(artifact?.source_variant_count) || artifact.source_variant_count < 1 || !/^[a-f0-9]{64}$/.test(String(artifact?.hash || "")) || !files.length) return false;
  const sourceByPath = new Map(sources.map((item) => [normalizedSourcePath(item?.file), String(item?.source || "")]));
  return files.every((file) => {
    const expected = String(file?.sha256 || "");
    const source = sourceByPath.get(normalizedSourcePath(file?.path));
    return source !== undefined && /^[a-f0-9]{64}$/.test(expected) && crypto.createHash("sha256").update(source, "utf8").digest("hex") === expected;
  });
}

function interfaceSystemFinding(ruleId, message, suggestion) {
  return {
    id: `local:${ruleId}`,
    rule_id: ruleId,
    brand_rule_id: null,
    severity: "error",
    category: "component",
    kind: "deterministic",
    file: null,
    line: null,
    column: null,
    message,
    fixable: false,
    suggestion
  };
}

function attachInterfaceSystemCoverage(report, contractInput, sources, validation, options = {}) {
  const contract = contractInput?.frontend_contract || contractInput;
  const eligibleIds = contract?.generation_enforcement?.required_manifest?.eligible_component_ids || [];
  if (!eligibleIds.length) return report;
  const findings = [...report.findings];
  const validatedManifest = validation?.validated_manifest;
  const manifestHash = validatedManifest
    ? crypto.createHash("sha256").update(JSON.stringify(validatedManifest)).digest("hex")
    : "";
  const usages = Array.isArray(validatedManifest?.usages) ? validatedManifest.usages : [];
  const componentIds = [...new Set((validation?.component_ids || usages.map((usage) => usage?.componentId)).filter(Boolean))].sort();
  const receiptValidShape = validation?.valid === true &&
    (validation?.status === "valid" || validation?.status === "corrected") &&
    validation?.contract_version === contract.contract_version &&
    validation?.interface_system_hash === contract.generation_enforcement.interface_system_hash &&
    manifestHash.length === 64 &&
    typeof validation?.validation_receipt === "string" && validation.validation_receipt.length > 0 &&
    validation?.instances_validated === usages.length && usages.length > 0;
  if (!receiptValidShape) {
    findings.push(interfaceSystemFinding(
      "frontend.component.interface_system_validation_missing",
      "The local check did not receive a successful current Interface System validation result.",
      "Call validate_interface_system_usage, save its exact JSON result to a temporary file, and rerun with --interface-system-validation."
    ));
  }
  const components = new Map((contract?.components || []).map((component) => [component?.id, component]));
  const inventory = inspectInterfaceSources(contract, sources, options.cwd);
  const inventoryErrors = compareInterfaceInventory(inventory, usages);
  for (const renderedInstances of report.coverage?.interface_system?.rendered_instance_sets || []) {
    const renderedIds = new Set();
    for (const instance of renderedInstances) {
      const sourceInstance = inventory.instances.find((source) => source.instanceId === instance.instanceId);
      if (!instance.instanceId || renderedIds.has(instance.instanceId) || !sourceInstance || sourceInstance.componentId !== instance.componentId || sourceInstance.implementationTargetId !== instance.implementationTargetId) inventoryErrors.push("A rendered instance has no unique matching official AST instance.");
      renderedIds.add(instance.instanceId);
    }
    for (const sourceInstance of inventory.instances) if (!renderedIds.has(sourceInstance.instanceId)) inventoryErrors.push(`Source instance '${sourceInstance.instanceId}' was not rendered in every required viewport.`);
  }
  const sourceComponentIds = [];
  const artifactMismatchIds = [];
  for (const usage of usages) {
    const component = components.get(usage?.componentId);
    const targets = component?.implementation?.targets || [];
    const target = targets.find((item) => item?.id === usage?.implementationTargetId && item?.status === "verified");
    const artifactMatches = component?.source !== "figma" || sourceMatchesImmutableArtifact(sources, target);
    if (target && artifactMatches && inventory.instances.some((instance) => instance.instanceId === usage.instanceId && instance.componentId === usage.componentId && instance.implementationTargetId === usage.implementationTargetId)) sourceComponentIds.push(usage.componentId);
    else if (target && component?.source === "figma" && !artifactMatches) artifactMismatchIds.push(usage.componentId);
  }
  const detectedIds = [...new Set(sourceComponentIds)].sort();
  const missingIds = componentIds.filter((id) => !detectedIds.includes(id));
  const roleBypasses = inventory.bypasses;
  const sourceVerified = receiptValidShape && componentIds.length > 0 && missingIds.length === 0 && roleBypasses.length === 0 && inventoryErrors.length === 0;
  if (inventoryErrors.length) findings.push(interfaceSystemFinding("frontend.component.interface_system_inventory_mismatch", inventoryErrors.join(" "), "Use a unique literal data-perture-instance-id on each official JSX instance; include each instance in the manifest. Unsupported dynamic code remains not_verified."));
  const currentBinding = report.rendered?.passed === true && report.rendered?.evidence_hash && inventory.sourceHash ? {
    version: "interface-evidence.v1", source_hash: inventory.sourceHash, inventory_hash: inventory.inventoryHash,
    rendered_hash: report.rendered.evidence_hash, route: report.rendered.route, commit_sha: options.commitSha || null, build_hash: options.buildHash || null
  } : null;
  const bindingMatches = Boolean(currentBinding && validatedManifest?.binding && Object.keys(currentBinding).every((key) => currentBinding[key] === validatedManifest.binding[key]));
  if (!bindingMatches) findings.push(interfaceSystemFinding("frontend.component.interface_system_evidence_unbound", "The receipt is not bound to the current source, AST inventory, route, rendered output and commit.", "Validate validation_manifest_for_binding with validate_interface_system_usage, then rerun this check with the newly signed result. Do not reuse a receipt after changing code."));
  if (receiptValidShape && missingIds.length) {
    if (artifactMismatchIds.length) {
      findings.push(interfaceSystemFinding(
        "frontend.component.interface_system_artifact_mismatch",
        `The official Perture implementation artifact is missing or changed for: ${[...new Set(artifactMismatchIds)].sort().join(", ")}.`,
        "Call get_interface_component_implementation, write every returned file byte-for-byte at its declared path, and do not edit the artifact files."
      ));
    }
    findings.push(interfaceSystemFinding(
      "frontend.component.interface_system_source_missing",
      `The validated Interface System components are not used through their verified implementation targets: ${missingIds.join(", ")}.`,
      "Import and render the approved implementation target instead of recreating a parallel component."
    ));
  }
  if (roleBypasses.length) {
    findings.push(interfaceSystemFinding(
      "frontend.component.interface_system_role_bypass",
      `Native semantic controls bypass an applicable approved Interface System component: ${roleBypasses.map((item) => `${item.file} (${item.role}: ${item.elements.join(", ")})`).join("; ")}.`,
      "Replace every bypassing native control with a verified component assigned to the same semantic role. An unrelated Interface System component does not satisfy this requirement."
    ));
  }
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  const suggestions = findings.filter((item) => item.severity === "suggestion").length;
  const unverified = new Set(report.coverage?.unverified || []);
  if (sourceVerified) unverified.delete("interface_system_source_usage");
  else unverified.add("interface_system_source_usage");
  return {
    ...report,
    passed: report.passed && sourceVerified && bindingMatches && errors === 0,
    validation_manifest_for_binding: currentBinding ? { ...validatedManifest, binding: currentBinding } : null,
    summary: { errors, warnings, suggestions, findings: findings.length },
    coverage: {
      ...report.coverage,
      interface_system: {
        component_ids: componentIds,
        hash: validation?.interface_system_hash || contract.generation_enforcement.interface_system_hash,
        manifest_hash: manifestHash,
        binding: currentBinding,
        evidence_hash: currentBinding ? sha256(JSON.stringify(currentBinding)) : "",
        binding_status: bindingMatches ? "verified" : "not_verified",
        source_inventory_count: inventory.instances.length,
        instances_declared: usages.length,
        instances_validated: validation?.instances_validated || 0,
        source_component_ids: detectedIds,
        source_status: sourceVerified ? "verified" : "not_verified",
        status: validation?.status || "not_provided",
        validation_receipt: validation?.validation_receipt || ""
      },
      unverified: [...unverified].sort()
    },
    findings
  };
}

function objectCoverageFor(contractInput, sourceCoverage, evaluations) {
  const contract = contractInput?.frontend_contract?.brand_contract || contractInput?.brand_contract || contractInput;
  const objects = Array.isArray(contract?.governance?.objects) ? contract.governance.objects : [];
  const evaluationById = new Map(evaluations.map((item) => [String(item?.object_id || ""), item]));
  const inventory = [...new Set(objects.map((item) => item?.id).filter(Boolean))].sort();
  const evaluated = [];
  const applicable = [];
  const applied = [];
  const notApplicable = [];
  const invalid = [];
  for (const object of objects) {
    const evaluation = evaluationById.get(object.id);
    if (!evaluation || typeof evaluation.applicable !== "boolean" || !String(evaluation.evidence || "").trim()) {
      invalid.push(object.id);
      continue;
    }
    if (object.application === "always" && evaluation.applicable !== true) {
      invalid.push(object.id);
      continue;
    }
    if (evaluation.applicable && evaluation.applied !== true) {
      invalid.push(object.id);
      continue;
    }
    evaluated.push(object.id);
    if (evaluation.applicable) applicable.push(object.id);
    else notApplicable.push(object.id);
    if (evaluation.applied === true) applied.push(object.id);
  }
  for (const id of evaluationById.keys()) if (!inventory.includes(id)) invalid.push(id);
  return {
    inventory,
    evaluated: [...new Set(evaluated)].sort(),
    applicable: [...new Set(applicable)].sort(),
    applied: [...new Set(applied)].sort(),
    not_applicable: [...new Set(notApplicable)].sort(),
    unverified: [...new Set([...inventory.filter((id) => !evaluated.includes(id)), ...invalid])].sort(),
    source_evaluated: sourceCoverage?.brand_objects?.evaluated || []
  };
}

function mergeCheckReports(localReport, rendered, objectCoverage) {
  const renderedFindings = rendered?.findings || [];
  const findings = [...localReport.findings, ...renderedFindings];
  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  const suggestions = findings.filter((item) => item.severity === "suggestion").length;
  const unverified = new Set(localReport.coverage.unverified || []);
  if (rendered?.passed) {
    for (const category of [
      "rendered_visual_fidelity", "responsive_behavior", "runtime_component_behavior",
      "component_anatomy_and_states", "semantic_color_usage", "typography_hierarchy", "asset_visual_fidelity"
    ]) unverified.delete(category);
  }
  if (!rendered) unverified.add("rendered_visual_fidelity");
  if (rendered?.interface_system?.status === "verified") unverified.delete("interface_system_rendered_usage");
  else unverified.add("interface_system_rendered_usage");
  if (objectCoverage.unverified.length) unverified.add("brand_object_applicability");
  else unverified.delete("brand_object_applicability");
  const passed = localReport.passed && rendered?.passed === true && objectCoverage.unverified.length === 0;
  return {
    ...localReport,
    passed,
    summary: { errors, warnings, suggestions, findings: findings.length },
    coverage: {
      ...localReport.coverage,
      completeness: passed ? "complete" : localReport.coverage.completeness,
      brand_objects: objectCoverage,
      design_predicates: {
        evaluated: [...new Set((rendered?.predicates || []).map((predicate) => predicate.id))].sort(),
        unverified: [...new Set((rendered?.predicates || []).filter((predicate) => predicate.status === "unverified").map((predicate) => predicate.id))].sort()
      },
      interface_system: {
        ...(localReport.coverage.interface_system || {}),
        rendered_component_ids: rendered?.interface_system?.rendered_component_ids || [],
        rendered_instance_sets: rendered?.interface_system?.instance_sets || [],
        rendered_required_roles: rendered?.interface_system?.required_roles || [],
        rendered_status: rendered?.interface_system?.status || "not_verified",
        rendered_ungoverned_instances: rendered?.interface_system?.ungoverned_instances || 0
      },
      unverified: [...unverified].sort()
    },
    rendered: rendered || {
      status: "not_verified",
      passed: false,
      device_scale_factor: 2,
      viewports_checked: [],
      categories_evaluated: [],
      summary: { errors: 0, warnings: 0, suggestions: 0 }
    },
    findings
  };
}

function normalizedExplicitFiles(value, cwd) {
  if (!value || typeof value !== "string") {
    throw new Error("Automatic repair requires an explicit --files scope.");
  }
  const root = path.resolve(cwd);
  return [...new Set(value.split(",").map((file) => file.trim()).filter(Boolean).map((file) => {
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to authorize a repair target outside the repository: ${file}`);
    }
    return relative.replace(/\\/g, "/");
  }))];
}

function selectedFindingIds(args) {
  return String(args.findingIds || "").split(",").map((value) => value.trim()).filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = path.resolve(String(args.cwd || process.cwd()));
  if (args.command === "inspect") {
    const contract = await loadContract(args, false);
    const report = inspectRepository({ contract, cwd });
    if (args.report) fs.writeFileSync(path.resolve(String(args.report)), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    printInspection(report, Boolean(args.json));
    process.exitCode = report.status === "unsupported" ? 1 : 0;
    return;
  }
  if (args.command === "check") {
    const contract = await loadContract(args, true);
    const files = discoverFiles(args, cwd);
    const selectedSources = loadSources(files, cwd);
    const sources = (contract?.frontend_contract || contract)?.generation_enforcement?.required_manifest?.eligible_component_ids?.length ? loadInterfaceSourceClosure(selectedSources, cwd) : selectedSources;
    const repository = inspectRepository({ contract, cwd });
    const localReport = checkSources(contract, sources, {
      repository,
      requireRepository: true
    });
    const rendered = args.url ? await runRenderedCheck({ contract, cwd, url: args.url }) : null;
    const objectCoverage = objectCoverageFor(contract, localReport.coverage, loadObjectReport(args, cwd));
    const combinedReport = attachInterfaceSystemCoverage(
      mergeCheckReports(localReport, rendered, objectCoverage),
      contract,
      sources,
      loadInterfaceSystemValidation(args),
      { cwd, commitSha: currentCommit(cwd), buildHash: hashBuildOutput(cwd, args.buildDir) }
    );
    const report = {
      ...combinedReport,
      repository_intelligence: {
        agent_readiness: repository.agent_readiness,
        inspection_version: repository.inspection_version,
        scan_truncated: repository.scan.truncated,
        status: repository.status
      },
      verification_report: verificationReportFor(combinedReport)
    };
    if (args.report) fs.writeFileSync(path.resolve(String(args.report)), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    printCheck(report, Boolean(args.json));
    process.exitCode = combinedReport.passed ? 0 : 1;
    return;
  }
  if (args.command === "fix") {
    if (args.all) throw new Error("Automatic repair does not support --all; pass an explicit --files scope.");
    const contract = await loadContract(args, true);
    const explicitFiles = normalizedExplicitFiles(args.files, cwd);
    const findingIds = selectedFindingIds(args);
    const allSafe = args.allSafe === true;
    if (allSafe === Boolean(findingIds.length)) {
      throw new Error("Select exactly one repair mode: --finding-ids <ids> or --all-safe.");
    }
    const sources = loadSources(explicitFiles, cwd);
    const loadedFiles = new Set(sources.map((item) => item.file));
    const missing = explicitFiles.filter((file) => !loadedFiles.has(file));
    if (missing.length) {
      throw new Error(`Every repair target must be an existing supported frontend file: ${missing.join(", ")}`);
    }
    const repository = inspectRepository({ contract, cwd });
    const repair = buildRepairReport(contract, sources, repository, { findingIds, allSafe });
    const dryRun = args.apply !== true;
    const planned = repair.plan.repairs.filter((item) => item.status === "planned");
    const skipped = repair.plan.repairs.filter((item) => item.status === "skipped");
    let after = repair.predicted;
    let applied = false;
    let blockers = [...repair.blockers];

    if (!dryRun) {
      if (!planned.length) blockers.push("no_eligible_repairs_selected");
      if (!blockers.length) {
        applyRepairSources(cwd, sources, repair.plan.sources, repair.plan.changed_files);
        applied = true;
        const finalSources = loadSources(explicitFiles, cwd);
        const finalRepository = inspectRepository({ contract, cwd });
        const sourceAfter = checkSources(contract, finalSources, { repository: finalRepository, requireRepository: true });
        const renderedAfter = args.url ? await runRenderedCheck({ contract, cwd, url: args.url }) : null;
        const objectCoverage = objectCoverageFor(contract, sourceAfter.coverage, loadObjectReport(args, cwd));
        const closure = (contract?.frontend_contract || contract)?.generation_enforcement?.required_manifest?.eligible_component_ids?.length ? loadInterfaceSourceClosure(finalSources, cwd) : finalSources;
        after = attachInterfaceSystemCoverage(mergeCheckReports(sourceAfter, renderedAfter, objectCoverage), contract, closure, loadInterfaceSystemValidation(args), { cwd, commitSha: currentCommit(cwd), buildHash: hashBuildOutput(cwd, args.buildDir) });
        if (after.coverage.completeness !== "complete" || after.coverage.repository_intelligence !== "ready") {
          blockers.push("post_repair_repository_coverage_incomplete");
        }
        if (after.summary.errors > repair.baseline.summary.errors) {
          blockers.push("post_repair_error_count_increased");
        }
      }
    }

    const repairs = repair.plan.repairs.map((item) =>
      applied && item.status === "planned" ? { ...item, status: "applied" } : item
    );
    const complete = applied && blockers.length === 0 && skipped.length === 0 && after.passed;
    const report = {
      mode: "frontend_repair",
      repair_protocol_version: repair.repair_protocol_version,
      contract_version: repair.contract_version,
      outcome: dryRun
        ? "repair_preview"
        : complete
          ? "repair_complete"
          : applied
            ? "repair_applied_with_remaining_findings"
            : "repair_blocked",
      dry_run: dryRun,
      applied,
      complete,
      selection: {
        mode: allSafe ? "all_safe_candidates" : "finding_ids",
        finding_ids: findingIds
      },
      authorized_files: explicitFiles,
      changed_files: applied ? repair.plan.changed_files : [],
      planned_changed_files: repair.plan.changed_files,
      before: repair.baseline,
      after,
      repository_intelligence: {
        agent_readiness: repository.agent_readiness,
        inspection_version: repository.inspection_version,
        scan_truncated: repository.scan.truncated,
        status: repository.status
      },
      repairs,
      blockers: [...new Set(blockers)],
      verification_report: applied ? verificationReportFor(after) : null,
      privacy: {
        source_uploaded: false,
        repair_details_local_only: true,
        remote_submission: "Pass only verification_report to verify_ui_change after an applied repair."
      }
    };
    if (args.report) fs.writeFileSync(path.resolve(String(args.report)), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    printRepair(report, Boolean(args.json));
    process.exitCode = dryRun
      ? (planned.length > 0 && blockers.length === 0 ? 0 : 1)
      : (complete ? 0 : 1);
    return;
  }
  throw new Error("Usage: local-validator.js inspect|check|fix --contract-stdin [--cwd <repository>] [--files <a.tsx,b.css>] [--url <loopback-url>] [--build-dir <repository-relative-output>] [--object-report <brand-object-applicability.json>] [--interface-system-validation <temporary-validation.json>] [--finding-ids <ids>|--all-safe] [--apply] [--json]");
}

function currentCommit(cwd) {
  try { const value = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); return /^[a-f0-9]{40}$/.test(value) ? value : null; }
  catch { return null; }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(String(error instanceof Error ? error.message : error || "Perture local validation failed.").slice(0, 500));
    process.exitCode = 2;
  });
}

module.exports = { assertContractCompatibility, attachInterfaceSystemCoverage, mergeCheckReports, objectCoverageFor, verificationReportFor };
