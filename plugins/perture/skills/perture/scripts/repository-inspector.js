const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const REPOSITORY_INSPECTION_SCHEMA_VERSION = "1.0";
const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 20_000,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 16 * 1024 * 1024
});
const HARD_LIMITS = Object.freeze({
  maxFiles: 100_000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024
});

const IGNORED_DIRECTORIES = new Set([
  ".codex-tmp", ".git", ".next", ".nuxt", ".output", ".release", ".svelte-kit", ".turbo",
  ".vercel", ".wrangler", ".cache", ".parcel-cache", ".tmp", "build", "coverage",
  "dist", "node_modules", "out", "temp", "tmp", "vendor"
]);

const TEXT_EXTENSIONS = new Set([
  ".cjs", ".css", ".cts", ".html", ".htm", ".js", ".json", ".jsx", ".less",
  ".mjs", ".mts", ".sass", ".scss", ".svelte", ".ts", ".tsx", ".vue", ".yaml", ".yml"
]);
const COMPONENT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const FONT_EXTENSIONS = new Set([".eot", ".otf", ".ttf", ".woff", ".woff2"]);
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte"]);
const STYLE_EXTENSIONS = new Set([".css", ".less", ".sass", ".scss"]);
const CONFIG_FILE_PATTERN = /(?:^|\/)(?:components|package|tsconfig|jsconfig)\.json$|(?:^|\/)(?:next|vite|tailwind|postcss|webpack|astro|svelte|nuxt|angular|styledictionary)\.config\.[^/]+$/i;
const TOKEN_FILE_PATTERN = /(?:^|\/)(?:[^/]*(?:design[-_.]?tokens?|tokens?|theme|variables|foundations|interface[-_.]?system)[^/]*)\.(?:c?js|m?js|tsx?|json|ya?ml|s?css)$/i;
const SENSITIVE_FILE_PATTERN = /(?:^|\/)(?:\.env(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)|[^/]*(?:credential|secret|private[-_.]?key)[^/]*|[^/]+\.(?:key|pem|p12|pfx))$/i;
const LAYOUT_NAME_PATTERN = /^(?:AppShell|Container|Content|Footer|Grid|Header|Layout|Main|Navbar|Page|PageShell|Section|Shell|Sidebar|Stack|Topbar)$/i;
const PRIMITIVE_NAME_PATTERN = /^(?:Accordion|Alert|Avatar|Badge|Breadcrumb|Button|Card|Checkbox|Chip|Combobox|Dialog|Divider|Drawer|Dropdown|Field|Form|IconButton|Input|Label|Link|Menu|Modal|Popover|Radio|Select|Skeleton|Slider|Switch|Tab|Table|Textarea|Toast|Tooltip)$/i;

const DESIGN_SYSTEM_PACKAGES = new Map([
  ["@chakra-ui/react", "Chakra UI"],
  ["@headlessui/react", "Headless UI"],
  ["@mantine/core", "Mantine"],
  ["@mui/material", "Material UI"],
  ["@radix-ui/react-accordion", "Radix UI"],
  ["@radix-ui/react-dialog", "Radix UI"],
  ["@radix-ui/react-slot", "Radix UI"],
  ["@radix-ui/themes", "Radix Themes"],
  ["antd", "Ant Design"],
  ["react-bootstrap", "React Bootstrap"],
  ["semantic-ui-react", "Semantic UI"]
]);

const ICON_PACKAGES = [
  "@fortawesome/fontawesome-svg-core", "@fortawesome/free-solid-svg-icons", "@heroicons/react",
  "@iconify/react", "@phosphor-icons/react", "lucide-react", "react-icons"
];

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function sortedObjects(values, keys = ["path", "id", "name"]) {
  return [...values].sort((left, right) => {
    for (const key of keys) {
      const comparison = String(left[key] || "").localeCompare(String(right[key] || ""));
      if (comparison) return comparison;
    }
    return 0;
  });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function versionFor(value) {
  return `ri_${sha256(JSON.stringify(value)).slice(0, 16)}`;
}

function isInsideRoot(root, absolute) {
  const relative = path.relative(root, absolute);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function shouldRead(relative, size, limits) {
  if (size > limits.maxFileBytes || SENSITIVE_FILE_PATTERN.test(relative)) return false;
  const extension = path.extname(relative).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) && (
    SOURCE_EXTENSIONS.has(extension) ||
    STYLE_EXTENSIONS.has(extension) ||
    CONFIG_FILE_PATTERN.test(relative) ||
    TOKEN_FILE_PATTERN.test(relative)
  );
}

function boundedLimit(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(1, Math.floor(parsed)))
    : fallback;
}

function walkRepository(root, requestedLimits = {}) {
  const limits = {
    maxFiles: boundedLimit(requestedLimits.maxFiles, DEFAULT_LIMITS.maxFiles, HARD_LIMITS.maxFiles),
    maxFileBytes: boundedLimit(requestedLimits.maxFileBytes, DEFAULT_LIMITS.maxFileBytes, HARD_LIMITS.maxFileBytes),
    maxTotalBytes: boundedLimit(requestedLimits.maxTotalBytes, DEFAULT_LIMITS.maxTotalBytes, HARD_LIMITS.maxTotalBytes)
  };
  const files = [];
  const readable = [];
  const warnings = [];
  const queue = [""];
  let bytesRead = 0;
  let truncated = false;

  while (queue.length && !truncated) {
    const relativeDirectory = queue.shift();
    const absoluteDirectory = path.resolve(root, relativeDirectory);
    if (!isInsideRoot(root, absoluteDirectory)) continue;
    let entries;
    try {
      entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      warnings.push(`Could not read directory: ${toPosix(relativeDirectory || ".")}`);
      continue;
    }

    for (const entry of entries) {
      const relative = toPosix(path.join(relativeDirectory, entry.name));
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) queue.push(relative);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= limits.maxFiles) {
        truncated = true;
        warnings.push(`Repository scan stopped at the ${limits.maxFiles}-file safety limit.`);
        break;
      }

      const absolute = path.resolve(root, relative);
      if (!isInsideRoot(root, absolute)) continue;
      let size = 0;
      try {
        size = fs.statSync(absolute).size;
      } catch {
        warnings.push(`Could not stat file: ${relative}`);
        continue;
      }
      files.push({ path: relative, size });

      if (!shouldRead(relative, size, limits)) continue;
      if (bytesRead + size > limits.maxTotalBytes) {
        truncated = true;
        warnings.push(`Repository content scan stopped at the ${limits.maxTotalBytes}-byte safety limit.`);
        break;
      }
      try {
        const buffer = fs.readFileSync(absolute);
        if (buffer.includes(0)) continue;
        const source = buffer.toString("utf8");
        bytesRead += buffer.byteLength;
        readable.push({ path: relative, size, source, hash: sha256(buffer) });
      } catch {
        warnings.push(`Could not read file: ${relative}`);
      }
    }
  }

  return {
    files: sortedObjects(files),
    readable: sortedObjects(readable),
    scan: {
      bytes_read: bytesRead,
      files_discovered: files.length,
      files_read: readable.length,
      ignored_directories: [...IGNORED_DIRECTORIES].sort(),
      limits,
      truncated
    },
    warnings: uniqueSorted(warnings)
  };
}

function parsePackages(readable, warnings) {
  const packages = [];
  for (const file of readable.filter((item) => /(?:^|\/)package\.json$/i.test(item.path))) {
    try {
      const parsed = JSON.parse(file.source);
      const dependencies = {
        ...(parsed.dependencies && typeof parsed.dependencies === "object" ? parsed.dependencies : {}),
        ...(parsed.devDependencies && typeof parsed.devDependencies === "object" ? parsed.devDependencies : {}),
        ...(parsed.peerDependencies && typeof parsed.peerDependencies === "object" ? parsed.peerDependencies : {})
      };
      packages.push({
        path: file.path,
        root: toPosix(path.dirname(file.path)) === "." ? "." : toPosix(path.dirname(file.path)),
        name: typeof parsed.name === "string" ? parsed.name : null,
        dependencies,
        scripts: parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {}
      });
    } catch {
      warnings.push(`Invalid package.json was not interpreted: ${file.path}`);
    }
  }
  return sortedObjects(packages);
}

function packageEvidence(packages, packageName) {
  return packages
    .filter((item) => Object.prototype.hasOwnProperty.call(item.dependencies, packageName))
    .map((item) => item.path);
}

function hasPackage(packages, packageName) {
  return packageEvidence(packages, packageName).length > 0;
}

function frontendPackageRoots(packages) {
  const frontendNames = ["next", "react", "vue", "svelte", "@angular/core", "nuxt", "astro"];
  return packages.filter((item) => frontendNames.some((name) => Object.prototype.hasOwnProperty.call(item.dependencies, name)));
}

function detectFrameworks(packages, readable, files) {
  const definitions = [
    { id: "nextjs", label: "Next.js", packages: ["next"], tier: "supported" },
    { id: "react", label: "React", packages: ["react"], tier: "supported" },
    { id: "vue", label: "Vue", packages: ["vue"], tier: "unsupported" },
    { id: "svelte", label: "Svelte", packages: ["svelte", "@sveltejs/kit"], tier: "unsupported" },
    { id: "angular", label: "Angular", packages: ["@angular/core"], tier: "unsupported" },
    { id: "astro", label: "Astro", packages: ["astro"], tier: "unsupported" }
  ];
  const frameworks = [];
  for (const definition of definitions) {
    const evidence = uniqueSorted(definition.packages.flatMap((name) => packageEvidence(packages, name)));
    if (evidence.length) frameworks.push({ ...definition, evidence });
  }

  if (!frameworks.some((item) => item.id === "vue") && files.some((file) => file.path.endsWith(".vue"))) {
    frameworks.push({ id: "vue", label: "Vue", packages: [], tier: "unsupported", evidence: ["*.vue source"] });
  }
  if (!frameworks.some((item) => item.id === "svelte") && files.some((file) => file.path.endsWith(".svelte"))) {
    frameworks.push({ id: "svelte", label: "Svelte", packages: [], tier: "unsupported", evidence: ["*.svelte source"] });
  }

  const rootPackage = [...packages].sort((left, right) => {
    const depth = (value) => value.path.split("/").length;
    return depth(left) - depth(right) || left.path.localeCompare(right.path);
  })[0];
  const rootDependencies = rootPackage?.dependencies || {};
  let primary = "unknown";
  for (const id of ["nextjs", "react", "vue", "svelte", "angular", "astro"]) {
    const definition = definitions.find((item) => item.id === id);
    if (definition?.packages.some((name) => Object.prototype.hasOwnProperty.call(rootDependencies, name))) {
      primary = id;
      break;
    }
  }
  if (primary === "unknown" && frameworks.length === 1) primary = frameworks[0].id;

  const readablePaths = new Set(readable.map((item) => item.path));
  const appRouter = [...readablePaths].some((file) => /^(?:src\/)?app\/(?:.+\/)?(?:layout|page)\.[cm]?[jt]sx?$/.test(file));
  const pagesRouter = [...readablePaths].some((file) => /^(?:src\/)?pages\/.+\.[cm]?[jt]sx?$/.test(file));
  const routers = [];
  if (primary === "nextjs" && appRouter) routers.push("next_app_router");
  if (primary === "nextjs" && pagesRouter) routers.push("next_pages_router");
  if (hasPackage(packages, "react-router") || hasPackage(packages, "react-router-dom")) routers.push("react_router");

  return {
    frameworks: sortedObjects(frameworks, ["id"]),
    primary_framework: primary,
    routers: uniqueSorted(routers)
  };
}

function detectLanguages(files) {
  const extensions = new Set(files.map((file) => path.extname(file.path).toLowerCase()));
  const languages = [];
  if ([".ts", ".tsx", ".cts", ".mts"].some((extension) => extensions.has(extension))) languages.push("typescript");
  if ([".js", ".jsx", ".cjs", ".mjs"].some((extension) => extensions.has(extension))) languages.push("javascript");
  if (extensions.has(".vue")) languages.push("vue_sfc");
  if (extensions.has(".svelte")) languages.push("svelte_component");
  return languages;
}

function detectPackageManager(files) {
  const names = new Set(files.map((file) => file.path));
  if (names.has("pnpm-lock.yaml")) return "pnpm";
  if (names.has("yarn.lock")) return "yarn";
  if (names.has("bun.lock") || names.has("bun.lockb")) return "bun";
  if (names.has("package-lock.json")) return "npm";
  return "unknown";
}

function detectSourceRoots(files) {
  const candidates = ["app", "src", "pages", "components", "packages", "apps"];
  return candidates.filter((candidate) => files.some((file) => file.path === candidate || file.path.startsWith(`${candidate}/`)));
}

function detectStyling(packages, readable, files, warnings) {
  const paths = files.map((item) => item.path);
  const cssModules = paths.filter((file) => /\.module\.(?:css|less|sass|scss)$/i.test(file));
  const globalStylesheets = paths.filter((file) => /(?:^|\/)(?:global|globals|app|index|main|styles?)\.(?:css|less|sass|scss)$/i.test(file));
  const styleFiles = paths.filter((file) => STYLE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const themeFiles = paths.filter((file) => /(?:^|\/)[^/]*(?:theme|variables|foundations)[^/]*\.(?:c?js|m?js|tsx?|json|ya?ml|s?css)$/i.test(file));
  const tokenFiles = paths.filter((file) => TOKEN_FILE_PATTERN.test(file));
  const cssVariableSources = readable
    .filter((file) => STYLE_EXTENSIONS.has(path.extname(file.path).toLowerCase()))
    .map((file) => ({
      path: file.path,
      variables: (file.source.match(/--[A-Za-z0-9_-]+\s*:/g) || []).length
    }))
    .filter((item) => item.variables > 0)
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, 200);
  const tailwindConfigFiles = paths.filter((file) => /(?:^|\/)tailwind\.config\.(?:c?js|m?js|tsx?)$/i.test(file));
  const tailwindEntrypoints = readable
    .filter((file) => STYLE_EXTENSIONS.has(path.extname(file.path).toLowerCase()) && /@(?:import\s+["']tailwindcss["']|tailwind\s+|theme\s*\{)/i.test(file.source))
    .map((file) => file.path);
  const systems = [];

  if (styleFiles.some((file) => file.endsWith(".css"))) systems.push({ id: "css", label: "CSS", tier: "supported", evidence: styleFiles.filter((file) => file.endsWith(".css")).slice(0, 20) });
  if (cssModules.length) systems.push({ id: "css_modules", label: "CSS Modules", tier: "supported", evidence: cssModules.slice(0, 20) });

  const tailwindDetected = hasPackage(packages, "tailwindcss") || tailwindConfigFiles.length > 0 || tailwindEntrypoints.length > 0;
  const tailwindResolvable = tailwindConfigFiles.length > 0 || tailwindEntrypoints.length > 0;
  if (tailwindDetected) {
    systems.push({
      id: "tailwind",
      label: "Tailwind CSS",
      tier: tailwindResolvable ? "supported" : "best_effort",
      evidence: uniqueSorted([...packageEvidence(packages, "tailwindcss"), ...tailwindConfigFiles, ...tailwindEntrypoints])
    });
    if (!tailwindResolvable) warnings.push("Tailwind was detected, but its active configuration or CSS entrypoint could not be resolved.");
  }

  const sassFiles = styleFiles.filter((file) => /\.(?:sass|scss)$/i.test(file));
  if (sassFiles.length || hasPackage(packages, "sass")) {
    systems.push({ id: "sass", label: "Sass/SCSS", tier: "best_effort", evidence: uniqueSorted([...packageEvidence(packages, "sass"), ...sassFiles.slice(0, 20)]) });
  }

  const cssInJs = [
    { package: "styled-components", id: "styled_components", label: "styled-components" },
    { package: "@emotion/react", id: "emotion", label: "Emotion" },
    { package: "@stitches/react", id: "stitches", label: "Stitches" },
    { package: "@vanilla-extract/css", id: "vanilla_extract", label: "vanilla-extract" }
  ];
  for (const item of cssInJs) {
    const evidence = packageEvidence(packages, item.package);
    if (evidence.length) systems.push({ id: item.id, label: item.label, tier: "best_effort", evidence });
  }

  const customTokenPackages = ["style-dictionary", "theo", "token-transformer"].filter((name) => hasPackage(packages, name));
  return {
    css_modules: uniqueSorted(cssModules).slice(0, 200),
    css_variable_sources: cssVariableSources,
    custom_token_compilers: customTokenPackages,
    global_stylesheets: uniqueSorted(globalStylesheets).slice(0, 200),
    style_files: uniqueSorted(styleFiles).slice(0, 200),
    systems: sortedObjects(systems, ["id"]),
    tailwind: {
      config_files: uniqueSorted(tailwindConfigFiles),
      detected: tailwindDetected,
      entrypoints: uniqueSorted(tailwindEntrypoints),
      resolvable: tailwindDetected ? tailwindResolvable : null
    },
    theme_files: uniqueSorted(themeFiles).slice(0, 200),
    token_files: uniqueSorted(tokenFiles).slice(0, 200)
  };
}

function detectLayout(readable, components) {
  const files = readable
    .filter((file) => /(?:^|\/)(?:layout|shell|container|grid|stack)\.[cm]?[jt]sx?$/i.test(file.path))
    .map((file) => file.path);
  const patternSources = [];
  for (const file of readable.filter((item) => STYLE_EXTENSIONS.has(path.extname(item.path).toLowerCase()))) {
    const patterns = [];
    if (/display\s*:\s*(?:inline-)?flex\b/i.test(file.source)) patterns.push("flex");
    if (/display\s*:\s*(?:inline-)?grid\b/i.test(file.source)) patterns.push("grid");
    if (/max-width\s*:/i.test(file.source)) patterns.push("max_width");
    if (/@media\b/i.test(file.source)) patterns.push("media_queries");
    if (/@container\b|container-type\s*:/i.test(file.source)) patterns.push("container_queries");
    if (/position\s*:\s*(?:fixed|sticky)\b/i.test(file.source)) patterns.push("anchored_regions");
    if (patterns.length) patternSources.push({ path: file.path, patterns: uniqueSorted(patterns) });
  }
  return {
    files: uniqueSorted(files).slice(0, 100),
    pattern_sources: sortedObjects(patternSources).slice(0, 200),
    primitives: components.layout_primitives
  };
}

function componentNames(source) {
  const names = [];
  const expressions = [
    /export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Z][A-Za-z0-9]*)/g,
    /export\s+(?:default\s+)?class\s+([A-Z][A-Za-z0-9]*)/g,
    /export\s+(?:const|let|var)\s+([A-Z][A-Za-z0-9]*)\s*=/g
  ];
  for (const expression of expressions) {
    for (const match of source.matchAll(expression)) {
      if (match[1] !== match[1].toUpperCase()) names.push(match[1]);
    }
  }
  return uniqueSorted(names);
}

function componentKind(name) {
  if (LAYOUT_NAME_PATTERN.test(name)) return "layout";
  if (PRIMITIVE_NAME_PATTERN.test(name)) return "ui_primitive";
  return "component";
}

function detectComponents(packages, readable, files) {
  const componentFiles = readable.filter((file) => {
    const extension = path.extname(file.path).toLowerCase();
    const likelyFrontendPath = /^(?:app|components|pages|src)\//.test(file.path) || !file.path.includes("/");
    const containsJsx = /(?:return\s*\(?\s*|=>\s*\(?\s*)<[A-Za-z][^>]*>/.test(file.source);
    const isComponentSyntax = [".jsx", ".tsx"].includes(extension) || (likelyFrontendPath && containsJsx);
    return COMPONENT_EXTENSIONS.has(extension) && isComponentSyntax && !/\.(?:test|spec|stories)\.[cm]?[jt]sx?$/i.test(file.path);
  });
  const directoryCounts = new Map();
  for (const file of componentFiles) {
    const directory = toPosix(path.dirname(file.path));
    const stem = path.basename(file.path).replace(/\.[^.]+$/, "");
    if (/^[A-Z][A-Za-z0-9]*$/.test(stem) && stem !== stem.toUpperCase()) directoryCounts.set(directory, (directoryCounts.get(directory) || 0) + 1);
  }
  const explicitDirectories = files
    .map((file) => toPosix(path.dirname(file.path)))
    .filter((directory) => /(?:^|\/)(?:components|ui|design-system|ui-kit)(?:\/|$)/i.test(directory));
  const inferredDirectories = [...directoryCounts.entries()]
    .filter(([directory, count]) => count >= 3 && !["app", "pages", "api", "lib", "tools"].includes(path.basename(directory).toLowerCase()))
    .map(([directory]) => directory);
  const directories = uniqueSorted([...explicitDirectories, ...inferredDirectories]).filter((directory) => directory !== ".");

  const reusable = [];
  for (const file of componentFiles) {
    const stem = path.basename(file.path).replace(/\.[^.]+$/, "");
    const names = componentNames(file.source);
    if (/^[A-Z][A-Za-z0-9]*$/.test(stem) && stem !== stem.toUpperCase()) names.push(stem);
    for (const name of uniqueSorted(names)) {
      reusable.push({
        name,
        path: file.path,
        kind: componentKind(name),
        evidence: componentNames(file.source).includes(name) ? "export" : "filename"
      });
    }
  }

  const deduplicated = [];
  const seen = new Set();
  for (const item of sortedObjects(reusable, ["path", "name"])) {
    const key = `${item.path}:${item.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(item);
    }
  }

  const designSystems = [];
  for (const [packageName, label] of DESIGN_SYSTEM_PACKAGES.entries()) {
    const evidence = packageEvidence(packages, packageName);
    if (evidence.length && !designSystems.some((item) => item.id === label.toLowerCase().replace(/\s+/g, "_"))) {
      designSystems.push({ id: label.toLowerCase().replace(/\s+/g, "_"), label, kind: "package", evidence });
    }
  }
  const componentConfig = files.find((file) => file.path === "components.json");
  if (componentConfig) designSystems.push({ id: "shadcn_ui", label: "shadcn/ui", kind: "project_configuration", evidence: [componentConfig.path] });
  const localSystemEvidence = files
    .filter((file) => /(?:^|\/)[^/]*(?:design[-_.]?system|interface[-_.]?system|ui[-_.]?kit)[^/]*\.(?:c?js|m?js|tsx?|json|ya?ml|less|s?css)$/i.test(file.path))
    .map((file) => file.path);
  if (localSystemEvidence.length) designSystems.push({ id: "local_design_system", label: "Local design system", kind: "local", evidence: uniqueSorted(localSystemEvidence) });

  return {
    design_systems: sortedObjects(designSystems, ["id"]),
    directories,
    layout_primitives: deduplicated.filter((item) => item.kind === "layout").slice(0, 100),
    reusable: deduplicated.slice(0, 300),
    ui_primitives: deduplicated.filter((item) => item.kind === "ui_primitive").slice(0, 100)
  };
}

function detectAssets(packages, readable, files) {
  const fontFiles = files.filter((file) => FONT_EXTENSIONS.has(path.extname(file.path).toLowerCase())).map((file) => file.path);
  const fontPackages = [];
  for (const item of packages) {
    for (const dependency of Object.keys(item.dependencies)) {
      if (dependency.startsWith("@fontsource/") || dependency === "typeface-inter") fontPackages.push(dependency);
    }
  }
  const fontDeclarations = [];
  let usesNextFont = false;
  for (const file of readable) {
    if (/from\s+["']next\/font\/(?:google|local)["']|require\(["']next\/font\/(?:google|local)["']\)/.test(file.source)) usesNextFont = true;
    if (!STYLE_EXTENSIONS.has(path.extname(file.path).toLowerCase())) continue;
    for (const match of file.source.matchAll(/@font-face[\s\S]{0,1000}?font-family\s*:\s*["']?([^;"'}\n]+)["']?/gi)) {
      fontDeclarations.push({ family: match[1].trim(), path: file.path });
    }
  }
  if (usesNextFont) fontPackages.push("next/font");

  const iconPackages = ICON_PACKAGES.filter((name) => hasPackage(packages, name));
  const localIconDirectories = uniqueSorted(files
    .filter((file) => path.extname(file.path).toLowerCase() === ".svg" && /(?:^|\/)(?:icons?|assets)(?:\/|$)/i.test(file.path))
    .map((file) => toPosix(path.dirname(file.path))));
  return {
    fonts: {
      declarations: sortedObjects(fontDeclarations, ["path", "family"]),
      files: uniqueSorted(fontFiles),
      packages: uniqueSorted(fontPackages)
    },
    icons: {
      local_directories: localIconDirectories,
      packages: iconPackages
    }
  };
}

function resolveBrandContract(contractInput) {
  if (!contractInput) return null;
  const outer = contractInput.frontend_contract || contractInput;
  const candidate = outer.brand_contract || (outer.mode === "agent_brand_contract" ? outer : null);
  if (!candidate || candidate.schema_version !== "2.0" || candidate.mode !== "agent_brand_contract" || typeof candidate.contract_version !== "string") {
    throw new Error("Repository inspection requires Brand Contract V2 (schema_version=2.0) when --brand or --contract is used.");
  }
  const rules = Array.isArray(candidate.rules) ? candidate.rules : [];
  return {
    schema_version: candidate.schema_version,
    contract_version: candidate.contract_version,
    brand_id: candidate.brand && typeof candidate.brand.id === "string" ? candidate.brand.id : null,
    brand_name: candidate.brand && typeof candidate.brand.name === "string" ? candidate.brand.name : null,
    rules: {
      total: rules.length,
      hard: rules.filter((rule) => rule?.level === "hard").length,
      local_static: rules.filter((rule) => rule?.enforcement === "local_static" && rule?.verification?.available_in_v1 !== false).length
    }
  };
}

function buildCoverage({ brandContract, components, framework, frontendRoots, styling }) {
  const supported = [];
  const bestEffort = [];
  const unsupported = [];
  if (["nextjs", "react"].includes(framework.primary_framework)) supported.push(framework.primary_framework);
  for (const system of styling.systems) {
    (system.tier === "supported" ? supported : bestEffort).push(system.id);
  }
  if (frontendRoots.length > 1) bestEffort.push("multiple_frontend_applications");
  if (styling.custom_token_compilers.length) bestEffort.push("custom_token_compiler");
  for (const item of framework.frameworks.filter((entry) => entry.tier === "unsupported")) unsupported.push(item.id);
  if (framework.primary_framework === "unknown") unsupported.push("unknown_frontend_framework");

  let status = "supported";
  if (!["nextjs", "react"].includes(framework.primary_framework)) status = "unsupported";
  else if (bestEffort.length || unsupported.length || frontendRoots.length > 1) status = "best_effort";

  const unverified = ["rendered_visual_fidelity", "responsive_behavior", "runtime_component_behavior"];
  if (!brandContract) unverified.push("brand_contract_v2");
  if (!components.reusable.length) unverified.push("reusable_component_inventory");

  return {
    agent_readiness: brandContract && status === "supported"
      ? "ready"
      : brandContract && status === "best_effort"
        ? "best_effort"
        : "not_ready",
    best_effort: uniqueSorted(bestEffort),
    status,
    supported: uniqueSorted(supported),
    unsupported: uniqueSorted(unsupported),
    unverified: uniqueSorted(unverified)
  };
}

function inspectRepository(options = {}) {
  const root = path.resolve(String(options.cwd || process.cwd()));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Repository root does not exist or is not a directory: ${root}`);
  }
  const brandContract = resolveBrandContract(options.contract || null);
  const walked = walkRepository(root, options.limits || {});
  const warnings = [...walked.warnings];
  const packages = parsePackages(walked.readable, warnings);
  const frontendRoots = frontendPackageRoots(packages);
  const framework = detectFrameworks(packages, walked.readable, walked.files);
  const styling = detectStyling(packages, walked.readable, walked.files, warnings);
  const components = detectComponents(packages, walked.readable, walked.files);
  const layout = detectLayout(walked.readable, components);
  const assets = detectAssets(packages, walked.readable, walked.files);
  const coverage = buildCoverage({ brandContract, components, framework, frontendRoots, styling });

  if (!brandContract) warnings.push("Brand Contract V2 was not provided; repository patterns can be inspected, but Perture brand mapping is not ready.");
  if (!components.reusable.length) warnings.push("No reusable React component exports were identified with deterministic filename/export heuristics.");
  if (walked.scan.truncated) warnings.push("Inspection coverage is incomplete because a repository safety limit was reached.");

  const stack = {
    framework,
    frontend_package_roots: frontendRoots.map((item) => item.root),
    languages: detectLanguages(walked.files),
    package_manager: detectPackageManager(walked.files),
    source_roots: detectSourceRoots(walked.files)
  };
  const guidance = {
    do_not_introduce: [
      "parallel component primitives without a documented implementation reason",
      "a second token system when a compatible project token source exists",
      "a new icon package when an existing icon package satisfies the task"
    ],
    preferred_component_directories: components.directories.slice(0, 20),
    preferred_style_systems: styling.systems.map((item) => item.id),
    reuse_first: true,
    token_sources: uniqueSorted([
      ...styling.token_files,
      ...styling.theme_files,
      ...styling.css_variable_sources.map((item) => item.path)
    ]).slice(0, 40)
  };

  const stableEvidence = {
    schema_version: REPOSITORY_INSPECTION_SCHEMA_VERSION,
    brand_contract: brandContract,
    stack,
    styling,
    components,
    layout,
    assets,
    coverage,
    guidance,
    file_fingerprints: walked.readable.map((file) => ({ path: file.path, hash: file.hash }))
  };

  return {
    schema_version: REPOSITORY_INSPECTION_SCHEMA_VERSION,
    inspection_version: versionFor(stableEvidence),
    mode: "repository_intelligence",
    status: coverage.status,
    agent_readiness: coverage.agent_readiness,
    root: ".",
    brand_contract: brandContract,
    stack,
    styling,
    components,
    layout,
    assets,
    coverage,
    guidance,
    privacy: {
      paths_are_relative: true,
      source_code_in_report: false,
      source_uploaded: false
    },
    scan: walked.scan,
    warnings: uniqueSorted(warnings)
  };
}

module.exports = {
  inspectRepository,
  resolveBrandContract
};
