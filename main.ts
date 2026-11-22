// main.ts is mend, the CLI SPEC.md specifies (MIT). Node 22, the standard library alone; run it as
// `node main.ts [options] [PATCH]`. Sections of SPEC.md are cited as "§N" in the comments below.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

/** A fault that ends the run at once with exit 2 and one line (§2). */
class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
/** A failed edit (§2, exit 1): its code and the path the failure concerns. */
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const parseError = (lineNo: number): Exit2 => new Exit2(`error: parse ${lineNo}`);
const blank = (s: string): boolean => s.trim() === '';
/** Surrounding U+0020 spaces removed (not tabs or other whitespace). */
const unspace = (s: string): string => s.replace(/^ +| +$/g, '');

/** §3: a patch's lines, each with one trailing CR removed, without the empty piece after a final LF. */
function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

/** §3: a safe path. */
function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** §10: every path an edit names is checked for safety before anything else about the edit. */
function checkSafe(...paths: string[]): void {
  for (const p of paths) if (!safe(p)) throw new Fail('unsafe', p);
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  /** Successful move edits (§2 `R` lines): [old, new]. */
  readonly moves: [string, string][] = [];
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
  /** Whether `p` is a directory in the tree as the edits leave it (it holds a file, or survives on disk). */
  private isDir(p: string): boolean {
    const prefix = p + '/';
    for (const [k, v] of this.now) if (v !== null && k.startsWith(prefix)) return true;
    return this.survives(p);
  }
  /** A directory on disk that the edits so far have not emptied of files (an empty one stays). */
  private survives(p: string): boolean {
    let names: { name: string; dir: boolean }[];
    try {
      if (!statSync(p).isDirectory()) return false;
      names = readdirSync(p, { withFileTypes: true }).map((d) => ({ name: d.name, dir: d.isDirectory() }));
    } catch {
      return false;
    }
    if (names.length === 0) return true;
    for (const n of names) {
      const c = p + '/' + n.name;
      if (n.dir) {
        if (this.survives(c)) return true;
      } else if (!(this.now.has(c) && this.now.get(c) === null)) return true;
    }
    return false;
  }
  /** Whether a file cannot be created at `p`: it exists as anything, an ancestor is a file, or it is a directory. */
  blocked(p: string): boolean {
    if (this.get(p) !== null) return true;
    const segs = p.split('/');
    for (let k = 1; k < segs.length; k += 1) if (this.get(segs.slice(0, k).join('/')) !== null) return true;
    return this.isDir(p);
  }
}

type Edit = (tree: Tree) => void;

// ---------------------------------------------------------------------------------------------------------------
// §3 files and lines

/** A file as lines: its line break, its lines, and whether its text ended with a line break. */
interface Doc {
  br: string;
  lines: string[];
  final: boolean;
}

function parseDoc(text: string): Doc {
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  if (text === '') return { br, lines: [], final: false };
  const lines = text.split(br);
  const final = text.endsWith(br);
  if (final) lines.pop(); // the last, empty piece is not a line
  return { br, lines, final };
}

/** A file of no lines is written empty; otherwise lines joined by its break, ended by one when `final`. */
function docText(d: Doc): string {
  return d.lines.length === 0 ? '' : d.lines.join(d.br) + (d.final ? d.br : '');
}

/** A file an edit creates: LF breaks, a final one unless `final` is false (§3). */
function createdText(lines: string[], final = true): string {
  return lines.length === 0 ? '' : lines.join('\n') + (final ? '\n' : '');
}

// ---------------------------------------------------------------------------------------------------------------
// §5 matching lines

/** One line of a hunk, chunk or block body: ' ' context, '-' old, '+' new. `noeol`: a `\` line follows it (§6). */
interface Entry {
  kind: ' ' | '-' | '+';
  text: string;
  noeol: boolean;
}

/** An old line O and the new lines N of a body; a new line remembers the index in O when it is context. */
interface Split {
  old: string[];
  nw: { text: string; ctx: number }[];
}

function splitEntries(entries: Entry[]): Split {
  const old: string[] = [];
  const nw: { text: string; ctx: number }[] = [];
  for (const e of entries) {
    if (e.kind === ' ') {
      nw.push({ text: e.text, ctx: old.length });
      old.push(e.text);
    } else if (e.kind === '-') old.push(e.text);
    else nw.push({ text: e.text, ctx: -1 });
  }
  return { old, nw };
}

/** A line as compared at a tier: tier 1 drops trailing spaces and tabs, tier 2 leading ones too. */
function norm(s: string, tier: number): string {
  let a = 0;
  let b = s.length;
  if (tier === 2) while (a < b && (s[a] === ' ' || s[a] === '\t')) a += 1;
  if (tier >= 1) while (b > a && (s[b - 1] === ' ' || s[b - 1] === '\t')) b -= 1;
  return a === 0 && b === s.length ? s : s.slice(a, b);
}

/** The leading spaces and tabs of a line. */
function lead(s: string): string {
  let a = 0;
  while (a < s.length && (s[a] === ' ' || s[a] === '\t')) a += 1;
  return s.slice(0, a);
}

/**
 * The occurrences of `old` in `lines` at the first tier (0 only when `strict`) where there is one at or after
 * `from` (and, with `eof`, ending at the last line): the tier and the ascending positions, or null.
 */
function findOccurrences(lines: string[], old: string[], strict: boolean, from = 0, eof = false): { tier: number; at: number[] } | null {
  const last = lines.length - old.length;
  for (let tier = 0; tier <= (strict ? 0 : 2); tier += 1) {
    const f = tier === 0 ? lines : lines.map((l) => norm(l, tier));
    const o = tier === 0 ? old : old.map((l) => norm(l, tier));
    const at: number[] = [];
    for (let i = eof ? Math.max(last, from) : Math.max(from, 0); i <= last; i += 1) {
      let k = 0;
      while (k < o.length && f[i + k] === o[k]) k += 1;
      if (k === o.length) at.push(i);
    }
    if (at.length > 0) return { tier, at };
  }
  return null;
}

/** N as written for a match of O at `pos` found at `tier`: context from the file, other lines re-indented at tier 2. */
function resolveNew(lines: string[], pos: number, split: Split, tier: number): string[] {
  const f = tier === 2 ? lead(lines[pos]!) : '';
  const p = tier === 2 ? lead(split.old[0]!) : '';
  return split.nw.map((e) => {
    if (e.ctx >= 0) return lines[pos + e.ctx]!;
    if (tier === 2 && !blank(e.text) && e.text.startsWith(p)) return f + e.text.slice(p.length);
    return e.text;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// §9 JSON edits

/** One JSON edit object (§9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    checkSafe(p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      checkSafe(p);
      if (tree.blocked(p)) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const doc = parseDoc(exists(tree));
      if (line < 0 || line > doc.lines.length) throw new Fail('no-match', p);
      doc.lines.splice(line, 0, ...add);
      tree.now.set(p, docText(doc));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw parseError(1);
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    // array form: any fault is reported at the line where the array starts
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw parseError(first + 1);
    }
    if (!Array.isArray(v)) throw parseError(first + 1);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw parseError(first + 1);
      edits.push(e);
    }
    return edits;
  }
  // JSON Lines: one edit object a line
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw parseError(i + 1);
    edits.push(e);
  });
  return edits;
}

// ---------------------------------------------------------------------------------------------------------------
// §7 SEARCH/REPLACE blocks

function searchReplaceEdits(L: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let prevEnd = -1; // index of the previous block's REPLACE line
  let prevPath: string | null = null;
  let i = 0;
  while (i < L.length) {
    if (L[i]!.trimEnd() !== '<<<<<<< SEARCH') {
      i += 1;
      continue;
    }
    // the path: the nearest line before the SEARCH line (after the previous block) that is not blank or a fence
    let path: string | null = null;
    for (let p = i - 1; p > prevEnd; p -= 1) {
      const t = L[p]!.trim();
      if (t !== '' && !t.startsWith('```')) {
        path = t;
        break;
      }
    }
    if (path === null) path = prevPath;
    if (path === null) throw parseError(i + 1);
    let mid = i + 1;
    while (mid < L.length && L[mid]!.trimEnd() !== '=======') mid += 1;
    let end = mid + 1;
    while (end < L.length && L[end]!.trimEnd() !== '>>>>>>> REPLACE') end += 1;
    if (mid >= L.length || end >= L.length) throw parseError(i + 1);
    edits.push(searchReplaceEdit(path, L.slice(i + 1, mid), L.slice(mid + 1, end), strict));
    prevEnd = end;
    prevPath = path;
    i = end + 1;
  }
  return edits;
}

function searchReplaceEdit(path: string, old: string[], nw: string[], strict: boolean): Edit {
  return (tree) => {
    checkSafe(path);
    const text = tree.get(path);
    if (old.length === 0) {
      // empty old lines: the file is created
      if (tree.blocked(path)) throw new Fail('exists', path);
      tree.now.set(path, createdText(nw));
      return;
    }
    if (text === null) throw new Fail('missing', path);
    const doc = parseDoc(text);
    const found = findOccurrences(doc.lines, old, strict);
    if (found === null) throw new Fail('no-match', path);
    if (found.at.length > 1) throw new Fail('ambiguous', path);
    const pos = found.at[0]!;
    const split: Split = { old, nw: nw.map((t) => ({ text: t, ctx: -1 })) };
    doc.lines.splice(pos, old.length, ...resolveNew(doc.lines, pos, split, found.tier));
    tree.now.set(path, docText(doc)); // the final break stays as it was
  };
}

// ---------------------------------------------------------------------------------------------------------------
// §6 unified diffs

interface Hunk {
  a: number; // A of `@@ -A[,B] +C[,D] @@`
  entries: Entry[];
}

/** A section of a unified diff; a path is a string, null for /dev/null, undefined when not named. */
interface Section {
  hunks: Hunk[];
  hasPair: boolean; // a `---`/`+++` pair is part of its header
  pairOld: string | null | undefined;
  pairNew: string | null | undefined;
  renameFrom: string | undefined;
  renameTo: string | undefined;
  gitOld: string | undefined;
  gitNew: string | undefined;
  newFile: boolean;
  deletedFile: boolean;
}

function newSection(): Section {
  return { hunks: [], hasPair: false, pairOld: undefined, pairNew: undefined, renameFrom: undefined, renameTo: undefined, gitOld: undefined, gitNew: undefined, newFile: false, deletedFile: false };
}

/** The path of a `--- ` or `+++ ` line: text after the four characters up to the first tab, spaces removed, a/ b/ dropped. */
function pairPath(line: string): string | null {
  let t = line.slice(4);
  const tab = t.indexOf('\t');
  if (tab >= 0) t = t.slice(0, tab);
  t = unspace(t);
  if (t === '/dev/null') return null;
  return t.startsWith('a/') || t.startsWith('b/') ? t.slice(2) : t;
}

/** `diff --git a/<X> b/<Y>`: [X, Y], or null when the line is not of that form. */
function gitPaths(line: string): [string, string] | null {
  const rest = line.slice('diff --git '.length);
  if (!rest.startsWith('a/')) return null;
  const body = rest.slice(2); // X + ' b/' + Y
  const half = (body.length - 3) / 2;
  if (Number.isInteger(half) && half >= 0 && body.slice(half, half + 3) === ' b/' && body.slice(0, half) === body.slice(half + 3)) return [body.slice(0, half), body.slice(half + 3)];
  const at = body.indexOf(' b/');
  if (at < 0) return null;
  return [body.slice(0, at), body.slice(at + 3)];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/;

function unifiedEdits(L: string[], strict: boolean): Edit[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  const pairAt = (i: number): boolean => L[i]!.startsWith('--- ') && (L[i + 1] ?? '').startsWith('+++ ');
  let i = 0;
  while (i < L.length) {
    const line = L[i]!;
    const inHeader = cur !== null && cur.hunks.length === 0;
    if (line.startsWith('diff --git ')) {
      const paths = gitPaths(line);
      if (paths === null) throw parseError(i + 1);
      cur = newSection();
      cur.gitOld = paths[0];
      cur.gitNew = paths[1];
      sections.push(cur);
      i += 1;
    } else if (line.startsWith('--- ')) {
      if (pairAt(i)) {
        if (cur !== null && inHeader && !cur.hasPair) {
          cur.hasPair = true; // the pair of the section's own header
        } else {
          cur = newSection();
          cur.hasPair = true;
          sections.push(cur);
        }
        cur.pairOld = pairPath(line);
        cur.pairNew = pairPath(L[i + 1]!);
        i += 2;
      } else if (inHeader) throw parseError(i + 2); // `--- ` with no `+++ ` after it, in a header
      else i += 1;
    } else if (line.startsWith('@@')) {
      const m = HUNK_HEADER.exec(line);
      if (m === null || cur === null) throw parseError(i + 1);
      let j = i + 1;
      while (j < L.length && (L[j] === '' || ' -+\\'.includes(L[j]![0]!)) && !pairAt(j)) j += 1;
      let end = j;
      while (end > i + 1 && L[end - 1] === '') end -= 1; // empty lines at the end of a body are not part of it
      const entries: Entry[] = [];
      for (let k = i + 1; k < end; k += 1) {
        const l = L[k]!;
        if (l[0] === '\\') {
          if (entries.length > 0) entries[entries.length - 1]!.noeol = true;
        } else if (l === '') entries.push({ kind: ' ', text: '', noeol: false });
        else entries.push({ kind: l[0] as ' ' | '-' | '+', text: l.slice(1), noeol: false });
      }
      cur.hunks.push({ a: Number(m[1]), entries });
      i = j;
    } else {
      if (inHeader) {
        if (line.startsWith('new file mode')) cur!.newFile = true;
        else if (line.startsWith('deleted file mode')) cur!.deletedFile = true;
        else if (line.startsWith('rename from ')) cur!.renameFrom = line.slice('rename from '.length);
        else if (line.startsWith('rename to ')) cur!.renameTo = line.slice('rename to '.length);
      }
      i += 1;
    }
  }
  const edits: Edit[] = [];
  for (const s of sections) {
    const e = sectionEdit(s, strict);
    if (e !== null) edits.push(e);
  }
  return edits;
}

/** The one edit a section is (§6), or null when it names no path at all. */
function sectionEdit(s: Section, strict: boolean): Edit | null {
  const oldP = s.hasPair ? s.pairOld : (s.renameFrom ?? s.gitOld);
  const newP = s.hasPair ? s.pairNew : (s.renameTo ?? s.gitNew);
  if (oldP === null || s.newFile) {
    if (typeof newP !== 'string') return null;
    return createEdit(newP, s.hunks);
  }
  if (newP === null || s.deletedFile) {
    if (typeof oldP !== 'string') return null;
    return deleteEdit(oldP);
  }
  if (typeof oldP !== 'string' || typeof newP !== 'string') return null;
  return changeEdit(oldP, newP, s.hunks, strict);
}

/** A creation: the file is the `+` lines of all hunks; it ends with a line break unless a `\` follows its last `+` line. */
function createEdit(path: string, hunks: Hunk[]): Edit {
  const lines: string[] = [];
  let final = true;
  for (const h of hunks) {
    for (const e of h.entries) {
      if (e.kind !== '+') continue;
      lines.push(e.text);
      final = !e.noeol;
    }
  }
  return (tree) => {
    checkSafe(path);
    if (tree.blocked(path)) throw new Fail('exists', path);
    tree.now.set(path, createdText(lines, final));
  };
}

function deleteEdit(path: string): Edit {
  return (tree) => {
    checkSafe(path);
    if (tree.get(path) === null) throw new Fail('missing', path);
    tree.now.set(path, null);
  };
}

/** A change of one path (old === new) or a move (old !== new), with the hunks applied to the old file. */
function changeEdit(oldPath: string, newPath: string, hunks: Hunk[], strict: boolean): Edit {
  const move = oldPath !== newPath;
  return (tree) => {
    checkSafe(oldPath);
    if (move) checkSafe(newPath);
    const text = tree.get(oldPath);
    if (text === null) throw new Fail('missing', oldPath);
    if (move && tree.blocked(newPath)) throw new Fail('exists', newPath);
    const doc = parseDoc(text);
    applyHunks(doc, hunks, strict, oldPath);
    if (move) {
      tree.now.set(oldPath, null);
      tree.moves.push([oldPath, newPath]);
    }
    tree.now.set(move ? newPath : oldPath, docText(doc));
  };
}

/** §6 "Applying hunks": the hunks in order, each to the result of the ones before it. */
function applyHunks(doc: Doc, hunks: Hunk[], strict: boolean, path: string): void {
  let d = 0; // the sum of N's length minus O's length over the hunks applied so far
  for (const h of hunks) {
    const split = splitEntries(h.entries);
    const lines = doc.lines;
    let atEnd: boolean;
    if (split.old.length === 0) {
      // empty O: N is inserted after the first A + d lines (all of them when the file has fewer)
      const pos = Math.min(Math.max(h.a + d, 0), lines.length);
      atEnd = pos === lines.length;
      lines.splice(pos, 0, ...split.nw.map((e) => e.text));
    } else {
      const found = findOccurrences(lines, split.old, strict);
      if (found === null) throw new Fail('no-match', path);
      // the occurrence nearest to A - 1 + d; of two equally near, the earlier
      const want = h.a - 1 + d;
      let pos = found.at[0]!;
      for (const p of found.at) if (Math.abs(p - want) < Math.abs(pos - want)) pos = p;
      atEnd = pos + split.old.length === lines.length;
      lines.splice(pos, split.old.length, ...resolveNew(lines, pos, split, found.tier));
    }
    d += split.nw.length - split.old.length;
    if (atEnd) {
      // the result ends with a line break unless a `\` line follows the hunk's last context or `+` line
      let last: Entry | undefined;
      for (const e of h.entries) if (e.kind !== '-') last = e;
      doc.final = !(last !== undefined && last.noeol);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// §8 V4A patches

interface Chunk {
  anchor: string | null;
  entries: Entry[];
  eof: boolean;
}

const V4A_STARTS = ['*** Add File: ', '*** Delete File: ', '*** Update File: '];
const isV4aStart = (l: string): boolean => V4A_STARTS.some((s) => l.startsWith(s));

function v4aEdits(L: string[], strict: boolean): Edit[] {
  const first = L.findIndex((l) => !blank(l));
  if (first < 0) throw parseError(1);
  if (L[first]!.trim() !== '*** Begin Patch') throw parseError(first + 1);
  let last = L.length - 1;
  while (blank(L[last]!)) last -= 1;
  if (L[last]!.trim() !== '*** End Patch' || last === first) throw parseError(L.length + 1);
  const edits: Edit[] = [];
  let i = first + 1;
  while (i < last) {
    const line = L[i]!;
    if (blank(line)) {
      i += 1;
      continue;
    }
    if (!isV4aStart(line)) throw parseError(i + 1);
    let next = i + 1;
    while (next < last && !isV4aStart(L[next]!)) next += 1;
    let end = next;
    while (end > i + 1 && blank(L[end - 1]!)) end -= 1; // blank lines at the end of a section are not part of it
    const body = L.slice(i + 1, end);
    const at = i + 1; // line number of body[0] is at + 1
    if (line.startsWith('*** Add File: ')) edits.push(v4aAdd(unspace(line.slice(14)), body, at));
    else if (line.startsWith('*** Delete File: ')) {
      if (body.length > 0) throw parseError(at + 1);
      edits.push(deleteEdit(unspace(line.slice(17))));
    } else edits.push(v4aUpdate(unspace(line.slice(17)), body, at, i + 1, strict));
    i = next;
  }
  return edits;
}

function v4aAdd(path: string, body: string[], at: number): Edit {
  const lines = body.map((l, k) => {
    if (l === '') return '';
    if (l[0] === '+') return l.slice(1);
    throw parseError(at + k + 1);
  });
  return (tree) => {
    checkSafe(path);
    if (tree.blocked(path)) throw new Fail('exists', path);
    tree.now.set(path, createdText(lines));
  };
}

/** `at`: index of body[0] in the patch's lines; `headLine`: the 1-based number of the Update File line. */
function v4aUpdate(path: string, body: string[], at: number, headLine: number, strict: boolean): Edit {
  let move: string | null = null;
  let start = 0;
  if (body.length > 0 && body[0]!.startsWith('*** Move to: ')) {
    move = unspace(body[0]!.slice(13));
    start = 1;
  }
  const chunks: Chunk[] = [];
  let cur: Chunk | null = null;
  const open = (anchor: string | null): Chunk => {
    const c: Chunk = { anchor, entries: [], eof: false };
    chunks.push(c);
    return c;
  };
  for (let k = start; k < body.length; k += 1) {
    const l = body[k]!;
    if (l.startsWith('@@')) {
      cur = open(unspace(l.slice(2)) || null);
    } else if (l === '*** End of File') {
      if (cur === null) throw parseError(at + k + 1); // no chunk is open
      cur.eof = true;
      cur = null;
    } else if (l === '' || l[0] === ' ' || l[0] === '-' || l[0] === '+') {
      if (cur === null) {
        if (chunks.length > 0) throw parseError(at + k + 1); // only the first chunk may start at a body line
        cur = open(null);
      }
      cur.entries.push(l === '' ? { kind: ' ', text: '', noeol: false } : { kind: l[0] as ' ' | '-' | '+', text: l.slice(1), noeol: false });
    } else throw parseError(at + k + 1);
  }
  if (chunks.length === 0 && move === null) throw parseError(headLine);
  return (tree) => {
    checkSafe(path);
    if (move !== null) checkSafe(move);
    const text = tree.get(path);
    if (text === null) throw new Fail('missing', path);
    if (move !== null && tree.blocked(move)) throw new Fail('exists', move);
    const doc = parseDoc(text);
    const lines = doc.lines;
    let cursor = 0;
    for (const c of chunks) {
      if (c.anchor !== null) {
        const idx = findOccurrences(lines.slice(cursor), [c.anchor], strict);
        if (idx === null) throw new Fail('no-match', path);
        cursor += idx.at[0]! + 1;
      }
      const split = splitEntries(c.entries);
      if (split.old.length === 0) {
        const pos = c.eof ? lines.length : cursor;
        lines.splice(pos, 0, ...split.nw.map((e) => e.text));
        cursor = pos + split.nw.length;
      } else {
        const found = findOccurrences(lines, split.old, strict, cursor, c.eof);
        if (found === null) throw new Fail('no-match', path);
        const pos = found.at[0]!;
        const written = resolveNew(lines, pos, split, found.tier);
        lines.splice(pos, split.old.length, ...written);
        cursor = pos + written.length;
      }
    }
    if (move !== null) {
      tree.now.set(path, null);
      tree.moves.push([path, move]);
      tree.now.set(move, docText(doc));
    } else tree.now.set(path, docText(doc));
  };
}

// ---------------------------------------------------------------------------------------------------------------
// §4 detection

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// §1, §2, §10 the run

const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

function run(args: string[]): { code: number; out: string[] } {
  // §1 command line
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  // the whole patch is read before any file is looked at
  let edits: Edit[];
  try {
    if (kind === 'json') edits = jsonEdits(text, lines);
    else if (kind === 'search-replace') edits = searchReplaceEdits(lines, strict);
    else if (kind === 'unified') edits = unifiedEdits(lines, strict);
    else edits = v4aEdits(lines, strict);
    if (edits.length === 0) throw parseError(1);
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  // §10 edits in order, each failure reported, a failed edit changing nothing
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    const moves = tree.moves.length;
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      tree.moves.length = moves;
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  // §2 the report: A, D, M and R lines in byte order of the path (of the new path for R)
  const renamed = new Map<string, string>(); // new -> old
  const replacedOld = new Set<string>();
  for (const [o, n] of tree.moves) {
    if (tree.original(o) !== null && tree.get(o) === null && tree.original(n) === null && tree.get(n) !== null) {
      renamed.set(n, o);
      replacedOld.add(o);
    }
  }
  const rows: { key: string; text: string }[] = [];
  for (const p of tree.now.keys()) {
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (renamed.has(p)) rows.push({ key: p, text: `R ${renamed.get(p)!} -> ${p}` });
    else if (replacedOld.has(p)) continue;
    else if (was !== now) rows.push({ key: p, text: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  rows.sort((a, b) => byteOrder(a.key, b.key));
  if (!check) {
    // deletions first, so a path freed by one can be written by another
    for (const [p, now] of tree.now) {
      if (now === null && tree.original(p) !== null) {
        rmSync(p, { force: true });
        for (let d = dirname(p); d !== '.'; d = dirname(d)) {
          try {
            rmdirSync(d); // fails unless the directory is empty
          } catch {
            break;
          }
        }
      }
    }
    for (const [p, now] of tree.now) {
      if (now !== null && now !== tree.original(p)) {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }
  return { code: 0, out: [...rows.map((r) => r.text), `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}

const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
