// Shared helpers for the generators in tests/gen/. Every expected value in the generators is written by hand from SPEC.md.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Lines joined by LF, with a final LF. */
export const lines = (...ls) => ls.join('\n') + '\n';
/** Standard output: each line ended by LF. */
export const out = (...ls) => ls.map((l) => l + '\n').join('');
/** Exit-1 output: error lines then the failed line. */
export const failOut = (errs, k, n) => out(...errs, `failed: ${k} of ${n} edits`);

/** One SEARCH/REPLACE block (no path line when path is null). */
export const block = (path, oldLines, newLines) => [
  ...(path === null ? [] : [path]),
  '<<<<<<< SEARCH',
  ...oldLines,
  '=======',
  ...newLines,
  '>>>>>>> REPLACE',
];

const here = dirname(fileURLToPath(import.meta.url));

/**
 * suite(section, group): t(family, spec) adds a check. spec fields:
 *   patch    text of the patch file (written to patchName, default p.patch; argv defaults to [patchName])
 *   argv, stdin, files   as in practice.json (files do not need to hold the patch)
 *   exit     expected exit code (default 0)
 *   stdout   expected standard output
 *   changes  {path: newBytes | null} relative to files (the patch file included)
 *   note     free text for ambiguous sentences
 */
export function suite(section, group) {
  const checks = [];
  const t = (family, o) => {
    const files = { ...(o.files ?? {}) };
    let argv = o.argv;
    if (o.patch !== undefined) {
      const name = o.patchName ?? 'p.patch';
      files[name] = o.patch;
      argv ??= [name];
    }
    if (argv === undefined) throw new Error(`no argv for ${family}`);
    if (o.stdout === undefined) throw new Error(`no stdout for ${family}`);
    const key = `spec-${section}-${String(checks.length + 1).padStart(3, '0')}`;
    const c = { key, group, family, argv, stdin: o.stdin ?? null, files, expect: { exit: o.exit ?? 0, stdout: o.stdout, changes: o.changes ?? {} } };
    if (o.note) c.note = o.note;
    checks.push(c);
  };
  const write = () => {
    const fams = new Set();
    for (const c of checks) {
      if (fams.has(c.family)) throw new Error(`duplicate family ${c.family}`);
      fams.add(c.family);
    }
    writeFileSync(join(here, `spec-${section}.json`), JSON.stringify({ schema: 'hidden-spec-cli-01/pool/v1', checks }, null, 1) + '\n');
    process.stdout.write(`spec-${section}.json: ${checks.length} checks\n`);
  };
  return { t, write };
}
