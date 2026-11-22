import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const impl = process.env.IMPL || path.join(here, "mend-ref.ts");
const pj = path.resolve(here, "../../kits/hidden-spec-cli-01-run-20261122-kit/program/generator/practice.json");
const checks = JSON.parse(fs.readFileSync(pj, "utf8")).checks;

function walk(dir, base = "") {
  const out = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + "/" + e.name : e.name;
    if (e.isDirectory()) Object.assign(out, walk(path.join(dir, e.name), rel));
    else out[rel] = fs.readFileSync(path.join(dir, e.name), "utf8");
  }
  return out;
}

let pass = 0;
const only = process.argv[2];
for (const [idx, c] of checks.entries()) {
  if (only !== undefined && String(idx) !== only) continue;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mend-"));
  for (const [p, t] of Object.entries(c.files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), t);
  }
  const r = spawnSync("node", [impl, ...c.argv], { cwd: dir, input: c.stdin ?? "", encoding: "utf8" });
  const expected = { ...c.files };
  for (const [p, t] of Object.entries(c.expect.changes)) {
    if (t === null) delete expected[p];
    else expected[p] = t;
  }
  const actual = walk(dir);
  const problems = [];
  if (r.status !== c.expect.exit) problems.push(`exit ${r.status} != ${c.expect.exit}`);
  if (r.stdout !== c.expect.stdout) problems.push(`stdout ${JSON.stringify(r.stdout)} != ${JSON.stringify(c.expect.stdout)}`);
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const k of [...keys].sort()) {
    if (expected[k] !== actual[k]) problems.push(`file ${k}: ${JSON.stringify(actual[k])} != ${JSON.stringify(expected[k])}`);
  }
  if (problems.length === 0) pass++;
  else {
    console.log(`FAIL #${idx} ${c.group}/${c.family} argv=${JSON.stringify(c.argv)}`);
    for (const p of problems) console.log("   " + p.slice(0, 600));
    if (r.stderr) console.log("   stderr: " + r.stderr.slice(0, 300));
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`passed ${pass}/${only !== undefined ? 1 : checks.length}`);
