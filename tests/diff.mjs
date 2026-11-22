// Differential-testing harness for two implementations of `mend` (SPEC.md): ../main.ts ("main") and ../ref/mend-ref.ts ("ref").
//
//   node tests/diff.mjs [--limit N] [--seed S] [--concurrency C] [--only t1,t2] [--det N] [--list]
//       loads the corpora, generates N mutated cases (default 3200), runs both implementations on every case,
//       writes tests/diff-out/disagreements.jsonl (+ nondeterminism.jsonl) and prints a summary.
//   node tests/diff.mjs --minimize [--min-max M] [--min-budget B] [--loose]
//       shrinks disagreements from tests/diff-out/disagreements.jsonl (or `--in a.jsonl,b.jsonl`) into tests/diff-out/minimized.jsonl
//       (and prints / writes minimized-report.txt). Runs the generation step first when disagreements.jsonl is absent.
//
// Plain Node 22 ESM, standard library only. Nothing outside tests/diff-out is written (besides OS temp dirs).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const IMPL = { main: join(ROOT, 'main.ts'), ref: join(ROOT, 'ref', 'mend-ref.ts') };
// --impl-a / --impl-b override the implementations (used to self-test the harness with a deliberately broken copy)
if (process.argv.includes('--impl-a')) IMPL.main = resolve(process.argv[process.argv.indexOf('--impl-a') + 1]);
if (process.argv.includes('--impl-b')) IMPL.ref = resolve(process.argv[process.argv.indexOf('--impl-b') + 1]);
const PRACTICE = resolve(ROOT, '../kits/hidden-spec-cli-01-run-20261122-kit/program/generator/practice.json');
const OUT = process.argv.includes('--out') ? resolve(process.argv[process.argv.indexOf('--out') + 1]) : join(HERE, 'diff-out');
const TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------------------------- args
const argvIn = process.argv.slice(2);
const opt = (name, def) => {
  const i = argvIn.indexOf(name);
  return i >= 0 && i + 1 < argvIn.length ? argvIn[i + 1] : def;
};
const flag = (name) => argvIn.includes(name);
const LIMIT = Number(opt('--limit', 3200));
const SYNTH = Number(opt('--synth', 1600));
const SEED = Number(opt('--seed', 1));
const CONC = Number(opt('--concurrency', 8));
const ONLY = opt('--only', null)?.split(',');
const DET = Number(opt('--det', 200));
const MIN_MAX = Number(opt('--min-max', 200));
const MIN_BUDGET = Number(opt('--min-budget', 250));
const LOOSE = flag('--loose');

// ---------------------------------------------------------------------------------------------- prng
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const f = mulberry32(seed);
  const r = {
    f,
    int: (n) => Math.floor(f() * n),
    range: (a, b) => a + Math.floor(f() * (b - a + 1)),
    chance: (p) => f() < p,
    pick: (arr) => arr[Math.floor(f() * arr.length)],
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    },
  };
  return r;
}

// ---------------------------------------------------------------------------------------------- running
const enc = (buf) => {
  const s = buf.toString('utf8');
  return Buffer.from(s, 'utf8').equals(buf) ? s : 'base64:' + buf.toString('base64');
};
const unsafeInDir = (work, p) => {
  const full = resolve(work, p);
  return p === '' || !(full.startsWith(work + sep));
};
function walk(dir, base, out, skip) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = base ? base + '/' + name : name;
    if (skip && skip === p) continue;
    const st = lstatSync(p);
    if (st.isDirectory()) walk(p, rel, out, skip);
    else if (st.isFile()) out[rel] = readFileSync(p);
  }
}

/** Run one implementation on one case. Returns {exit, stdout:Buffer, files:{path:Buffer}, stderr:string}. */
function runImpl(impl, c) {
  return new Promise((res) => {
    const root = mkdtempSync(join(tmpdir(), 'mdiff-'));
    const work = join(root, 'work');
    mkdirSync(work);
    try {
      for (const [p, t] of Object.entries(c.files)) {
        if (unsafeInDir(work, p)) continue;
        mkdirSync(dirname(join(work, p)), { recursive: true });
        writeFileSync(join(work, p), t);
      }
    } catch (e) {
      rmSync(root, { recursive: true, force: true });
      return res({ exit: -1, stdout: Buffer.from('materialize-failed'), files: {}, stderr: String(e) });
    }
    const env = { ...process.env };
    delete env.MAKEFUN_ENV_URL;
    const child = spawn(process.execPath, [impl, ...c.argv], { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const so = []; const se = []; let soN = 0;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { if (soN < 1 << 20) { so.push(d); soN += d.length; } });
    child.stderr.on('data', (d) => { if (se.reduce((a, b) => a + b.length, 0) < 1 << 16) se.push(d); });
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(c.stdin ?? ''));
    child.on('error', () => {});
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const files = {};
      try {
        walk(work, '', files, null);
        // anything escaping the work dir (e.g. `../x`) lands in root; record it
        const outside = {};
        walk(root, '', outside, work);
        for (const [k, v] of Object.entries(outside)) files['<outside>/' + k] = v;
      } catch { /* ignore */ }
      rmSync(root, { recursive: true, force: true });
      res({
        exit: timedOut ? 124 : code ?? (signal ? 'sig:' + signal : -2),
        stdout: Buffer.concat(so),
        files,
        stderr: Buffer.concat(se).toString('utf8'),
      });
    });
  });
}

const isCrash = (r) => ![0, 1, 2].includes(r.exit) || /\n\s+at\s/.test(r.stderr) || /Error:|ERR_/.test(r.stderr);

function serialize(r) {
  const files = {};
  for (const k of Object.keys(r.files).sort()) files[k] = enc(r.files[k]);
  const o = { exit: r.exit, stdout: enc(r.stdout), files };
  if (isCrash(r)) o.stderr = r.stderr.slice(0, 400);
  return o;
}

function firstLineKind(buf, which) {
  const lines = buf.toString('utf8').split('\n');
  return lines[which] ?? '';
}
const tok = (l) => l.replace(/\d+/g, 'N').split(/[ :]/).slice(0, 2).join(' ').slice(0, 24);

/** Compare two results. Returns null when equal, else {aspects, first, sig}. */
function compareResults(a, b) {
  const aspects = [];
  if (a.exit !== b.exit) aspects.push('exit');
  if (!a.stdout.equals(b.stdout)) aspects.push('stdout');
  const keys = new Set([...Object.keys(a.files), ...Object.keys(b.files)]);
  const fd = [];
  for (const k of [...keys].sort()) {
    const x = a.files[k]; const y = b.files[k];
    if (!x || !y || !x.equals(y)) fd.push(k);
  }
  if (fd.length) aspects.push('files');
  if (!aspects.length) return null;
  const first = aspects[0];
  let sig = `${first}|${a.exit}/${b.exit}`;
  if (aspects.includes('stdout')) {
    const al = a.stdout.toString('utf8').split('\n'); const bl = b.stdout.toString('utf8').split('\n');
    let i = 0;
    while (i < al.length && i < bl.length && al[i] === bl[i]) i++;
    sig += `|out:${tok(al[i] ?? '<end>')} vs ${tok(bl[i] ?? '<end>')}`;
  }
  if (aspects.includes('files')) {
    const kinds = fd.map((k) => (!a.files[k] ? 'ref-only' : !b.files[k] ? 'main-only' : 'content'));
    sig += `|files:${[...new Set(kinds)].sort().join('+')}`;
  }
  return { aspects, first, sig, fileDiffs: fd };
}

async function runBoth(c) {
  const [a, b] = await Promise.all([runImpl(IMPL.main, c), runImpl(IMPL.ref, c)]);
  return { a, b, cmp: compareResults(a, b) };
}

async function pool(items, n, fn) {
  let i = 0; let done = 0;
  const results = new Array(items.length);
  const worker = async () => {
    while (true) {
      const k = i++;
      if (k >= items.length) return;
      results[k] = await fn(items[k], k);
      done++;
      if (done % 250 === 0) process.stderr.write(`  ... ${done}/${items.length}\n`);
    }
  };
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

// ---------------------------------------------------------------------------------------------- case helpers
const clone = (c) => ({ argv: c.argv.slice(), stdin: c.stdin, files: { ...c.files }, base: c.base, transforms: (c.transforms ?? []).slice() });
const caseKey = (c) => createHash('sha1').update(JSON.stringify([c.argv, c.stdin, Object.entries(c.files).sort()])).digest('hex');
const plain = (c) => ({ argv: c.argv, stdin: c.stdin, files: c.files });

function positional(argv) {
  const out = []; let dd = false;
  for (const a of argv) {
    if (!dd && a === '--') { dd = true; continue; }
    if (!dd && a.startsWith('-') && a !== '-') continue;
    out.push(a);
  }
  return out;
}
function patchRef(c) {
  const pos = positional(c.argv);
  if (pos.length === 0 || pos[0] === '-') return { kind: 'stdin' };
  if (pos.length === 1 && Object.hasOwn(c.files, pos[0])) return { kind: 'file', name: pos[0] };
  return null;
}
function getPatch(c) {
  const r = patchRef(c);
  if (!r) return null;
  return r.kind === 'stdin' ? c.stdin : c.files[r.name];
}
function setPatch(c, text) {
  const r = patchRef(c);
  if (r.kind === 'stdin') c.stdin = text; else c.files[r.name] = text;
}
function targets(c) {
  const r = patchRef(c);
  return Object.keys(c.files).filter((p) => !(r && r.kind === 'file' && r.name === p));
}
function validFiles(files) {
  const ps = Object.keys(files);
  for (const p of ps) for (const q of ps) if (p !== q && q.startsWith(p + '/')) return false;
  return true;
}

function fmtOf(p) {
  if (p == null) return null;
  const ls = p.split('\n').map((l) => l.replace(/\r$/, ''));
  const first = ls.find((l) => l.trim() !== '');
  if (first !== undefined && first.trim() === '*** Begin Patch') return 'v4a';
  if (first !== undefined && /^\s*[[{]/.test(first)) return 'json';
  if (ls.some((l) => l.replace(/\s+$/, '') === '<<<<<<< SEARCH')) return 'sr';
  if (ls.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (ls[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** role of each patch line: hdr, ctx, old, new, nonl, meta, marker, other; pre = marker char count. */
function classify(ls, fmt) {
  const n = ls.length - (ls[ls.length - 1] === '' ? 1 : 0);
  const R = ls.map(() => ({ role: 'other', pre: 0 }));
  const s = (i) => ls[i].replace(/\r$/, '');
  if (fmt === 'sr') {
    let st = 0;
    for (let i = 0; i < n; i++) {
      const t = s(i).replace(/\s+$/, '');
      if (st === 0) { if (t === '<<<<<<< SEARCH') { R[i].role = 'marker'; st = 1; } }
      else if (st === 1) { if (t === '=======') { R[i].role = 'marker'; st = 2; } else R[i].role = 'old'; }
      else if (t === '>>>>>>> REPLACE') { R[i].role = 'marker'; st = 0; } else R[i].role = 'new';
    }
  } else if (fmt === 'unified') {
    let inH = false;
    for (let i = 0; i < n; i++) {
      const l = s(i);
      if (/^@@/.test(l)) { R[i].role = 'hdr'; inH = true; }
      else if (l.startsWith('diff --git ')) { R[i].role = 'meta'; inH = false; }
      else if (l.startsWith('--- ') && i + 1 < n && s(i + 1).startsWith('+++ ')) { R[i].role = 'meta'; inH = false; }
      else if (l.startsWith('+++ ') && i > 0 && R[i - 1].role === 'meta' && s(i - 1).startsWith('--- ')) R[i].role = 'meta';
      else if (inH) {
        if (l === '') R[i] = { role: 'ctx', pre: 0 };
        else if (l[0] === ' ') R[i] = { role: 'ctx', pre: 1 };
        else if (l[0] === '-') R[i] = { role: 'old', pre: 1 };
        else if (l[0] === '+') R[i] = { role: 'new', pre: 1 };
        else if (l[0] === '\\') R[i] = { role: 'nonl', pre: 0 };
        else inH = false;
      }
    }
  } else if (fmt === 'v4a') {
    for (let i = 0; i < n; i++) {
      const l = s(i);
      if (l.startsWith('***')) R[i].role = 'meta';
      else if (l.startsWith('@@')) R[i].role = 'hdr';
      else if (l === '') R[i] = { role: 'ctx', pre: 0 };
      else if (l[0] === ' ') R[i] = { role: 'ctx', pre: 1 };
      else if (l[0] === '-') R[i] = { role: 'old', pre: 1 };
      else if (l[0] === '+') R[i] = { role: 'new', pre: 1 };
    }
  }
  return R;
}
/** groups of old-side lines (ctx + old) per hunk/block */
function extractOs(ls, fmt) {
  const R = classify(ls, fmt);
  const groups = []; let cur = null;
  for (let i = 0; i < R.length; i++) {
    const { role, pre } = R[i];
    if (role === 'hdr' || role === 'meta' || (fmt === 'sr' && role === 'marker' && /SEARCH/.test(ls[i]))) { cur = []; groups.push(cur); continue; }
    if ((role === 'ctx' || role === 'old') && cur) cur.push(ls[i].replace(/\r$/, '').slice(pre));
  }
  return groups.filter((g) => g.length);
}

const fsplit = (t) => {
  const i = t.indexOf('\n');
  const eol = i > 0 && t[i - 1] === '\r' ? '\r\n' : '\n';
  let ls = t.split(eol); let fin = false;
  if (t.endsWith(eol)) { ls.pop(); fin = true; }
  if (t === '') ls = [];
  return { ls, eol, fin };
};
const fjoin = ({ ls, eol, fin }) => (ls.length ? ls.join(eol) + (fin ? eol : '') : '');
const withCR = (l, f) => { const m = /\r$/.test(l); const b = l.replace(/\r$/, ''); return f(b) + (m ? '\r' : ''); };

function indentLine(rng, mode, body) {
  const m = /^[ \t]*/.exec(body)[0];
  const rest = body.slice(m.length);
  switch (mode) {
    case 'add2': return '  ' + body;
    case 'add4': return '    ' + body;
    case 'addtab': return '\t' + body;
    case 'addsp1': return ' ' + body;
    case 'rm2': return body.replace(/^ {1,2}/, '');
    case 'rm1tab': return body.replace(/^\t/, '');
    case 'rmall': return rest;
    case 'sp2tab': return m.replace(/ {4}/g, '\t').replace(/ {2}/g, '\t') + rest;
    case 'tab2sp': return m.replace(/\t/g, '    ') + rest;
    case 'tab2sp2': return m.replace(/\t/g, '  ') + rest;
    case 'mix': return (rng.chance(0.5) ? ' \t' : '\t ') + body;
    default: return body;
  }
}
const INDENT_MODES = ['add2', 'add4', 'addtab', 'addsp1', 'rm2', 'rm1tab', 'rmall', 'sp2tab', 'tab2sp', 'tab2sp2', 'mix'];
const WS = [' ', '\t', '  ', ' \t', '   '];

const jsonEsc = (s) => JSON.stringify(s).slice(1, -1);
function replacePathIn(patch, fmt, oldP, newP) {
  if (fmt === 'json') return patch.split(jsonEsc(oldP)).join(jsonEsc(newP));
  return patch.split(oldP).join(newP);
}

// ---------------------------------------------------------------------------------------------- transforms
const T = [];
const def = (name, fn) => T.push({ name, fn });
/** edit patch lines: f(ls, R, fmt, rng) mutates and returns ls (or null) */
const onPatchLines = (name, f) => def(name, (c, rng) => {
  const p = getPatch(c); if (p == null) return false;
  const fmt = fmtOf(p);
  const ls = p.split('\n');
  const out = f(ls, classify(ls, fmt), fmt, rng, c);
  if (!out) return false;
  setPatch(c, out.join('\n'));
  return true;
});
const realIdx = (ls) => ls.map((_, i) => i).filter((i) => !(i === ls.length - 1 && ls[i] === ''));
const onPatchText = (name, f) => def(name, (c, rng) => {
  const p = getPatch(c); if (p == null) return false;
  const out = f(p, fmtOf(p), rng, c);
  if (out == null) return false;
  setPatch(c, out);
  return true;
});
const onFiles = (name, f, all = false) => def(name, (c, rng) => {
  const ts = targets(c); if (!ts.length) return false;
  const chosen = all || rng.chance(0.3) ? ts : [rng.pick(ts)];
  let any = false;
  for (const t of chosen) {
    const out = f(c.files[t], rng, t, c);
    if (out != null && out !== c.files[t]) { c.files[t] = out; any = true; }
  }
  return any;
});

// ---- patch: line endings / final newline / whitespace
onPatchText('patch-crlf', (p) => p.replace(/\r?\n/g, '\r\n'));
onPatchText('patch-crlf-partial', (p, f, rng) => p.split('\n').map((l) => (rng.chance(0.4) ? l.replace(/\r$/, '') + '\r' : l)).join('\n'));
onPatchText('patch-double-cr', (p, f, rng) => p.split('\n').map((l) => (rng.chance(0.2) ? l + '\r' : l)).join('\n'));
onPatchText('patch-no-final-nl', (p) => (p.endsWith('\n') ? p.replace(/\r?\n$/, '') : null));
onPatchText('patch-final-blank-lines', (p, f, rng) => p + rng.pick(['\n', '\n\n', '  \n', '\t\n\n', '\r\n', '\n \n']));
onPatchText('patch-lead-blank', (p, f, rng) => rng.pick(['\n', '  \n', '\t\r\n', '\n\n', ' \n \n']) + p);
onPatchText('patch-leading-ws-first-line', (p, f, rng) => rng.pick([' ', '\t', '  ']) + p);
onPatchLines('patch-trailing-ws', (ls, R, fmt, rng) => {
  const q = rng.pick([0.1, 0.3, 0.6, 1]); const w = rng.pick(WS);
  const idx = realIdx(ls).filter(() => rng.chance(q));
  if (!idx.length) return null;
  for (const i of idx) ls[i] = withCR(ls[i], (b) => b + (rng.chance(0.5) ? w : rng.pick(WS)));
  return ls;
});
onPatchLines('patch-trailing-ws-content', (ls, R, fmt, rng) => {
  const w = rng.pick(WS);
  const idx = realIdx(ls).filter((i) => ['ctx', 'old', 'new'].includes(R[i].role) && rng.chance(0.5));
  if (!idx.length) return null;
  for (const i of idx) ls[i] = withCR(ls[i], (b) => b + w);
  return ls;
});
onPatchLines('patch-trailing-ws-oldside', (ls, R, fmt, rng) => {
  const w = rng.pick(WS);
  const idx = realIdx(ls).filter((i) => ['ctx', 'old'].includes(R[i].role));
  if (!idx.length) return null;
  for (const i of idx) ls[i] = withCR(ls[i], (b) => b + w);
  return ls;
});
onPatchLines('patch-strip-trailing-ws', (ls) => ls.map((l) => l.replace(/[ \t]+(\r?)$/, '$1')));
onPatchLines('patch-markers-trailing-ws', (ls, R, fmt, rng) => {
  const idx = realIdx(ls).filter((i) => ['marker', 'hdr', 'meta'].includes(R[i].role));
  if (!idx.length) return null;
  const i = rng.pick(idx);
  ls[i] = withCR(ls[i], (b) => b + rng.pick(WS));
  return ls;
});

// ---- patch: content indentation
def('patch-indent', (c, rng) => {
  const p = getPatch(c); if (p == null) return false;
  const fmt = fmtOf(p); if (!fmt || fmt === 'json') return false;
  const ls = p.split('\n'); const R = classify(ls, fmt);
  const mode = rng.pick(INDENT_MODES);
  const scope = rng.pick(['all', 'oldctx', 'new', 'old', 'first', 'half', 'ctx', 'last']);
  const idx = realIdx(ls).filter((i) => ['ctx', 'old', 'new'].includes(R[i].role));
  if (!idx.length) return false;
  const sel = idx.filter((i, k) => {
    const r = R[i].role;
    if (scope === 'all') return true;
    if (scope === 'oldctx') return r !== 'new';
    if (scope === 'new') return r === 'new';
    if (scope === 'old') return r === 'old';
    if (scope === 'ctx') return r === 'ctx';
    if (scope === 'first') return k === 0;
    if (scope === 'last') return k === idx.length - 1;
    return rng.chance(0.5);
  });
  if (!sel.length) return false;
  for (const i of sel) ls[i] = withCR(ls[i], (b) => b.slice(0, R[i].pre) + indentLine(rng, mode, b.slice(R[i].pre)));
  setPatch(c, ls.join('\n'));
  return true;
});
onPatchLines('patch-blank-ctx-no-space', (ls, R) => {
  let any = false;
  for (const i of realIdx(ls)) if (R[i].role === 'ctx' && R[i].pre === 1 && ls[i].replace(/\r$/, '') === ' ') { ls[i] = ls[i].slice(1); any = true; }
  return any ? ls : null;
});
onPatchLines('patch-blank-ctx-add-space', (ls, R, f, rng) => {
  let any = false;
  for (const i of realIdx(ls)) if (R[i].role === 'ctx' && ls[i].replace(/\r$/, '') === '') { ls[i] = withCR(ls[i], () => rng.pick([' ', '  ', ' \t', '\t'])); any = true; }
  return any ? ls : null;
});

// ---- patch: wrapping
onPatchText('patch-prose-fence', (p, f, rng) => {
  const pre = rng.pick(['Here is the fix:\n', 'Sure! Here you go.\n\n', 'Apply this:\n```diff\n', '```\n', '```patch\n', 'I changed the file.\n\n```\n']);
  const post = rng.pick(['', '```\n', '\nHope that helps!\n', '```\n\nLet me know.\n', '\n```\n']);
  return pre + p + (p.endsWith('\n') ? '' : '\n') + post;
});
onPatchText('patch-prose-between', (p, f, rng) => {
  const ls = p.split('\n'); const idx = realIdx(ls);
  if (idx.length < 2) return null;
  const k = rng.pick(idx);
  ls.splice(k, 0, rng.pick(['Some prose here', '```', 'Then also:', '', '#', 'diff', '--', '++++', '===']));
  return ls.join('\n');
});

// ---- patch: unified specifics
onPatchLines('unified-shift', (ls, R, fmt, rng) => {
  if (fmt !== 'unified') return null;
  const idx = realIdx(ls).filter((i) => R[i].role === 'hdr');
  if (!idx.length) return null;
  const mode = rng.pick(['small', 'small', 'big', 'neg', 'zero', 'one', 'all-same']);
  const delta = mode === 'small' ? rng.range(-6, 6) : mode === 'big' ? rng.pick([100, 1000, 99999, 2 ** 31]) : mode === 'neg' ? -rng.range(10, 500) : 0;
  for (const i of idx) {
    ls[i] = ls[i].replace(/^@@ -(\d+)(,\d+)? \+(\d+)(,\d+)?/, (m, a, b, c, d) => {
      let A = mode === 'zero' ? 0 : mode === 'one' ? 1 : Number(a) + (mode === 'all-same' ? delta : rng.range(-3, 3) + delta);
      return `@@ -${A}${b ?? ''} +${c}${d ?? ''}`;
    });
  }
  return ls;
});
onPatchLines('unified-hdr-mangle', (ls, R, fmt, rng) => {
  if (fmt !== 'unified') return null;
  const idx = realIdx(ls).filter((i) => R[i].role === 'hdr');
  if (!idx.length) return null;
  const i = rng.pick(idx);
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(ls[i].replace(/\r$/, ''));
  const A = m ? m[1] : '1';
  const v = rng.pick(['nocounts', 'text', 'bad1', 'bad2', 'bad3', 'bad4', 'zerocount', 'noclose', 'indent', 'plain', 'triple', 'ws']);
  ls[i] = {
    nocounts: `@@ -${A} +${A} @@`,
    text: `@@ -${A},3 +${A},3 @@ function foo() {`,
    bad1: `@@ -a +b @@`, bad2: `@@ -${A} @@`, bad3: `@@`, bad4: `@@@ -${A} +${A} @@@`,
    zerocount: `@@ -${A},0 +${A},0 @@`, noclose: `@@ -${A},1 +${A},1`, indent: ` @@ -${A} +${A} @@`,
    plain: `@@ ${A} @@`, triple: `@@ -${A},1 +${A},1 @@ @@ -1 +1 @@`, ws: `@@  -${A}  +${A}  @@`,
  }[v];
  return ls;
});
onPatchLines('unified-meta', (ls, R, fmt, rng) => {
  if (fmt !== 'unified') return null;
  const idx = realIdx(ls).filter((i) => R[i].role === 'meta' && ls[i].startsWith('--- '));
  if (!idx.length) return null;
  const i = rng.pick(idx);
  const old = ls[i].replace(/\r$/, ''); const nw = (ls[i + 1] ?? '').replace(/\r$/, '');
  const op = old.slice(4).split('\t')[0].trim(); const np = nw.slice(4).split('\t')[0].trim();
  const strip = (x) => x.replace(/^[ab]\//, '');
  const v = rng.pick(['tab-ts', 'noprefix', 'diffgit', 'diffgit-index', 'devnull-old', 'devnull-new', 'newpath', 'newfilemode', 'delmode', 'rename', 'swap', 'dropplus', 'index', 'spaces', 'bothprefix-a', 'diffgit-only', 'diffgit-wrongpaths', 'oldmode']);
  const ins = (...x) => ls.splice(i, 0, ...x);
  const O = strip(op); const N = strip(np);
  switch (v) {
    case 'tab-ts': ls[i] = old + '\t2024-01-01 00:00:00.000000000 +0000'; ls[i + 1] = nw + '\t2024-01-02'; break;
    case 'noprefix': ls[i] = '--- ' + O; ls[i + 1] = '+++ ' + N; break;
    case 'diffgit': ins(`diff --git a/${O} b/${N}`); break;
    case 'diffgit-index': ins(`diff --git a/${O} b/${N}`, 'index 1234567..89abcde 100644'); break;
    case 'devnull-old': ls[i] = '--- /dev/null'; break;
    case 'devnull-new': ls[i + 1] = '+++ /dev/null'; break;
    case 'newpath': ls[i + 1] = '+++ b/' + rng.pick(['moved.txt', 'sub/' + N, N + '.new', 'é.txt']); break;
    case 'newfilemode': ins(`diff --git a/${O} b/${N}`, 'new file mode 100644'); break;
    case 'delmode': ins(`diff --git a/${O} b/${N}`, 'deleted file mode 100644'); break;
    case 'rename': ins(`diff --git a/${O} b/${N}`, 'similarity index 100%', `rename from ${O}`, `rename to ${rng.pick(['moved2.txt', N + '.mv'])}`); break;
    case 'swap': [ls[i], ls[i + 1]] = [ls[i + 1], ls[i]]; break;
    case 'dropplus': ls.splice(i + 1, 1); break;
    case 'index': ins('index 1234567..89abcde 100644'); break;
    case 'spaces': ls[i] = '---   ' + op + '  '; ls[i + 1] = '+++  ' + np + '   '; break;
    case 'bothprefix-a': ls[i] = '--- a/a/' + O; ls[i + 1] = '+++ b/b/' + N; break;
    case 'diffgit-only': ls.splice(i, 2, `diff --git a/${O} b/${N}`); break;
    case 'diffgit-wrongpaths': ins(`diff --git a/zzz b/yyy`); break;
    case 'oldmode': ins(`diff --git a/${O} b/${N}`, 'old mode 100644', 'new mode 100755'); break;
  }
  return ls;
});
onPatchLines('unified-nonl-marker', (ls, R, fmt, rng) => {
  if (fmt !== 'unified') return null;
  const idx = realIdx(ls).filter((i) => ['ctx', 'old', 'new'].includes(R[i].role));
  const has = realIdx(ls).filter((i) => R[i].role === 'nonl');
  if (has.length && rng.chance(0.5)) { ls.splice(rng.pick(has), 1); return ls; }
  if (!idx.length) return null;
  const i = rng.pick(idx);
  ls.splice(i + 1, 0, rng.pick(['\\ No newline at end of file', '\\', '\\ foo']));
  return ls;
});
onPatchLines('unified-hunk-split', (ls, R, fmt, rng) => {
  if (fmt !== 'unified') return null;
  const body = realIdx(ls).filter((i) => ['ctx', 'old', 'new'].includes(R[i].role));
  if (body.length < 3) return null;
  const k = rng.pick(body.slice(1, -1));
  ls.splice(k, 0, `@@ -${rng.range(1, 30)},1 +${rng.range(1, 30)},1 @@`);
  return ls;
});

// ---- patch: S/R specifics
onPatchLines('sr-marker-variants', (ls, R, fmt, rng) => {
  if (fmt !== 'sr') return null;
  const idx = realIdx(ls).filter((i) => R[i].role === 'marker');
  if (!idx.length) return null;
  const i = rng.pick(idx);
  const t = ls[i].replace(/\s+$/, '').replace(/\r$/, '');
  const v = rng.pick(['drop', 'drop', 'dup', 'lead-sp', 'short', 'long', 'lower', 'swap-sr', 'trail-text', 'tab-trail', 'ws-only']);
  if (v === 'drop') ls.splice(i, 1);
  else if (v === 'dup') ls.splice(i, 0, ls[i]);
  else if (v === 'lead-sp') ls[i] = ' ' + ls[i];
  else if (v === 'short') ls[i] = ls[i].replace(/^([<>=])\1{6}/, (m) => m.slice(0, 5));
  else if (v === 'long') ls[i] = ls[i].replace(/^([<>=])\1{6}/, (m) => m + m[0]);
  else if (v === 'lower') ls[i] = ls[i].toLowerCase();
  else if (v === 'trail-text') ls[i] = ls[i] + ' x';
  else if (v === 'tab-trail') ls[i] = ls[i] + '\t';
  else if (v === 'ws-only') ls[i] = ' ';
  else {
    const j = rng.pick(idx);
    [ls[i], ls[j]] = [ls[j], ls[i]];
  }
  return ls;
});
onPatchLines('sr-path-variants', (ls, R, fmt, rng) => {
  if (fmt !== 'sr') return null;
  const idx = realIdx(ls).filter((i) => R[i].role === 'marker' && /SEARCH/.test(ls[i]));
  if (!idx.length) return null;
  const i = rng.pick(idx);
  const pathLine = i > 0 ? i - 1 : -1;
  const v = rng.pick(['blank-between', 'fence-between', 'ws-path', 'backtick-path', 'no-path', 'two-paths', 'fence-open', 'prose-path', 'blank-ws', 'tab-path', 'fence-only-path']);
  const orig = pathLine >= 0 ? ls[pathLine] : 'x.txt';
  if (v === 'blank-between') ls.splice(i, 0, '');
  else if (v === 'fence-between') ls.splice(i, 0, '```');
  else if (v === 'ws-path' && pathLine >= 0) ls[pathLine] = '  ' + orig.replace(/\r$/, '') + '  ';
  else if (v === 'tab-path' && pathLine >= 0) ls[pathLine] = '\t' + orig.replace(/\r$/, '') + '\t';
  else if (v === 'backtick-path' && pathLine >= 0) ls[pathLine] = '`' + orig.replace(/\r$/, '') + '`';
  else if (v === 'no-path' && pathLine >= 0) ls.splice(pathLine, 1);
  else if (v === 'two-paths') ls.splice(i, 0, 'other/file.txt');
  else if (v === 'fence-open') ls.splice(i, 0, '```js');
  else if (v === 'prose-path') ls.splice(i, 0, 'Edit the file:');
  else if (v === 'blank-ws') ls.splice(i, 0, ' \t');
  else if (v === 'fence-only-path') ls.splice(pathLine >= 0 ? pathLine : i, 0, '```' + orig.replace(/\r$/, ''));
  else return null;
  return ls;
});
onPatchLines('sr-empty-old-or-new', (ls, R, fmt, rng) => {
  if (fmt !== 'sr') return null;
  const olds = realIdx(ls).filter((i) => R[i].role === 'old');
  const news = realIdx(ls).filter((i) => R[i].role === 'new');
  const v = rng.pick(['clear-old', 'clear-new', 'blank-old', 'blank-new']);
  const targetIdx = v.endsWith('old') ? olds : news;
  if (!targetIdx.length) return null;
  if (v.startsWith('clear')) { const s = new Set(targetIdx); return ls.filter((_, i) => !s.has(i)); }
  ls.splice(targetIdx[0], 0, ...Array(rng.range(1, 2)).fill(rng.pick(['', ' ', '\t'])));
  return ls;
});

// ---- patch: v4a specifics
onPatchLines('v4a-structure', (ls, R, fmt, rng, c) => {
  if (fmt !== 'v4a') return null;
  const idx = realIdx(ls);
  const v = rng.pick(['drop-end', 'drop-begin', 'eof-marker', 'anchor', 'blank-between', 'trail-ws-hdr', 'lead-ws-hdr', 'lower-hdr', 'move', 'empty-anchor', 'double-end', 'content-after-end', 'prose-before', 'eof-mid', 'blank-in-chunk']);
  const find = (re) => idx.filter((i) => re.test(ls[i].replace(/\r$/, '')));
  switch (v) {
    case 'drop-end': { const e = find(/^\s*\*\*\* End Patch\s*$/); if (!e.length) return null; ls.splice(e[e.length - 1], 1); break; }
    case 'drop-begin': { const e = find(/^\s*\*\*\* Begin Patch\s*$/); if (!e.length) return null; ls.splice(e[0], 1); break; }
    case 'eof-marker': { const e = find(/^\s*\*\*\* End Patch\s*$/); if (!e.length) return null; ls.splice(e[e.length - 1], 0, '*** End of File'); break; }
    case 'anchor': { const e = find(/^\*\*\* Update File:/); if (!e.length) return null; const t = targets(c).map((t) => fsplit(c.files[t]).ls).flat().filter((l) => l.trim());
      ls.splice(e[0] + 1, 0, '@@ ' + (t.length ? rng.pick(t) : 'anchor')); break; }
    case 'blank-between': { const e = find(/^\*\*\* (Add|Update|Delete) File:/); if (!e.length) return null; ls.splice(rng.pick(e), 0, rng.pick(['', '  ', '\t'])); break; }
    case 'trail-ws-hdr': { const e = find(/^\*\*\*/); if (!e.length) return null; const i = rng.pick(e); ls[i] = withCR(ls[i], (b) => b + rng.pick(WS)); break; }
    case 'lead-ws-hdr': { const e = find(/^\*\*\*/); if (!e.length) return null; const i = rng.pick(e); ls[i] = rng.pick(WS) + ls[i]; break; }
    case 'lower-hdr': { const e = find(/^\*\*\* (Add|Update|Delete) File:/); if (!e.length) return null; const i = rng.pick(e); ls[i] = ls[i].replace(/\*\*\* (\w+) File/, (m, w) => `*** ${w.toLowerCase()} File`); break; }
    case 'move': { const e = find(/^\*\*\* Update File:/); if (!e.length) return null; ls.splice(e[0] + 1, 0, '*** Move to: ' + rng.pick(['moved.txt', 'sub/dir/moved.txt', 'é.txt', '../x', 'a\\b'])); break; }
    case 'empty-anchor': { const e = find(/^\*\*\* Update File:/); if (!e.length) return null; ls.splice(e[0] + 1, 0, '@@'); break; }
    case 'double-end': { const e = find(/^\s*\*\*\* End Patch\s*$/); if (!e.length) return null; ls.splice(e[e.length - 1], 0, '*** End Patch'); break; }
    case 'content-after-end': { const e = find(/^\s*\*\*\* End Patch\s*$/); if (!e.length) return null; ls.splice(e[e.length - 1] + 1, 0, 'trailing prose'); break; }
    case 'prose-before': { ls.unshift('Here is the patch:'); break; }
    case 'eof-mid': { const b = idx.filter((i) => ['ctx', 'old', 'new'].includes(R[i].role)); if (!b.length) return null; ls.splice(rng.pick(b) + 1, 0, '*** End of File'); break; }
    case 'blank-in-chunk': { const b = idx.filter((i) => ['ctx', 'old', 'new'].includes(R[i].role)); if (!b.length) return null; ls.splice(rng.pick(b), 0, rng.pick(['', ' '])); break; }
  }
  return ls;
});

// ---- patch: generic line ops
onPatchLines('patch-delete-lines', (ls, R, fmt, rng) => {
  const idx = realIdx(ls); if (idx.length < 2) return null;
  const k = rng.range(1, Math.min(3, idx.length - 1));
  const del = new Set(rng.shuffle(idx).slice(0, k));
  return ls.filter((_, i) => !del.has(i));
});
onPatchLines('patch-delete-body-line', (ls, R, fmt, rng) => {
  const idx = realIdx(ls).filter((i) => ['ctx', 'old', 'new'].includes(R[i].role));
  if (!idx.length) return null;
  ls.splice(rng.pick(idx), 1);
  return ls;
});
onPatchLines('patch-truncate-lines', (ls, R, fmt, rng) => {
  const idx = realIdx(ls); if (idx.length < 2) return null;
  const k = rng.range(1, idx.length - 1);
  return ls.slice(0, k).concat(rng.chance(0.5) ? [''] : []);
});
onPatchText('patch-truncate-chars', (p, f, rng) => (p.length < 4 ? null : p.slice(0, rng.range(1, p.length - 1))));
onPatchLines('patch-insert-blank', (ls, R, fmt, rng) => {
  const idx = realIdx(ls); if (!idx.length) return null;
  const n = rng.range(1, 3);
  for (let k = 0; k < n; k++) ls.splice(rng.int(ls.length), 0, rng.pick(['', '', ' ', '\t', '\r']));
  return ls;
});
onPatchLines('patch-swap-adjacent', (ls, R, fmt, rng) => {
  const idx = realIdx(ls); if (idx.length < 3) return null;
  const i = rng.pick(idx.slice(0, -1)); [ls[i], ls[i + 1]] = [ls[i + 1], ls[i]];
  return ls;
});
onPatchLines('patch-swap-marker-lines', (ls, R, fmt, rng) => {
  const idx = realIdx(ls).filter((i) => ['marker', 'hdr', 'meta'].includes(R[i].role));
  if (idx.length < 2) return null;
  const a = rng.pick(idx); let b = rng.pick(idx); if (a === b) b = idx[(idx.indexOf(a) + 1) % idx.length];
  [ls[a], ls[b]] = [ls[b], ls[a]];
  return ls;
});
onPatchLines('patch-dup-line', (ls, R, fmt, rng) => {
  const idx = realIdx(ls); if (!idx.length) return null;
  const i = rng.pick(idx); ls.splice(i, 0, ls[i]); return ls;
});
onPatchLines('patch-flip-marker-char', (ls, R, fmt, rng) => {
  const idx = realIdx(ls).filter((i) => R[i].pre === 1 && ['old', 'new', 'ctx'].includes(R[i].role));
  if (!idx.length) return null;
  const i = rng.pick(idx); const m = { '-': '+', '+': '-', ' ': '-' }[ls[i][0]];
  ls[i] = m + ls[i].slice(1); return ls;
});
onPatchLines('patch-body-to-other-marker', (ls, R, fmt, rng) => {
  const idx = realIdx(ls).filter((i) => R[i].pre === 1 && ['old', 'new', 'ctx'].includes(R[i].role));
  if (!idx.length) return null;
  const i = rng.pick(idx); ls[i] = rng.pick(['!', '#', '*', '\t', '>', '~']) + ls[i].slice(1); return ls;
});
onPatchText('patch-empty', (p, f, rng) => rng.pick(['', '\n', '   \n\t\n', 'hello world\n', '```\n```\n']));
onPatchText('patch-tail-only-header', (p, f, rng) => {
  const ls = p.split('\n'); const idx = realIdx(ls);
  const k = idx.findIndex((i, j) => j > 0 && /^(@@|<<<<<<<|\*\*\* (Update|Add))/.test(ls[i]));
  return k > 0 ? ls.slice(0, idx[k] + 1).join('\n') + '\n' : null;
});
onPatchText('patch-nbsp-bom', (p, f, rng) => rng.pick(['﻿', ' ', '​']) + p);

// ---- patch: duplicate / extra edits
def('patch-dup-edit', (c, rng) => {
  const p = getPatch(c); if (p == null) return false;
  const fmt = fmtOf(p);
  const nl = p.endsWith('\n') ? p : p + '\n';
  if (fmt === 'unified' || fmt === 'sr') { setPatch(c, nl + (rng.chance(0.3) ? '\n' : '') + nl); return true; }
  if (fmt === 'v4a') {
    const ls = p.split('\n'); const b = ls.findIndex((l) => l.trim() === '*** Begin Patch');
    let e = -1; for (let i = ls.length - 1; i >= 0; i--) if (ls[i].trim() === '*** End Patch') { e = i; break; }
    if (b < 0 || e < 0 || e <= b + 1) return false;
    const inner = ls.slice(b + 1, e);
    setPatch(c, [...ls.slice(0, e), ...inner, ...ls.slice(e)].join('\n'));
    return true;
  }
  if (fmt === 'json') {
    const j = jparse(p); if (!j) return false;
    const k = rng.int(j.edits.length);
    j.edits.splice(k + 1, 0, JSON.parse(JSON.stringify(j.edits[k])));
    setPatch(c, jser(j, rng));
    return true;
  }
  return false;
});
const NAMES = ['b.txt', 'a.txt', 'é.txt', '日本.txt', '😀.txt', '～.txt', '.txt', 'Z.txt', '_.txt', 'a b.txt', 'dir/é.txt', 'dir/z', 'dir.txt', 'dir-x', 'dir0', 'a/b/c.txt', 'Å.txt', 'Å.txt', '.hidden', '-dash.txt', '\u{1F600}/x.txt', '～/y.txt', 'new.txt', 'sub/new.txt'];
function mkEdit(fmt, kind, name, name2, rng) {
  const body = ['hello', 'world'];
  switch (fmt) {
    case 'unified':
      if (kind === 'create') return [`--- /dev/null`, `+++ b/${name}`, `@@ -0,0 +1,2 @@`, ...body.map((l) => '+' + l)];
      if (kind === 'delete') return [`--- a/${name}`, `+++ /dev/null`, `@@ -1,1 +0,0 @@`, '-x'];
      if (kind === 'delete-nohunk') return [`diff --git a/${name} b/${name}`, 'deleted file mode 100644'];
      if (kind === 'move') return [`diff --git a/${name} b/${name2}`, 'similarity index 100%', `rename from ${name}`, `rename to ${name2}`];
      if (kind === 'move-hunk') return [`--- a/${name}`, `+++ b/${name2}`, `@@ -1,1 +1,1 @@`, '-x', '+y'];
      if (kind === 'update') return [`--- a/${name}`, `+++ b/${name}`, `@@ -1,1 +1,1 @@`, '-nothere', '+y'];
      return null;
    case 'sr':
      if (kind === 'create') return [name, '<<<<<<< SEARCH', '=======', ...body, '>>>>>>> REPLACE'];
      if (kind === 'update') return [name, '<<<<<<< SEARCH', 'nothere', '=======', 'y', '>>>>>>> REPLACE'];
      return null;
    case 'v4a':
      if (kind === 'create') return [`*** Add File: ${name}`, ...body.map((l) => '+' + l)];
      if (kind === 'delete' || kind === 'delete-nohunk') return [`*** Delete File: ${name}`];
      if (kind === 'move' || kind === 'move-hunk') return [`*** Update File: ${name}`, `*** Move to: ${name2}`];
      if (kind === 'update') return [`*** Update File: ${name}`, '@@', '-nothere', '+y'];
      return null;
    case 'json':
      if (kind === 'create') return [JSON.stringify({ command: 'create', path: name, file_text: 'hello\nworld\n' })];
      if (kind === 'update') return [JSON.stringify({ command: 'str_replace', path: name, old_str: 'nothere', new_str: 'y' })];
      if (kind === 'insert') return [JSON.stringify({ command: 'insert', path: name, insert_line: 0, new_str: 'z\n' })];
      return null;
  }
  return null;
}
def('patch-extra-edit', (c, rng) => {
  const p = getPatch(c); if (p == null) return false;
  const fmt = fmtOf(p); if (!fmt) return false;
  const ts = targets(c);
  const kind = rng.pick(['create', 'create', 'create-existing', 'delete', 'delete-missing', 'delete-nohunk', 'move', 'move-hunk', 'update-missing', 'update', 'create-under-file', 'create-over-dir', 'insert', 'move-onto-existing', 'move-missing']);
  const exist = ts.length ? rng.pick(ts) : 'nofile.txt';
  let lines = null;
  if (kind === 'create') lines = mkEdit(fmt, 'create', rng.pick(NAMES), '', rng);
  else if (kind === 'create-existing') lines = mkEdit(fmt, 'create', exist, '', rng);
  else if (kind === 'delete') lines = mkEdit(fmt, 'delete', exist, '', rng);
  else if (kind === 'delete-missing') lines = mkEdit(fmt, 'delete', 'missing.txt', '', rng);
  else if (kind === 'delete-nohunk') lines = mkEdit(fmt, 'delete-nohunk', exist, '', rng);
  else if (kind === 'move') lines = mkEdit(fmt, 'move', exist, rng.pick(NAMES), rng);
  else if (kind === 'move-hunk') lines = mkEdit(fmt, 'move-hunk', exist, rng.pick(NAMES), rng);
  else if (kind === 'move-onto-existing') lines = mkEdit(fmt, 'move', exist, ts.length > 1 ? rng.pick(ts) : exist, rng);
  else if (kind === 'move-missing') lines = mkEdit(fmt, 'move', 'missing.txt', 'target2.txt', rng);
  else if (kind === 'update-missing') lines = mkEdit(fmt, 'update', 'missing.txt', '', rng);
  else if (kind === 'update') lines = mkEdit(fmt, 'update', exist, '', rng);
  else if (kind === 'create-under-file') lines = mkEdit(fmt, 'create', exist + '/child.txt', '', rng);
  else if (kind === 'create-over-dir') {
    const withDir = ts.find((t) => t.includes('/'));
    lines = mkEdit(fmt, 'create', withDir ? withDir.split('/')[0] : 'dirx', '', rng);
  } else if (kind === 'insert') lines = mkEdit(fmt, 'insert', exist, '', rng);
  if (!lines) return false;
  const nl = p.endsWith('\n') ? p : p + '\n';
  if (fmt === 'unified' || fmt === 'sr') {
    if (rng.chance(0.3)) setPatch(c, lines.join('\n') + '\n' + nl); else setPatch(c, nl + lines.join('\n') + '\n');
    return true;
  }
  if (fmt === 'v4a') {
    const ls = p.split('\n'); let e = -1;
    for (let i = ls.length - 1; i >= 0; i--) if (ls[i].trim() === '*** End Patch') { e = i; break; }
    if (e < 0) return false;
    ls.splice(rng.chance(0.3) ? ls.findIndex((l) => l.trim() === '*** Begin Patch') + 1 : e, 0, ...lines);
    setPatch(c, ls.join('\n'));
    return true;
  }
  const j = jparse(p); if (!j) return false;
  j.edits.splice(rng.chance(0.3) ? 0 : j.edits.length, 0, JSON.parse(lines[0]));
  setPatch(c, jser(j, rng));
  return true;
});

// ---- JSON specifics
function jparse(p) {
  try {
    const v = JSON.parse(p);
    if (Array.isArray(v)) return { mode: 'array', edits: v };
    if (v && typeof v === 'object') return { mode: 'lines', edits: [v] };
  } catch { /* fallthrough */ }
  try {
    const edits = p.split('\n').map((x) => x.trim()).filter(Boolean).map((l) => JSON.parse(l));
    return { mode: 'lines', edits };
  } catch { return null; }
}
function jser(j, rng, force) {
  const mode = force ?? j.mode;
  if (mode === 'lines') return j.edits.map((e) => JSON.stringify(e)).join(rng?.chance(0.2) ? '\n\n' : '\n') + '\n';
  if (mode === 'pretty') return JSON.stringify(j.edits, null, 2) + '\n';
  return JSON.stringify(j.edits) + (rng?.chance(0.5) ? '\n' : '');
}
def('json-convert-form', (c, rng) => {
  const p = getPatch(c); if (fmtOf(p) !== 'json') return false;
  const j = jparse(p); if (!j) return false;
  setPatch(c, jser(j, rng, rng.pick(['lines', 'array', 'pretty', 'lines', 'array'])));
  return true;
});
def('json-mutate', (c, rng) => {
  const p = getPatch(c); if (fmtOf(p) !== 'json') return false;
  const j = jparse(p); if (!j || !j.edits.length) return false;
  const e = j.edits[rng.int(j.edits.length)];
  if (!e || typeof e !== 'object') return false;
  const keys = Object.keys(e);
  const v = rng.pick(['del-key', 'path-num', 'path-null', 'old-null', 'old-empty', 'old-num', 'new-null', 'new-absent', 'insert-str', 'insert-float', 'insert-neg', 'insert-big', 'insert-shift', 'cmd-bad', 'cmd-missing', 'extra-keys', 'file_text-num', 'path-empty', 'insert-bool', 'insert-exp', 'cmd-case', 'insert-last+1', 'path-ws']);
  const k = keys.length ? rng.pick(keys) : 'path';
  switch (v) {
    case 'del-key': delete e[k]; break;
    case 'path-num': e.path = 5; break;
    case 'path-null': e.path = null; break;
    case 'path-empty': e.path = ''; break;
    case 'path-ws': e.path = ' ' + e.path + ' '; break;
    case 'old-null': e.old_str = null; break;
    case 'old-empty': e.old_str = ''; break;
    case 'old-num': e.old_str = 1; break;
    case 'new-null': e.new_str = null; break;
    case 'new-absent': delete e.new_str; break;
    case 'insert-str': e.insert_line = String(e.insert_line ?? 1); break;
    case 'insert-float': e.insert_line = 1.5; break;
    case 'insert-neg': e.insert_line = -1; break;
    case 'insert-big': e.insert_line = 1e9; break;
    case 'insert-bool': e.insert_line = true; break;
    case 'insert-exp': e.insert_line = 1e0; break;
    case 'insert-shift': e.insert_line = (typeof e.insert_line === 'number' ? e.insert_line : 0) + rng.pick([-1, 1, 2, 5]); break;
    case 'insert-last+1': e.insert_line = 1000; break;
    case 'cmd-bad': e.command = rng.pick(['view', 'undo_edit', '', 5, null]); break;
    case 'cmd-missing': delete e.command; break;
    case 'cmd-case': e.command = String(e.command).toUpperCase(); break;
    case 'extra-keys': e.extra = [1, { a: 2 }]; e.old_str ??= 'zzz'; break;
    case 'file_text-num': e.file_text = 7; break;
  }
  setPatch(c, jser(j, rng));
  return true;
});
onPatchText('json-text-faults', (p, f, rng) => {
  if (f !== 'json') return null;
  const v = rng.pick(['trail-comma', 'garbage', 'bom', 'single-quote', 'comment', 'trunc', 'unicode-escape', 'surrogate', 'empty-array', 'empty-obj', 'array-nonobj', 'nested-array', 'lead-ws', 'crlf-lines', 'two-arrays', 'null']);
  switch (v) {
    case 'trail-comma': return p.replace(/\]\s*$/, ',]') === p ? p.trimEnd() + ',\n' : p.replace(/\]\s*$/, ',]');
    case 'garbage': return p + 'x\n';
    case 'bom': return '﻿' + p;
    case 'single-quote': return p.replace(/"/, "'");
    case 'comment': return p + '// hi\n';
    case 'trunc': return p.trimEnd().slice(0, -1) + '\n';
    case 'unicode-escape': return p.replace(/"path": ?"(.)/, (m, ch) => m.slice(0, -1) + '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
    case 'surrogate': return p.replace(/"new_str": ?"/, '$&\\ud83d\\ude00').replace(/"file_text": ?"/, '$&\\ud83d\\ude00');
    case 'empty-array': return '[]\n';
    case 'empty-obj': return '{}\n';
    case 'array-nonobj': return '[1, 2]\n';
    case 'nested-array': return '[[' + p.trim().replace(/^\[|\]$/g, '') + ']]\n';
    case 'lead-ws': return '\n  \n' + p;
    case 'crlf-lines': return p.replace(/\n/g, '\r\n');
    case 'two-arrays': return p.trim() + '\n' + p.trim() + '\n';
    case 'null': return 'null\n';
  }
  return null;
});
onPatchText('json-crlf-strings', (p, f, rng) => {
  if (f !== 'json') return null;
  const j = jparse(p); if (!j) return null;
  let any = false;
  for (const e of j.edits) for (const k of ['old_str', 'new_str', 'file_text']) if (typeof e?.[k] === 'string' && e[k].includes('\n')) { e[k] = e[k].replace(/\r?\n/g, rng.chance(0.8) ? '\r\n' : '\n'); any = true; }
  return any ? jser(j, rng) : null;
});
onPatchText('json-strings-edit', (p, f, rng) => {
  if (f !== 'json') return null;
  const j = jparse(p); if (!j) return null;
  const e = j.edits[rng.int(j.edits.length)]; if (!e) return null;
  const v = rng.pick(['old-trim-nl', 'old-add-nl', 'new-no-final-nl', 'old-partial', 'old-double', 'old-ws']);
  if (typeof e.old_str === 'string') {
    if (v === 'old-trim-nl') e.old_str = e.old_str.replace(/\n+$/, '');
    else if (v === 'old-add-nl') e.old_str += '\n';
    else if (v === 'old-partial') e.old_str = e.old_str.slice(1, Math.max(2, e.old_str.length - 1));
    else if (v === 'old-double') e.old_str = e.old_str + e.old_str;
    else if (v === 'old-ws') e.old_str = e.old_str.replace(/^(\s*)/, '$1 ').replace(/\n/, ' \n');
  }
  if (typeof e.new_str === 'string' && v === 'new-no-final-nl') e.new_str = e.new_str.replace(/\n$/, '');
  else if (typeof e.new_str === 'string') e.new_str += rng.pick(['', '\n', '\r\n']);
  if (typeof e.file_text === 'string') e.file_text = rng.pick([e.file_text.replace(/\n$/, ''), e.file_text + '\n', e.file_text.replace(/\n/g, '\r\n'), '']);
  return jser(j, rng);
});

// ---- target files
onFiles('file-crlf', (t) => (t.includes('\n') ? t.replace(/\r?\n/g, '\r\n') : null));
onFiles('file-mixed-eol', (t, rng) => {
  const f = fsplit(t.replace(/\r\n/g, '\n')); if (f.ls.length < 2) return null;
  const crlfFirst = rng.chance(0.5);
  return f.ls.map((l, i) => l + (i === f.ls.length - 1 && !f.fin ? '' : (crlfFirst ? (i === 0 || rng.chance(0.3) ? '\r\n' : '\n') : (i === 0 ? '\n' : rng.chance(0.5) ? '\r\n' : '\n')))).join('');
});
onFiles('file-no-final-nl', (t) => (t.endsWith('\n') ? t.replace(/\r?\n$/, '') : null));
onFiles('file-add-final-nl', (t) => (t === '' || t.endsWith('\n') ? null : t + '\n'));
onFiles('file-extra-blank-end', (t, rng) => (t === '' ? null : t + rng.pick(['\n', '\n\n', '\r\n', '\n \n', '  ', '\n\n\n'])));
onFiles('file-trailing-ws', (t, rng) => {
  const f = fsplit(t); const q = rng.pick([0.1, 0.3, 1]); const w = rng.pick(WS);
  f.ls = f.ls.map((l) => (rng.chance(q) ? l + w : l));
  return fjoin(f);
});
onFiles('file-trailing-ws-all', (t, rng) => { const f = fsplit(t); const w = rng.pick(WS); f.ls = f.ls.map((l) => l + w); return fjoin(f); });
onFiles('file-strip-trailing-ws', (t) => t.replace(/[ \t]+(\r?\n|$)/g, '$1'));
onFiles('file-indent', (t, rng) => {
  const f = fsplit(t); const mode = rng.pick(INDENT_MODES); const q = rng.pick([0.3, 0.5, 1, 1]);
  f.ls = f.ls.map((l) => (rng.chance(q) ? indentLine(rng, mode, l) : l));
  return fjoin(f);
});
onFiles('file-empty', (t, rng) => rng.pick(['', '\n', '\r\n', '   ', ' \n', '\n\n']));
onFiles('file-blank-lines-insert', (t, rng) => {
  const f = fsplit(t); if (!f.ls.length) return null;
  for (let k = rng.range(1, 3); k > 0; k--) f.ls.splice(rng.int(f.ls.length + 1), 0, rng.pick(['', '', ' ', '\t']));
  return fjoin(f);
});
onFiles('file-delete-lines', (t, rng) => {
  const f = fsplit(t); if (f.ls.length < 2) return null;
  for (let k = rng.range(1, 3); k > 0 && f.ls.length > 1; k--) f.ls.splice(rng.int(f.ls.length), 1);
  return fjoin(f);
});
onFiles('file-mutate-char', (t, rng) => {
  const f = fsplit(t); if (!f.ls.length) return null;
  const i = rng.int(f.ls.length); const l = f.ls[i]; if (!l.length) return null;
  const j = rng.int(l.length);
  f.ls[i] = l.slice(0, j) + rng.pick(['X', '', ' ', '\t', 'é']) + l.slice(j + 1);
  return fjoin(f);
});
onFiles('file-dup-all', (t, rng) => (t === '' ? null : t + (t.endsWith('\n') ? '' : '\n') + t));
onFiles('file-unicode', (t, rng) => {
  const v = rng.pick(['bom', 'nbsp', 'zwsp', 'emoji', 'combining', 'nel', 'ls-char', 'ff', 'vt']);
  const f = fsplit(t); if (!f.ls.length) return null;
  const i = rng.int(f.ls.length);
  const ch = { bom: '﻿', nbsp: ' ', zwsp: '​', emoji: '\u{1F600}', combining: 'é', nel: '\u0085', 'ls-char': ' ', ff: '\f', vt: '\v' }[v];
  if (v === 'bom' && i === 0) return '﻿' + t;
  f.ls[i] = (rng.chance(0.5) ? ch : '') + f.ls[i] + (rng.chance(0.5) ? ch : ch);
  return fjoin(f);
});
onFiles('file-lone-cr', (t, rng) => {
  const f = fsplit(t); if (!f.ls.length) return null;
  const i = rng.int(f.ls.length);
  f.ls[i] = rng.pick([f.ls[i] + '\r', '\r' + f.ls[i], f.ls[i].slice(0, 2) + '\r' + f.ls[i].slice(2)]);
  return fjoin(f);
});
onFiles('file-tabs-everywhere', (t) => t.replace(/^( {2,4})/gm, '\t'));
def('file-dup-block', (c, rng) => {
  const p = getPatch(c); if (p == null) return false;
  const fmt = fmtOf(p); if (!fmt || fmt === 'json') return false;
  const ls = p.split('\n');
  const Os = extractOs(ls, fmt);
  const ts = targets(c); if (!ts.length) return false;
  let O = Os.length ? rng.pick(Os) : null;
  if (!O) return false;
  if (rng.chance(0.3)) O = O.map((l) => indentLine(rng, rng.pick(INDENT_MODES), l));
  if (rng.chance(0.2)) O = O.map((l) => l + rng.pick(WS));
  let tgt = ts.find((t) => { const f = fsplit(c.files[t]); const lines = f.ls.map((l) => l.replace(/\r$/, '')); return lines.some((_, i) => O.every((o, k) => lines[i + k] === o)); });
  tgt ??= rng.pick(ts);
  const f = fsplit(c.files[tgt]);
  const lines = f.ls.map((l) => l.replace(/\r$/, ''));
  let at = lines.findIndex((_, i) => O.every((o, k) => lines[i + k] === o));
  const where = rng.pick(['after', 'before', 'start', 'end', 'far-after', 'twice', 'inside-gap']);
  let pos;
  if (at < 0) at = 0;
  if (where === 'after') pos = at + O.length;
  else if (where === 'before') pos = at;
  else if (where === 'start') pos = 0;
  else if (where === 'end') pos = f.ls.length;
  else if (where === 'far-after') pos = Math.min(f.ls.length, at + O.length + rng.range(3, 30));
  else if (where === 'inside-gap') pos = Math.min(f.ls.length, at + O.length + 1);
  else { f.ls.splice(at + O.length, 0, ...O); pos = at + O.length; }
  f.ls.splice(pos, 0, ...O);
  if (!f.ls.length) return false;
  c.files[tgt] = fjoin(f);
  return true;
});
def('file-pad-lines', (c, rng) => {
  // pad the head of a file with N filler lines so that unified line numbers go stale
  const ts = targets(c); if (!ts.length) return false;
  const t = rng.pick(ts); const f = fsplit(c.files[t]); if (!f.ls.length) return false;
  const n = rng.pick([1, 2, 5, 20, 100]);
  const filler = Array.from({ length: n }, (_, i) => (rng.chance(0.3) ? '' : `filler ${i}`));
  if (rng.chance(0.5)) f.ls.unshift(...filler); else f.ls.push(...filler);
  c.files[t] = fjoin(f);
  return true;
});

// ---- paths
const SUBDIRS = (old) => ['sub/' + old, 'a/b/c/' + old, 'deep/er/est/dir/' + old];
const UNI = ['é/日本語.txt', '😀.md', '日本語/ファイル.js', 'ａｂｃ.txt', 'Å.txt', 'Å.txt', '～.txt', '\u{1F600}/x.txt', 'ü/ü.py', '/f.js'];
const ODD = ['a b.txt', 'x y/z w.txt', '-lead.txt', '+plus.txt', '@@.txt', '.hidden', '..foo', 'a..b', 'file.', '...', 'a\tb.txt', '#hash.txt', 'a,b.txt', '"q".txt', "it's.txt", '=.txt', ' lead.txt', 'trail.txt '];
def('path-rename', (c, rng) => {
  const p = getPatch(c); if (p == null) return false;
  const fmt = fmtOf(p);
  const ts = targets(c); if (!ts.length) return false;
  const old = rng.pick(ts);
  const kind = rng.pick(['sub', 'uni', 'odd', 'sub', 'uni']);
  let nw = kind === 'sub' ? rng.pick(SUBDIRS(old)) : kind === 'uni' ? rng.pick(UNI) : rng.pick(ODD);
  if (kind !== 'sub' && rng.chance(0.4)) nw = rng.pick(['d/', 'sub/']) + nw;
  if (nw === old || c.files[nw] !== undefined) return false;
  c.files[nw] = c.files[old]; delete c.files[old];
  setPatch(c, replacePathIn(p, fmt, old, nw));
  return true;
});
def('path-rename-all', (c, rng) => {
  const p = getPatch(c); if (p == null) return false;
  const fmt = fmtOf(p); const ts = targets(c); if (!ts.length) return false;
  const pre = rng.pick(['sub/', 'é/', 'x y/', '日本/']);
  let patch = p;
  for (const t of ts) { c.files[pre + t] = c.files[t]; delete c.files[t]; patch = replacePathIn(patch, fmt, t, pre + t); }
  if (!validFiles(c.files)) return false;
  setPatch(c, patch);
  return true;
});
def('path-unsafe', (c, rng) => {
  const p = getPatch(c); if (p == null) return false;
  const fmt = fmtOf(p);
  const ts = targets(c); if (!ts.length) return false;
  const old = rng.pick(ts);
  const variants = ['../' + old, '/' + old, '/mend-diff-nonexistent/' + old, old.includes('/') ? old.replace(/\//g, '\\') : 'a\\b', old.split('/').join('//'), 'a//' + old, './' + old, old + '/', old + '/.', 'x/../' + old, '.', '..', ' ' + old + ' ', '/', 'a/./' + old, old.replace(/^([^/]+)/, '$1/..'), '../../' + old, 'sub/../' + old, old + '\\', '\\' + old, '//' + old, 'a/b/../../' + old];
  const nw = rng.pick(variants);
  if (nw === old) return false;
  setPatch(c, replacePathIn(p, fmt, old, nw));
  return true;
});

// ---- argv
const FLAGS = ['--check', '--strict', '--format=unified', '--format=search-replace', '--format=v4a', '--format=json', '--format=auto', '--format=', '--format=UNIFIED', '--format', '--format=git', '-', '--', '-x', '--check=1', '--Check', '--strict=yes', '-c', '--help', '--format=auto', '--check', '--strict', '--format=v4a', '--format=unified', '--format=json', '--format=search-replace'];
def('argv-add-flag', (c, rng) => {
  const f = rng.pick(FLAGS);
  c.argv.splice(rng.int(c.argv.length + 1), 0, f);
  if (f === '--format' && rng.chance(0.7)) c.argv.splice(c.argv.indexOf('--format') + 1, 0, rng.pick(['unified', 'json']));
  return true;
});
def('argv-add-flags2', (c, rng) => {
  const fl = rng.shuffle(['--check', '--strict', '--format=' + rng.pick(['unified', 'search-replace', 'v4a', 'json', 'auto'])]).slice(0, rng.range(2, 3));
  for (const f of fl) c.argv.splice(rng.int(c.argv.length + 1), 0, f);
  return true;
});
def('argv-format-correct', (c, rng) => {
  const f = fmtOf(getPatch(c)); if (!f) return false;
  c.argv.splice(rng.int(c.argv.length + 1), 0, '--format=' + { unified: 'unified', sr: 'search-replace', v4a: 'v4a', json: 'json' }[f]);
  return true;
});
def('argv-format-wrong', (c, rng) => {
  const f = fmtOf(getPatch(c)) ?? 'unified';
  const all = ['unified', 'search-replace', 'v4a', 'json'];
  const cur = { unified: 'unified', sr: 'search-replace', v4a: 'v4a', json: 'json' }[f];
  c.argv.splice(rng.int(c.argv.length + 1), 0, '--format=' + rng.pick(all.filter((x) => x !== cur)));
  return true;
});
def('argv-shuffle', (c, rng) => { if (c.argv.length < 2) { c.argv.push('--check'); } c.argv = rng.shuffle(c.argv); return true; });
def('argv-double-dash', (c, rng) => {
  const i = c.argv.findIndex((a) => !a.startsWith('-') || a === '-');
  if (i < 0) { c.argv.push('--'); return true; }
  c.argv.splice(rng.chance(0.7) ? i : i + 1, 0, '--');
  if (rng.chance(0.3)) c.argv.splice(0, 0, '--check');
  return true;
});
def('argv-dup-arg', (c, rng) => {
  if (!c.argv.length) return false;
  const i = rng.int(c.argv.length); c.argv.splice(i, 0, c.argv[i]); return true;
});
def('argv-patch-to-stdin', (c, rng) => {
  const r = patchRef(c); if (!r || r.kind !== 'file') return false;
  c.stdin = c.files[r.name]; delete c.files[r.name];
  c.argv = c.argv.filter((a) => a !== r.name);
  if (rng.chance(0.5)) c.argv.splice(rng.int(c.argv.length + 1), 0, '-');
  return true;
});
def('argv-stdin-to-file', (c, rng) => {
  const r = patchRef(c); if (!r || r.kind !== 'stdin' || c.stdin == null) return false;
  const name = rng.pick(['p.patch', 'sub/q.diff', 'x']);
  if (c.files[name] !== undefined) return false;
  c.files[name] = c.stdin; if (rng.chance(0.7)) c.stdin = null;
  c.argv = c.argv.filter((a) => a !== '-'); c.argv.splice(rng.int(c.argv.length + 1), 0, name);
  return true;
});
def('argv-both-stdin-and-file', (c, rng) => {
  const r = patchRef(c); if (!r || r.kind !== 'file') return false;
  c.stdin = rng.pick(['garbage\n', '', '*** Begin Patch\n*** End Patch\n']);
  return true;
});
def('argv-patch-dashname', (c, rng) => {
  const r = patchRef(c); if (!r || r.kind !== 'file') return false;
  const nn = rng.pick(['-p.patch', '--check', '-', '--x']);
  if (c.files[nn] !== undefined) return false;
  c.files[nn] = c.files[r.name]; delete c.files[r.name];
  c.argv = c.argv.map((a) => (a === r.name ? nn : a));
  if (rng.chance(0.7)) c.argv.splice(c.argv.indexOf(nn), 0, '--');
  return true;
});
def('argv-patch-missing', (c, rng) => {
  const r = patchRef(c); if (!r || r.kind !== 'file') return false;
  const nn = rng.pick(['nope.patch', 'sub/nope', r.name + '.x']);
  c.argv = c.argv.map((a) => (a === r.name ? nn : a)); return true;
});
def('argv-patch-dir', (c, rng) => {
  const r = patchRef(c); if (!r || r.kind !== 'file') return false;
  c.files['pdir/keep.txt'] = 'x\n';
  c.argv = c.argv.map((a) => (a === r.name ? 'pdir' : a)); return true;
});
def('argv-patch-path-forms', (c, rng) => {
  const r = patchRef(c); if (!r || r.kind !== 'file') return false;
  const forms = ['./' + r.name, 'sub/../' + r.name, '//' + r.name];
  const nn = rng.pick(forms);
  c.argv = c.argv.map((a) => (a === r.name ? nn : a));
  if (nn.startsWith('sub/')) c.files['sub/.keep'] = '';
  return true;
});
def('argv-extra-positional', (c, rng) => { c.argv.splice(rng.int(c.argv.length + 1), 0, rng.pick(['extra', '-', 'x.txt'])); return true; });
def('argv-empty-arg', (c, rng) => { c.argv.splice(rng.int(c.argv.length + 1), 0, ''); return true; });
def('argv-patch-subdir', (c, rng) => {
  const r = patchRef(c); if (!r || r.kind !== 'file') return false;
  const nn = 'sub/dir/' + r.name; c.files[nn] = c.files[r.name]; delete c.files[r.name];
  c.argv = c.argv.map((a) => (a === r.name ? nn : a)); return true;
});

// ---- file/patch interplay: patch lives among targets
def('patch-file-is-target', (c, rng) => {
  const r = patchRef(c); if (!r || r.kind !== 'file') return false;
  // make the patch edit itself (replace patch file's own text) by appending an edit on the patch path
  const p = c.files[r.name]; const fmt = fmtOf(p);
  const lines = mkEdit(fmt, rng.pick(['create', 'update', 'delete']), r.name, 'moved-patch.txt', rng);
  if (!lines) return false;
  if (fmt === 'v4a') { const ls = p.split('\n'); const e = ls.map((l) => l.trim()).lastIndexOf('*** End Patch'); if (e < 0) return false; ls.splice(e, 0, ...lines); c.files[r.name] = ls.join('\n'); }
  else if (fmt === 'json') { const j = jparse(p); if (!j) return false; j.edits.push(JSON.parse(lines[0])); c.files[r.name] = jser(j, rng); }
  else c.files[r.name] = p + (p.endsWith('\n') ? '' : '\n') + lines.join('\n') + '\n';
  return true;
});

const T_BY_NAME = new Map(T.map((t) => [t.name, t]));

function applyT(t, c0, rng) {
  const c = clone(c0);
  let ok;
  try { ok = t.fn(c, rng); } catch (e) { if (process.env.DIFF_DEBUG) console.error(t.name, e); return null; }
  if (!ok) return null;
  if (JSON.stringify(plain(c)) === JSON.stringify(plain(c0))) return null;
  if (!validFiles(c.files)) return null;
  c.transforms.push(t.name);
  return c;
}

// ---------------------------------------------------------------------------------------------- corpora
function loadCorpora() {
  const out = []; const seen = new Set();
  const add = (src, c, i) => {
    if (!c || !Array.isArray(c.argv) || typeof c.files !== 'object') return;
    const cc = { argv: c.argv.map(String), stdin: c.stdin ?? null, files: { ...c.files }, base: `${src}#${i}${c.family ? ':' + c.family : ''}`, transforms: [] };
    const k = caseKey(cc);
    if (seen.has(k)) return;
    seen.add(k); out.push(cc);
  };
  const files = [{ name: 'practice', path: PRACTICE }];
  if (existsSync(HERE)) for (const f of readdirSync(HERE).sort()) if (/^spec-.*\.json$/.test(f)) files.push({ name: f.replace(/\.json$/, ''), path: join(HERE, f) });
  const counts = {};
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(f.path, 'utf8'));
      const before = out.length;
      (j.checks ?? []).forEach((c, i) => add(f.name, c, i));
      counts[f.name] = out.length - before;
    } catch (e) { counts[f.name] = 'ERR ' + e.message; }
  }
  return { cases: out, counts };
}

function generate(corpus, limit, seed) {
  const rng = makeRng(seed);
  const names = T.filter((t) => !ONLY || ONLY.includes(t.name));
  const gen = []; const seen = new Set(corpus.map(caseKey));
  let attempts = 0; let rr = 0;
  while (gen.length < limit && attempts < limit * 40) {
    attempts++;
    const t1 = names[rr++ % names.length];
    let c = null;
    for (let k = 0; k < 40 && !c; k++) c = applyT(t1, corpus[rng.int(corpus.length)], rng);
    if (!c) { if (attempts > limit * 30) break; continue; }
    const extra = rng.chance(0.5) ? 0 : rng.chance(0.8) ? 1 : 2;
    for (let e = 0; e < extra; e++) {
      for (let k = 0; k < 8; k++) {
        const n = applyT(rng.pick(names), c, rng);
        if (n) { c = n; break; }
      }
    }
    const key = caseKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    c.id = gen.length;
    gen.push(c);
  }
  return gen;
}


// ---------------------------------------------------------------------------------------------- synthetic base cases
// Random files and random patches (all four formats) built from the file's own lines, with optional whitespace / offset
// perturbations. These complement the corpus: they exercise cursor, nearest-occurrence, tiers, EOF and ambiguity logic.
const VOC = ['foo();', 'bar(x, y);', 'if (a) {', '}', '', 'return 1;', 'x = 1', 'y = 2', 'end', 'z();', 'a', 'b', 'c', '// note', 'let q = 0;', 'function f() {', '};', 'a b', 'a  b', '  ', '*** End Patch', '=======', '@@ -1 +1 @@'];
const strCR = (l) => l.replace(/\r$/, '');
function synthLine(rng) {
  let l = rng.pick(VOC);
  if (l.trim() && rng.chance(0.5)) l = rng.pick(['  ', '\t', '    ', ' ', '\t\t', '  \t']) + l;
  if (rng.chance(0.06)) l += rng.pick([' ', '\t']);
  return l;
}
function synthFile(rng) {
  const n = rng.pick([0, 1, 2, 3, 4, 6, 8, 12, 20, 30]);
  const ls = Array.from({ length: n }, () => synthLine(rng));
  return fjoin({ ls, eol: rng.chance(0.25) ? '\r\n' : '\n', fin: rng.chance(0.8) });
}
function perturb(rng, l, p) {
  if (!rng.chance(p)) return l;
  return rng.pick([l + ' ', l + '\t', indentLine(rng, rng.pick(INDENT_MODES), l), l.trimStart(), '  ' + l.trimStart(), l.trimEnd()]);
}
const NAMES_S = ['a.txt', 'src/b.js', 'c.py', 'dir/sub/d.md', 'é.txt', 'e'];
function synthRegion(rng, L, pos, opts = {}) {
  const s = rng.range(pos, L.length);
  const cb = Math.min(rng.range(0, 3), s - pos);
  const rm = Math.min(rng.range(0, 3), L.length - s);
  const ca = Math.min(rng.range(0, 3), L.length - s - rm);
  let ins = rng.range(0, 3); if (rm === 0 && ins === 0) ins = 1;
  const nl = Array.from({ length: ins }, () => synthLine(rng));
  return { s, cb, rm, ca, nl, ctxB: L.slice(s - cb, s), old: L.slice(s, s + rm), ctxA: L.slice(s + rm, s + rm + ca) };
}
function synthUnified(rng, files, name, nameNew) {
  const f = fsplit(files[name]); const L = f.ls.map(strCR);
  const pp = rng.pick([0, 0, 0.2, 0.6]);
  const out = [];
  if (rng.chance(0.4)) out.push(`diff --git a/${name} b/${nameNew ?? name}`);
  out.push(rng.chance(0.8) ? `--- a/${name}` : `--- ${name}`, rng.chance(0.8) ? `+++ b/${nameNew ?? name}` : `+++ ${nameNew ?? name}`);
  let pos = 0; let d = 0;
  const nh = rng.range(1, 3);
  for (let h = 0; h < nh && pos <= L.length; h++) {
    const r = synthRegion(rng, L, pos);
    const oLen = r.cb + r.rm + r.ca; const nLen = r.cb + r.nl.length + r.ca;
    const body = [];
    const addCtx = (l) => body.push((l === '' ? rng.pick([' ', ' ', '']) : ' ' + perturb(rng, l, pp)));
    r.ctxB.forEach(addCtx); r.old.forEach((l) => body.push('-' + perturb(rng, l, pp))); r.nl.forEach((l) => body.push('+' + l)); r.ctxA.forEach(addCtx);
    let A = oLen === 0 ? r.s : r.s - r.cb + 1;
    if (oLen === 0 && rng.chance(0.5)) A += d;
    if (rng.chance(0.3)) A += rng.range(-5, 5);
    if (rng.chance(0.05)) A += rng.pick([100, -100]);
    out.push(`@@ -${A}${rng.chance(0.7) ? ',' + oLen : ''} +${A + d}${rng.chance(0.7) ? ',' + nLen : ''} @@${rng.chance(0.2) ? ' ctx' : ''}`);
    out.push(...body);
    if (r.s + r.rm + r.ca >= L.length && rng.chance(0.25)) out.push('\\ No newline at end of file');
    else if (rng.chance(0.05) && body.length) out.splice(rng.range(out.length - body.length, out.length), 0, '\\ No newline at end of file');
    d += nLen - oLen;
    pos = rng.chance(0.1) ? r.s : r.s + r.rm + r.ca;
    if (rng.chance(0.1)) out.push(''); // blank separator line
  }
  return out;
}
function synthSR(rng, files, name) {
  const f = fsplit(files[name]); const L = f.ls.map(strCR);
  const pp = rng.pick([0, 0, 0.2, 0.6]);
  const out = [];
  const nb = rng.range(1, 3);
  for (let b = 0; b < nb; b++) {
    const s = rng.range(0, L.length); const len = Math.min(rng.range(0, 4), L.length - s);
    const old = L.slice(s, s + len).map((l) => perturb(rng, l, pp));
    const nl = Array.from({ length: rng.range(0, 3) }, () => synthLine(rng));
    if (b === 0 || rng.chance(0.6)) { if (rng.chance(0.2)) out.push('```'); out.push(name); }
    out.push('<<<<<<< SEARCH', ...old, '=======', ...nl, '>>>>>>> REPLACE');
    if (rng.chance(0.15)) out.push('', 'some prose');
  }
  return out;
}
function synthV4A(rng, files, name, move) {
  const f = fsplit(files[name]); const L = f.ls.map(strCR);
  const pp = rng.pick([0, 0, 0.2, 0.6]);
  const out = [`*** Update File: ${name}`];
  if (move) out.push(`*** Move to: ${move}`);
  let pos = 0;
  const nc = rng.range(1, 3);
  for (let h = 0; h < nc; h++) {
    if (pos > L.length) break;
    let r = synthRegion(rng, L, pos);
    const eof = h === nc - 1 && rng.chance(0.2);
    if (eof) { const k = Math.min(L.length, rng.range(0, 3)); r = { s: L.length - k, cb: 0, rm: Math.min(k, rng.range(0, k)), ca: 0, nl: Array.from({ length: rng.range(0, 2) }, () => synthLine(rng)) }; r.ctxB = []; r.old = L.slice(r.s, r.s + r.rm); r.ctxA = L.slice(r.s + r.rm); r.ca = r.ctxA.length; }
    const start = r.s - r.cb;
    if (rng.chance(0.45) && start > pos) { const a = rng.range(pos, start - 1); out.push('@@ ' + perturb(rng, L[a], pp).trim()); }
    else if (h > 0 || rng.chance(0.5)) out.push(rng.chance(0.85) ? '@@' : '@@ ');
    const addCtx = (l) => out.push(l === '' ? rng.pick([' ', '']) : ' ' + perturb(rng, l, pp));
    r.ctxB.forEach(addCtx); r.old.forEach((l) => out.push('-' + perturb(rng, l, pp))); r.nl.forEach((l) => out.push('+' + l)); r.ctxA.forEach(addCtx);
    if (eof) out.push('*** End of File');
    pos = r.s + r.rm + r.ca;
  }
  return out;
}
function synthCase(rng, fmt) {
  const nf = rng.pick([1, 1, 1, 2, 3]);
  const names = rng.shuffle(NAMES_S).slice(0, nf);
  const files = {};
  for (const n of names) files[n] = synthFile(rng);
  let patch;
  const hasContent = (n) => files[n] !== '';
  if (fmt === 'unified') {
    const lines = [];
    for (const n of names) {
      const k = rng.pick(['edit', 'edit', 'edit', 'edit', 'create', 'delete', 'move']);
      if (k === 'create') lines.push('--- /dev/null', `+++ b/new_${n.replace(/\//g, '_')}`, '@@ -0,0 +1,2 @@', '+one', '+two');
      else if (k === 'delete') lines.push(`--- a/${n}`, '+++ /dev/null', '@@ -1 +0,0 @@', '-x');
      else if (k === 'move') lines.push(...synthUnified(rng, files, n, 'moved_' + n.replace(/\//g, '_')));
      else lines.push(...synthUnified(rng, files, n));
    }
    patch = lines.join('\n') + (rng.chance(0.9) ? '\n' : '');
  } else if (fmt === 'sr') {
    const lines = [];
    for (const n of names) lines.push(...synthSR(rng, files, n));
    patch = lines.join('\n') + (rng.chance(0.9) ? '\n' : '');
  } else if (fmt === 'v4a') {
    const lines = ['*** Begin Patch'];
    for (const n of names) {
      const k = rng.pick(['edit', 'edit', 'edit', 'add', 'delete', 'move']);
      if (k === 'add') lines.push(`*** Add File: new_${n.replace(/\//g, '_')}`, '+one', '', '+two');
      else if (k === 'delete') lines.push(`*** Delete File: ${n}`);
      else lines.push(...synthV4A(rng, files, n, k === 'move' ? 'moved_' + n.replace(/\//g, '_') : null));
      if (rng.chance(0.1)) lines.push('');
    }
    lines.push('*** End Patch');
    patch = lines.join('\n') + (rng.chance(0.9) ? '\n' : '');
  } else {
    const edits = [];
    for (const n of names) {
      const text = files[n].replace(/\r\n/g, '\n'); const L = fsplit(text).ls;
      for (let k = rng.range(1, 2); k > 0; k--) {
        const kind = rng.pick(['str_replace', 'str_replace', 'str_replace', 'insert', 'insert', 'create']);
        if (kind === 'create') edits.push({ command: 'create', path: 'c_' + n.replace(/\//g, '_'), file_text: rng.pick(['hi\n', 'a\r\nb\r\n', '', 'x']) });
        else if (kind === 'insert') edits.push({ command: 'insert', path: n, insert_line: rng.range(0, L.length + (rng.chance(0.1) ? 2 : 0)), new_str: rng.pick(['x\n', 'x', 'a\nb\n', '', '\n', 'a\r\nb\r\n']) });
        else {
          let old;
          if (L.length && rng.chance(0.7)) { const s = rng.int(L.length); const e = Math.min(L.length, s + rng.range(1, 3)); old = L.slice(s, e).join('\n') + (rng.chance(0.5) ? '\n' : ''); }
          else if (text.length) { const s = rng.int(text.length); old = text.slice(s, s + rng.range(1, 6)); }
          else old = rng.pick(['', 'zz']);
          if (rng.chance(0.1)) old = old.replace(/\n/g, '\r\n');
          const e = { command: 'str_replace', path: n, old_str: old };
          if (rng.chance(0.85)) e.new_str = rng.pick(['NEW', 'N1\nN2\n', '', 'x\n', old + old, 'a\r\nb']);
          edits.push(e);
        }
      }
    }
    patch = rng.chance(0.5) ? JSON.stringify(edits) + '\n' : edits.map((e) => JSON.stringify(e)).join('\n') + '\n';
  }
  const c = { argv: [], stdin: null, files, transforms: [], base: 'synth-' + fmt };
  const where = rng.pick(['stdin', 'file', 'file', 'file2']);
  if (where === 'stdin') { c.stdin = patch; if (rng.chance(0.5)) c.argv.push('-'); }
  else { const pn = where === 'file' ? 'p.patch' : 'sub/q.diff'; c.files[pn] = patch; c.argv.push(pn); }
  if (rng.chance(0.15)) c.argv.unshift('--strict');
  if (rng.chance(0.08)) c.argv.push('--check');
  if (rng.chance(0.08)) c.argv.push('--format=' + { unified: 'unified', sr: 'search-replace', v4a: 'v4a', json: 'json' }[fmt]);
  return c;
}
function generateSynth(count, seed) {
  const rng = makeRng(seed * 7919 + 13);
  const out = [];
  for (let i = 0; i < count; i++) out.push(synthCase(rng, ['unified', 'sr', 'v4a', 'json'][i % 4]));
  return out;
}

// ---------------------------------------------------------------------------------------------- main run
function writeJsonl(path, rows) { writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); }

async function mainRun() {
  mkdirSync(OUT, { recursive: true });
  const { cases: corpus, counts } = loadCorpora();
  console.log(`corpora: ${JSON.stringify(counts)} -> ${corpus.length} base cases`);
  const synth = generateSynth(SYNTH, SEED).filter((c) => validFiles(c.files));
  const gen = generate([...corpus, ...synth.slice(0, 400)], LIMIT, SEED);
  corpus.forEach((c, i) => { c.id = 'c' + i; c.kind = 'corpus'; });
  synth.forEach((c, i) => { c.id = 's' + i; c.kind = 'synth'; c.transforms = ['(synth)']; });
  gen.forEach((c) => { c.kind = 'mutated'; });
  const all = [...corpus, ...synth, ...gen];
  console.log(`corpus ${corpus.length}, synthetic ${synth.length}, mutated variants ${gen.length} (seed ${SEED}, ${T.length} transforms); running ${all.length} total on 2 implementations ...`);
  const t0 = Date.now();
  const detEvery = Math.max(1, Math.ceil(all.length / Math.max(1, DET)));
  const dis = []; const nondet = [];
  const stat = { crashMain: 0, crashRef: 0, timeoutMain: 0, timeoutRef: 0, exits: {} };
  const results = await pool(all, CONC, async (c, i) => {
    const { a, b, cmp } = await runBoth(c);
    const ek = `${c.kind}:${a.exit}`; stat.exits[ek] = (stat.exits[ek] ?? 0) + 1;
    if (isCrash(a)) stat.crashMain++;
    if (isCrash(b)) stat.crashRef++;
    if (a.exit === 124) stat.timeoutMain++;
    if (b.exit === 124) stat.timeoutRef++;
    if (i % detEvery === 0) {
      const a2 = await runImpl(IMPL.main, c);
      const d = compareResults(a, a2);
      if (d) nondet.push({ case: plain(c), transforms: c.transforms, base: c.base, first: serialize(a), second: serialize(a2), aspects: d.aspects });
    }
    return { c, a, b, cmp };
  });
  for (const { c, a, b, cmp } of results) {
    if (!cmp) continue;
    dis.push({
      id: c.id, base: c.base, transforms: c.transforms.length ? c.transforms : ['(corpus)'], kind: c.kind, sig: cmp.sig, aspects: cmp.aspects,
      case: plain(c), main: serialize(a), ref: serialize(b),
    });
  }
  writeJsonl(join(OUT, 'disagreements.jsonl'), dis);
  writeJsonl(join(OUT, 'nondeterminism.jsonl'), nondet);
  summarize(all, results, dis, nondet, stat, (Date.now() - t0) / 1000, detEvery);
}

function summarize(all, results, dis, nondet, stat, secs, detEvery) {
  const lines = [];
  const p = (s = '') => { lines.push(s); console.log(s); };
  p(`\n==== summary (${secs.toFixed(0)}s) ====`);
  p(`total cases: ${all.length} (corpus ${all.filter((c) => c.kind === 'corpus').length}, synthetic ${all.filter((c) => c.kind === 'synth').length}, mutated ${all.filter((c) => c.kind === 'mutated').length})`);
  for (const k of ['corpus', 'synth', 'mutated']) p(`  disagreements in ${k}: ${dis.filter((d) => d.kind === k).length}`);
  p(`disagreements: ${dis.length} (${((100 * dis.length) / all.length).toFixed(1)}%)`);
  p(`crashes (non-0/1/2 exit or stack trace on stderr): main ${stat.crashMain}, ref ${stat.crashRef}; timeouts: main ${stat.timeoutMain}, ref ${stat.timeoutRef}`);
  p(`main.ts exit-code histogram (kind:exit): ${JSON.stringify(stat.exits)}`);
  p(`determinism: re-ran main.ts on ${Math.ceil(all.length / detEvery)} cases, ${nondet.length} differed`);
  const cnt = new Map(); const dcnt = new Map();
  for (const { c, cmp } of results) {
    for (const t of c.transforms.length ? c.transforms : ['(corpus)']) {
      cnt.set(t, (cnt.get(t) ?? 0) + 1);
      if (cmp) dcnt.set(t, (dcnt.get(t) ?? 0) + 1);
    }
  }
  p('\n-- by transform (disagreements / cases) --');
  for (const [t, n] of [...cnt.entries()].sort((x, y) => (dcnt.get(y[0]) ?? 0) - (dcnt.get(x[0]) ?? 0))) p(`  ${String(dcnt.get(t) ?? 0).padStart(5)} / ${String(n).padStart(5)}  ${t}`);
  const byFirst = {};
  for (const d of dis) byFirst[d.aspects[0]] = (byFirst[d.aspects[0]] ?? 0) + 1;
  p('\n-- by first differing aspect --');
  for (const [k, v] of Object.entries(byFirst)) p(`  ${String(v).padStart(5)}  ${k}`);
  const bySig = new Map();
  for (const d of dis) bySig.set(d.sig, (bySig.get(d.sig) ?? 0) + 1);
  p('\n-- by signature (aspect | exit main/ref | first differing stdout line kinds | file diff kinds) --');
  for (const [k, v] of [...bySig.entries()].sort((x, y) => y[1] - x[1]).slice(0, 40)) p(`  ${String(v).padStart(5)}  ${k}`);
  if (nondet.length) { p('\n-- nondeterministic main.ts runs (first 5) --'); for (const n of nondet.slice(0, 5)) p(`  ${JSON.stringify(n.case.argv)} ${n.transforms.join('+')} ${n.aspects}`); }
  writeFileSync(join(OUT, 'summary.txt'), lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------------------------- minimization
function splitKeep(t) {
  const parts = t.split('\n'); const out = [];
  parts.forEach((p, i) => { if (i < parts.length - 1) out.push(p + '\n'); else if (p !== '') out.push(p); });
  return out;
}
async function minimizeOne(entry) {
  let c = { argv: entry.case.argv.slice(), stdin: entry.case.stdin, files: { ...entry.case.files } };
  let budget = MIN_BUDGET;
  const want = entry.sig;
  const check = async (cand) => {
    if (budget <= 0 || !validFiles(cand.files)) return null;
    budget--;
    const r = await runBoth(cand);
    if (!r.cmp) return null;
    if (!LOOSE && r.cmp.sig !== want) return null;
    return r;
  };
  const tryAdopt = async (cand) => { const r = await check(cand); if (r) { c = cand; return true; } return false; };
  const ddmin = async (getLines, setLines) => {
    let lines = getLines(c);
    let n = Math.max(1, Math.ceil(lines.length / 2));
    while (n >= 1 && lines.length > 0) {
      let progress = false;
      for (let i = 0; i < lines.length; ) {
        const cand = clone(c); cand.transforms = [];
        const nl = lines.slice(0, i).concat(lines.slice(i + n));
        setLines(cand, nl);
        if (await tryAdopt(cand)) { lines = nl; progress = true; } else i += n;
        if (budget <= 0) return;
      }
      if (n === 1 && !progress) break;
      if (!progress || n > 1) n = Math.max(1, Math.floor(n / 2));
    }
  };
  const textKeys = () => ['<stdin>', ...Object.keys(c.files)];
  for (let round = 0; round < 3 && budget > 0; round++) {
    const snap = JSON.stringify(plain(c));
    // drop files
    for (const f of Object.keys(c.files)) { const cand = clone(c); delete cand.files[f]; await tryAdopt(cand); }
    // drop argv items
    for (let i = c.argv.length - 1; i >= 0; i--) { const cand = clone(c); cand.argv.splice(i, 1); await tryAdopt(cand); }
    if (c.stdin !== null) { const cand = clone(c); cand.stdin = null; await tryAdopt(cand); }
    // ddmin lines of every text
    for (const k of textKeys()) {
      if (k === '<stdin>') { if (c.stdin == null) continue; await ddmin((x) => splitKeep(x.stdin), (x, l) => { x.stdin = l.join(''); }); }
      else if (c.files[k] !== undefined) await ddmin((x) => splitKeep(x.files[k] ?? ''), (x, l) => { x.files[k] = l.join(''); });
    }
    // text simplifications
    const simp = [
      (t) => t.replace(/\r\n/g, '\n'), (t) => t.replace(/[ \t]+(\r?\n|$)/g, '$1'), (t) => t.replace(/\r/g, ''),
      (t) => t.replace(/\n+$/, '\n'), (t) => t.replace(/\n$/, ''), (t) => t.replace(/\t/g, '  '),
    ];
    for (const k of textKeys()) for (const f of simp) {
      if (k === '<stdin>') { if (c.stdin == null) continue; const cand = clone(c); cand.stdin = f(c.stdin); if (cand.stdin !== c.stdin) await tryAdopt(cand); }
      else if (c.files[k] !== undefined) { const cand = clone(c); cand.files[k] = f(c.files[k]); if (cand.files[k] !== c.files[k]) await tryAdopt(cand); }
    }
    // alpha-rename long words
    const reserved = new Set('SEARCH REPLACE Begin End Patch Add Update Delete File Move to of diff git new deleted mode index rename from similarity dissimilarity old command path file_text old_str new_str insert_line create str_replace insert dev null No newline at end'.split(' '));
    const fixed = new Set([...c.argv.join(' ').matchAll(/[A-Za-z_]\w*/g)].map((m) => m[0]).concat(Object.keys(c.files).join('/').match(/[A-Za-z_]\w*/g) ?? []));
    const texts = [c.stdin ?? '', ...Object.values(c.files)].join('\n');
    const words = [...new Set(texts.match(/[A-Za-z_]\w{2,}/g) ?? [])].filter((w) => !reserved.has(w) && !fixed.has(w));
    if (words.length) {
      const map = new Map(words.map((w, i) => [w, 'w' + i]));
      const rn = (t) => t.replace(/[A-Za-z_]\w{2,}/g, (w) => map.get(w) ?? w);
      const cand = clone(c); cand.stdin = c.stdin == null ? null : rn(c.stdin);
      for (const k of Object.keys(cand.files)) cand.files[k] = rn(cand.files[k]);
      await tryAdopt(cand);
    }
    if (JSON.stringify(plain(c)) === snap) break;
  }
  const final = await runBoth(c);
  return { c, final, used: MIN_BUDGET - budget };
}

async function mainMinimize() {
  const inputs = opt('--in', null)?.split(',') ?? [join(OUT, 'disagreements.jsonl')];
  if (!existsSync(inputs[0])) { console.log('no disagreements.jsonl: running generation first'); await mainRun(); }
  const seenK = new Set(); const dis = [];
  for (const path of inputs) for (const l of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const d = JSON.parse(l); const k = caseKey(d.case);
    if (!seenK.has(k)) { seenK.add(k); dis.push(d); }
  }
  console.log(`minimizing from ${dis.length} disagreements (cap ${MIN_MAX}, budget ${MIN_BUDGET} runs each)`);
  // round-robin over signatures, then over transforms within a signature, so that the cap keeps diversity
  const bySig = new Map();
  for (const d of dis) { if (!bySig.has(d.sig)) bySig.set(d.sig, []); bySig.get(d.sig).push(d); }
  const rng = makeRng(SEED + 7);
  for (const [k, v] of bySig) bySig.set(k, rng.shuffle(v).sort((x, y) => JSON.stringify(x.case).length - JSON.stringify(y.case).length).slice(0, 400));
  const picked = []; const queues = [...bySig.values()];
  for (let r = 0; picked.length < MIN_MAX && queues.some((q) => q.length > r); r++) for (const q of queues) if (q.length > r && picked.length < MIN_MAX) picked.push(q[r]);
  const t0 = Date.now();
  const outs = await pool(picked, CONC, async (d) => {
    const { c, final, used } = await minimizeOne(d);
    const cmp = final.cmp;
    return {
      sig: cmp ? cmp.sig : d.sig + ' (LOST)', origSig: d.sig, transforms: d.transforms, base: d.base, runs: used,
      origSize: JSON.stringify(d.case).length, size: JSON.stringify(plain(c)).length,
      case: plain(c), main: serialize(final.a), ref: serialize(final.b), aspects: cmp?.aspects ?? [],
    };
  });
  outs.sort((x, y) => x.size - y.size);
  writeJsonl(join(OUT, 'minimized.jsonl'), outs);
  console.log(`minimized ${outs.length} cases in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${join(OUT, 'minimized.jsonl')}`);
  report(outs);
}

function report(outs) {
  const lines = [];
  const clusters = new Map();
  for (const o of outs) { if (!clusters.has(o.sig)) clusters.set(o.sig, []); clusters.get(o.sig).push(o); }
  lines.push(`${outs.length} minimized cases in ${clusters.size} signature clusters`);
  const show = (s) => JSON.stringify(s);
  let n = 0;
  for (const [sig, arr] of [...clusters.entries()].sort((a, b) => b[1].length - a[1].length)) {
    arr.sort((x, y) => x.size - y.size);
    const o = arr[0];
    n++;
    lines.push(`\n### [${n}] ${sig}   (cluster size ${arr.length}; transforms: ${[...new Set(arr.flatMap((x) => x.transforms))].slice(0, 6).join(', ')})`);
    lines.push(`argv: ${show(o.case.argv)}${o.case.stdin !== null ? `  stdin: ${show(o.case.stdin)}` : ''}`);
    for (const [k, v] of Object.entries(o.case.files)) lines.push(`  file ${show(k)}: ${show(v)}`);
    const fm = (r) => `exit ${r.exit}, stdout ${show(r.stdout)}`;
    lines.push(`  main: ${fm(o.main)}`);
    lines.push(`  ref : ${fm(o.ref)}`);
    const ks = new Set([...Object.keys(o.main.files), ...Object.keys(o.ref.files)]);
    for (const k of [...ks].sort()) if (o.main.files[k] !== o.ref.files[k]) lines.push(`  files differ ${show(k)}: main=${o.main.files[k] === undefined ? '<absent>' : show(o.main.files[k])} ref=${o.ref.files[k] === undefined ? '<absent>' : show(o.ref.files[k])}`);
    if (o.main.stderr) lines.push(`  main stderr: ${show(o.main.stderr.slice(0, 160))}`);
    if (o.ref.stderr) lines.push(`  ref stderr: ${show(o.ref.stderr.slice(0, 160))}`);
  }
  writeFileSync(join(OUT, 'minimized-report.txt'), lines.join('\n') + '\n');
  console.log(lines.slice(0, 1).join('\n') + `\n(full report: ${join(OUT, 'minimized-report.txt')})`);
}

// ---------------------------------------------------------------------------------------------- entry
if (flag('--list')) { console.log(T.map((t) => t.name).join('\n')); }
else if (flag('--minimize')) await mainMinimize();
else await mainRun();
