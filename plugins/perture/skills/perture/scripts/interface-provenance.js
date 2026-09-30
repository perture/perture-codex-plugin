// Source-derived inventory. The manifest is compared with this inventory; it
// never supplies authority for an import or a manually attached DOM marker.
const crypto = require("node:crypto");
const path = require("node:path");
const { createRequire } = require("node:module");
const fs = require("node:fs");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const normalizedPath = (value) => String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");

function inspectInterfaceSources(contract, sources, cwd = process.cwd()) {
  let ts;
  try { ts = createRequire(path.join(path.resolve(cwd), "package.json"))("typescript"); }
  catch { return { instances: [], bypasses: [], errors: ["TypeScript AST parser is unavailable; component provenance cannot be verified."], sourceHash: "", inventoryHash: "" }; }
  const targets = (contract.components || []).flatMap((component) => (component.implementation?.targets || [])
    .filter((target) => target.status === "verified")
    .map((target) => ({ componentId: component.id, component, target, importPath: target.import_path || target.importPath, exportName: target.export_name || target.exportName })));
  const officialOwners = new Map();
  for (const entry of targets) for (const file of [entry.target.source_file || entry.target.sourceFile, ...(entry.target.artifact?.files || []).map((item) => item.path)].filter(Boolean)) {
    const key = normalizedPath(file);
    officialOwners.set(key, [...(officialOwners.get(key) || []), entry.componentId]);
  }
  const roles = contract.generation_enforcement?.applicability?.roles || [];
  const configPath = ts.findConfigFile(cwd, ts.sys.fileExists);
  const options = configPath ? ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, path.dirname(configPath)).options : {};
  const virtualFiles = new Map(sources.map((item) => [path.resolve(cwd, item.file), item.source]));
  const host = { ...ts.sys, directoryExists: (dir) => [...virtualFiles.keys()].some((file) => file.startsWith(path.resolve(dir) + path.sep)) || ts.sys.directoryExists(dir), fileExists: (file) => virtualFiles.has(path.resolve(file)) || ts.sys.fileExists(file), readFile: (file) => virtualFiles.get(path.resolve(file)) ?? ts.sys.readFile(file) };
  const instances = [], bypasses = [], errors = [];
  const ids = new Set();
  for (const item of sources) {
    const file = normalizedPath(item.file);
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const tree = ts.createSourceFile(file, item.source, ts.ScriptTarget.Latest, true, /tsx$|jsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if (tree.parseDiagnostics.length) errors.push(`${file}: syntax is invalid; inventory is incomplete.`);
    const bindings = new Map();
    for (const statement of tree.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue;
      const moduleName = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      const resolvedModule = ts.resolveModuleName(moduleName, path.resolve(cwd, file), options, host).resolvedModule?.resolvedFileName;
      const entries = targets.filter((target) => target.importPath === moduleName || Boolean(resolvedModule && path.resolve(resolvedModule) === path.resolve(cwd, target.target.source_file || target.target.sourceFile || "")));
      for (const entry of entries) {
        const resolved = resolvedModule;
        if (!resolved || path.resolve(resolved) !== path.resolve(cwd, entry.target.source_file || entry.target.sourceFile || "")) errors.push(`${file}: official import '${moduleName}' does not resolve to its approved source file.`);
      }
      if (clause?.name) for (const entry of entries.filter((target) => target.exportName === "default")) bindings.set(clause.name.text, entry);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const binding of clause.namedBindings.elements) {
        if (binding.isTypeOnly) continue;
        const exported = binding.propertyName?.text || binding.name.text;
        for (const entry of entries.filter((target) => target.exportName === exported)) bindings.set(binding.name.text, entry);
      }
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) for (const entry of entries) bindings.set(`${clause.namedBindings.name.text}.${entry.exportName}`, entry);
    }
    const literal = (attribute) => {
      if (!attribute?.initializer) return attribute ? true : undefined;
      if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
      const expression = attribute.initializer.expression;
      if (expression && (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))) return expression.text;
      if (expression?.kind === ts.SyntaxKind.TrueKeyword) return true;
      if (expression?.kind === ts.SyntaxKind.FalseKeyword) return false;
      if (expression && ts.isNumericLiteral(expression)) return Number(expression.text);
      return undefined;
    };
    const visit = (node) => {
      if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && bindings.has(node.name.getText(tree))) errors.push(`${file}: an official import is shadowed; provenance is not verified.`);
      if (!officialOwners.has(file) && ts.isCallExpression(node) && /(?:^|\.)(?:createElement|createElementNS|insertAdjacentHTML)$/.test(node.expression.getText(tree))) errors.push(`${file}: imperative element creation requires supported provenance; no verification is inferred.`);
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(tree);
        const attributes = node.attributes.properties;
        const attr = (name) => literal(attributes.find((value) => ts.isJsxAttribute(value) && value.name.getText(tree) === name));
        const ownerIds = officialOwners.get(file) || [];
        const binding = bindings.get(tag);
        const position = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        if (!ownerIds.length && attributes.some((value) => ts.isJsxAttribute(value) && ["data-perture-component-id", "dangerouslySetInnerHTML"].includes(value.name.getText(tree)))) errors.push(`${file}:${position.line + 1}: forged component marker or opaque HTML is not implementation provenance.`);
        const semanticRole = attr("role");
        for (const role of roles) {
          if (!role.component_ids?.length) continue;
          const native = role.source_native_elements?.includes(tag);
          const explicit = typeof semanticRole === "string" && (role.role === semanticRole || (role.role === "overlay" && semanticRole === "dialog") || (role.role === "feedback" && ["alert", "status"].includes(semanticRole)));
          if ((native || explicit) && !ownerIds.some((id) => role.component_ids.includes(id))) bypasses.push({ file, line: position.line + 1, role: role.role, elements: [tag], componentIds: role.component_ids });
        }
        if (binding && !ownerIds.length) {
          const instanceId = attr("data-perture-instance-id");
          if (attributes.some((attribute) => ts.isJsxSpreadAttribute(attribute))) errors.push(`${file}:${position.line + 1}: spread props prevent deterministic variant/context validation.`);
          for (const name of ["variant", "state", "role"]) if (attributes.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === name) && attr(name) === undefined) errors.push(`${file}:${position.line + 1}: dynamic ${name} cannot be validated as a literal default.`);
          if (typeof instanceId !== "string" || !instanceId.trim() || ids.has(instanceId)) errors.push(`${file}:${position.line + 1}: every official instance needs a unique literal data-perture-instance-id.`);
          else ids.add(instanceId);
          const props = {};
          for (const property of binding.component.properties || []) {
            const propName = binding.target.prop_mappings?.[property.id] || binding.target.propMappings?.[property.id] || property.binding?.react_prop || property.binding?.reactProp;
            if (!propName) continue;
            const exists = attributes.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === propName);
            const value = exists ? attr(propName) : property.default_value ?? property.defaultValue;
            if (exists && value === undefined) errors.push(`${file}:${position.line + 1}: dynamic prop '${propName}' cannot be validated.`);
            if (value !== undefined) props[property.id] = value;
          }
          instances.push({ instanceId: instanceId || "", componentId: binding.componentId, implementationTargetId: binding.target.id, file, line: position.line + 1,
            variant: attr("variant") ?? binding.component.variants?.[0], state: attr("state") ?? binding.component.states?.[0], props });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  instances.sort((a, b) => a.instanceId.localeCompare(b.instanceId) || a.file.localeCompare(b.file) || a.line - b.line);
  const sourceRows = sources.map((item) => ({ file: normalizedPath(item.file), sha256: sha256(String(item.source)) })).sort((a, b) => a.file.localeCompare(b.file));
  return { instances, bypasses, errors, sourceHash: sha256(JSON.stringify(sourceRows)), inventoryHash: sha256(JSON.stringify(instances)) };
}

function compareInterfaceInventory(inventory, usages) {
  const errors = [...inventory.errors];
  const declared = new Map();
  for (const usage of usages) {
    if (!usage.instanceId || declared.has(usage.instanceId)) errors.push("Manifest instance IDs must be unique and nonempty.");
    declared.set(usage.instanceId, usage);
  }
  for (const instance of inventory.instances) {
    const usage = declared.get(instance.instanceId);
    if (!usage) { errors.push(`${instance.file}:${instance.line}: undeclared official instance '${instance.instanceId}'.`); continue; }
    for (const field of ["componentId", "implementationTargetId", "variant", "state"]) if (instance[field] !== usage[field]) errors.push(`${instance.instanceId}: source ${field} does not match the validated manifest.`);
    for (const [key, value] of Object.entries(usage.props || {})) if (!(key in instance.props) || JSON.stringify(instance.props[key]) !== JSON.stringify(value)) errors.push(`${instance.instanceId}: source property '${key}' does not match the manifest.`);
    declared.delete(instance.instanceId);
  }
  for (const instanceId of declared.keys()) errors.push(`Manifest instance '${instanceId}' has no verified AST source instance.`);
  return errors;
}

function loadInterfaceSourceClosure(sources, cwd) {
  const root = fs.realpathSync(path.resolve(cwd));
  const ts = createRequire(path.join(root, "package.json"))("typescript");
  const configPath = ts.findConfigFile(root, ts.sys.fileExists);
  const options = configPath ? ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, path.dirname(configPath)).options : { allowJs: true };
  const inventory = new Map(sources.map((item) => [normalizedPath(item.file), item]));
  for (const file of ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "tsconfig.json", "next.config.js", "next.config.mjs", "next.config.ts", "vite.config.ts", "vite.config.js"]) {
    if (fs.existsSync(path.join(root, file)) && !inventory.has(file)) inventory.set(file, { file, source: fs.readFileSync(path.join(root, file), "utf8") });
  }
  const queue = [...inventory.values()];
  let bytes = sources.reduce((total, item) => total + Buffer.byteLength(item.source), 0);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const item = queue[cursor];
    if (!/\.[cm]?[jt]sx?$/.test(item.file)) continue;
    const tree = ts.createSourceFile(item.file, item.source, ts.ScriptTarget.Latest, true, /tsx$|jsx$/.test(item.file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const modules = [];
    const collect = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) modules.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) modules.push(node.arguments[0].text);
        else throw new Error(`Dynamic import in '${item.file}' makes the source closure unverifiable.`);
      }
      ts.forEachChild(node, collect);
    };
    collect(tree);
    for (const moduleName of modules) {
      const resolved = ts.resolveModuleName(moduleName, path.join(root, item.file), options, ts.sys).resolvedModule?.resolvedFileName;
      const localStyle = moduleName.startsWith(".") && /\.(css|scss|sass|less)$/.test(moduleName) ? path.resolve(root, path.dirname(item.file), moduleName) : null;
      const candidate = resolved || localStyle;
      if (!candidate || !fs.existsSync(candidate) || candidate.includes(`${path.sep}node_modules${path.sep}`) || candidate.endsWith(".d.ts")) continue;
      const absolute = fs.realpathSync(candidate), relative = path.relative(root, absolute);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Source dependency escapes the repository; provenance is not verified.");
      const file = normalizedPath(relative);
      if (inventory.has(file)) continue;
      const source = fs.readFileSync(absolute, "utf8");
      bytes += Buffer.byteLength(source);
      if (inventory.size >= 2000 || bytes > 50 * 1024 * 1024) throw new Error("Source closure exceeded its safety limit; do not truncate provenance.");
      const dependency = { file, source };
      inventory.set(file, dependency); queue.push(dependency);
    }
  }
  return [...inventory.values()];
}

module.exports = { compareInterfaceInventory, inspectInterfaceSources, loadInterfaceSourceClosure, sha256 };
