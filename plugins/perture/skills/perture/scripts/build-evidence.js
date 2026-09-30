const fs = require("node:fs");
const path = require("node:path");
const { sha256 } = require("./interface-provenance");

// Hash the exact deployable build. Cache and diagnostic traces are not deployed.
function hashBuildOutput(cwd, directory) {
  if (!directory) return null; // A dev server can be reviewed, but cannot authorize deployment.
  const root = fs.realpathSync(cwd);
  const target = fs.realpathSync(path.resolve(root, directory));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Build evidence must be a directory inside the repository.");
  const rows = [], queue = [target];
  let bytes = 0;
  for (let index = 0; index < queue.length; index++) for (const entry of fs.readdirSync(queue[index], { withFileTypes: true })) {
    if (entry.name === ".DS_Store" || queue[index] === target && ["cache", "trace", "trace-build"].includes(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error("Symlinked build evidence is unsupported.");
    const file = path.join(queue[index], entry.name);
    if (entry.isDirectory()) queue.push(file);
    else if (entry.isFile()) {
      bytes += fs.statSync(file).size;
      if (rows.length >= 30000 || bytes > 500 * 1024 * 1024) throw new Error("Build evidence exceeded its safety limit; never truncate a deploy approval.");
      rows.push({ file: path.relative(target, file).replace(/\\/g, "/"), sha256: sha256(fs.readFileSync(file)) });
    }
  }
  if (!rows.length) throw new Error("An empty build cannot authorize deployment.");
  return sha256(JSON.stringify(rows.sort((a, b) => a.file.localeCompare(b.file))));
}
module.exports = { hashBuildOutput };
