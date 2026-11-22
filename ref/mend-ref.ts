// Independent reference implementation of "mend" (see ../SPEC.md).
// Node 22, standard library only, erasable TypeScript only.
import * as fs from "node:fs";
import * as nodePath from "node:path";

// ---------------------------------------------------------------- errors

class ParseError extends Error {
  line: number;
  constructor(line: number) {
    super("parse " + line);
    this.line = line;
  }
}

interface Fail {
  code: string;
  path: string;
}

interface Edit {
  paths: string[];
  run: (v: VFS, strict: boolean) => Fail | null;
}

// ---------------------------------------------------------------- virtual tree

class VFS {
  map: Map<string, string | null> = new Map();
  orig: Map<string, Buffer | null> = new Map();
  moves: Array<[string, string]> = [];

  origBuf(p: string): Buffer | null {
    if (this.orig.has(p)) return this.orig.get(p) as Buffer | null;
    let b: Buffer | null = null;
    try {
      const st = fs.statSync(p);
      if (st.isFile()) b = fs.readFileSync(p);
    } catch {
      b = null;
    }
    this.orig.set(p, b);
    return b;
  }

  get(p: string): string | null {
    if (this.map.has(p)) return this.map.get(p) as string | null;
    const b = this.origBuf(p);
    return b === null ? null : b.toString("utf8");
  }

  // anything at the path (file, or a directory), as the tree stands now
  taken(p: string): boolean {
    if (this.map.has(p) && this.map.get(p) !== null) return true;
    const segs = p.split("/");
    for (let i = 1; i < segs.length; i++) {
      const q = segs.slice(0, i).join("/");
      if (this.get(q) !== null) return true;
    }
    const pre = p + "/";
    for (const [k, val] of this.map) {
      if (val !== null && k.startsWith(pre)) return true;
    }
    if (this.map.has(p)) return false;
    try {
      fs.lstatSync(p);
      return true;
    } catch {
      return false;
    }
  }

  set(p: string, text: string): void {
    this.map.set(p, text);
  }

  del(p: string): void {
    this.map.set(p, null);
  }
}

// ---------------------------------------------------------------- files, lines, paths

interface FileState {
  lines: string[];
  brk: string;
  fin: boolean;
}

function parseText(text: string): FileState {
  const k = text.indexOf("\n");
  const brk = k > 0 && text[k - 1] === "\r" ? "\r\n" : "\n";
  if (text === "") return { lines: [], brk, fin: false };
  const parts = text.split(brk);
  let fin = false;
  if (parts[parts.length - 1] === "") {
    parts.pop();
    fin = true;
  }
  return { lines: parts, brk, fin };
}

function serialize(f: FileState): string {
  if (f.lines.length === 0) return "";
  return f.lines.join(f.brk) + (f.fin ? f.brk : "");
}

function isSafe(p: string): boolean {
  if (p === "") return false;
  if (p.startsWith("/")) return false;
  if (p.includes("\\")) return false;
  for (const s of p.split("/")) {
    if (s === "" || s === "." || s === "..") return false;
  }
  return true;
}

// patch text -> lines
function splitPatch(text: string): string[] {
  if (text === "") return [];
  const parts = text.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts.map((s) => (s.endsWith("\r") ? s.slice(0, -1) : s));
}

function isBlank(s: string): boolean {
  return /^\s*$/.test(s);
}

function trimSpaces(s: string): string {
  return s.replace(/^ +/, "").replace(/ +$/, "");
}

// ---------------------------------------------------------------- matching

function norm(tier: number, s: string): string {
  if (tier === 0) return s;
  if (tier === 1) return s.replace(/[ \t]+$/, "");
  return s.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
}

// first tier with an occurrence accepted by ok(i); returns tier and positions
function findOcc(
  lines: string[],
  O: string[],
  strict: boolean,
  ok: (i: number) => boolean,
): { tier: number; pos: number[] } | null {
  const maxTier = strict ? 0 : 2;
  for (let tier = 0; tier <= maxTier; tier++) {
    const nl = lines.map((l) => norm(tier, l));
    const no = O.map((l) => norm(tier, l));
    const pos: number[] = [];
    for (let i = 0; i + no.length <= nl.length; i++) {
      let good = true;
      for (let j = 0; j < no.length; j++) {
        if (nl[i + j] !== no[j]) {
          good = false;
          break;
        }
      }
      if (good && ok(i)) pos.push(i);
    }
    if (pos.length > 0) return { tier, pos };
  }
  return null;
}

function leadWs(s: string): string {
  const m = /^[ \t]*/.exec(s);
  return m ? m[0] : "";
}

interface Item {
  t: string; // ' ', '-', '+'
  s: string;
  noeol: boolean;
}

// builds the replacement lines of a match at position i, tier tier
function buildN(items: Item[], lines: string[], i: number, tier: number, O: string[]): string[] {
  const out: string[] = [];
  let j = 0;
  const F = leadWs(lines[i]);
  const P = leadWs(O[0]);
  for (const it of items) {
    if (it.t === " ") {
      out.push(lines[i + j]);
      j++;
    } else if (it.t === "-") {
      j++;
    } else {
      out.push(reindent(tier, it.s, F, P));
    }
  }
  return out;
}

function reindent(tier: number, line: string, F: string, P: string): string {
  if (tier !== 2) return line;
  if (/^\s*$/.test(line)) return line;
  if (line.startsWith(P)) return F + line.slice(P.length);
  return line;
}

// ---------------------------------------------------------------- unified diffs

interface Hunk {
  A: number;
  items: Item[];
}

interface Section {
  gitX: string | null;
  gitY: string | null;
  pair: { o: string | null; n: string | null } | null;
  renameFrom: string | null;
  renameTo: string | null;
  newFile: boolean;
  delFile: boolean;
  inHeader: boolean;
  hunks: Hunk[];
}

function newSection(): Section {
  return {
    gitX: null,
    gitY: null,
    pair: null,
    renameFrom: null,
    renameTo: null,
    newFile: false,
    delFile: false,
    inHeader: true,
    hunks: [],
  };
}

function parseGitLine(line: string): [string, string] | null {
  const pre = "diff --git a/";
  if (!line.startsWith(pre)) return null;
  const rest = line.slice(pre.length);
  const cands: number[] = [];
  let from = 0;
  for (;;) {
    const k = rest.indexOf(" b/", from);
    if (k < 0) break;
    cands.push(k);
    from = k + 1;
  }
  if (cands.length === 0) return null;
  for (const k of cands) {
    if (rest.slice(0, k) === rest.slice(k + 3)) return [rest.slice(0, k), rest.slice(k + 3)];
  }
  const k = cands[0];
  return [rest.slice(0, k), rest.slice(k + 3)];
}

function headerPath(line: string): string | null {
  let t = line.slice(4);
  const tab = t.indexOf("\t");
  if (tab >= 0) t = t.slice(0, tab);
  t = trimSpaces(t);
  if (t === "/dev/null") return null;
  if (t.startsWith("a/") || t.startsWith("b/")) t = t.slice(2);
  return t;
}

function isPairAt(L: string[], i: number): boolean {
  return L[i].startsWith("--- ") && i + 1 < L.length && L[i + 1].startsWith("+++ ");
}

function parseUnified(L: string[]): Edit[] {
  const n = L.length;
  const sections: Section[] = [];
  let cur: Section | null = null;
  let i = 0;
  while (i < n) {
    const line = L[i];
    if (line.startsWith("diff --git ")) {
      const g = parseGitLine(line);
      if (g === null) throw new ParseError(i + 1);
      cur = newSection();
      cur.gitX = g[0];
      cur.gitY = g[1];
      sections.push(cur);
      i++;
      continue;
    }
    if (isPairAt(L, i)) {
      const o = headerPath(L[i]);
      const nn = headerPath(L[i + 1]);
      if (cur !== null && cur.inHeader && cur.pair === null) {
        cur.pair = { o, n: nn };
      } else {
        cur = newSection();
        cur.pair = { o, n: nn };
        sections.push(cur);
      }
      i += 2;
      continue;
    }
    if (line.startsWith("--- ")) {
      if (cur !== null && cur.inHeader) throw new ParseError(i + 2);
      i++;
      continue;
    }
    if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
      if (m === null || cur === null) throw new ParseError(i + 1);
      cur.inHeader = false;
      const items: Item[] = [];
      let j = i + 1;
      while (j < n) {
        const l = L[j];
        if (l.startsWith("diff --git ") || isPairAt(L, j)) break;
        if (l === "") {
          items.push({ t: " ", s: "", noeol: false });
        } else if (l[0] === " " || l[0] === "-" || l[0] === "+") {
          items.push({ t: l[0], s: l.slice(1), noeol: false });
        } else if (l[0] === "\\") {
          items.push({ t: "\\", s: l, noeol: false });
        } else {
          break;
        }
        j++;
      }
      // empty lines at the end of a body are not part of it
      while (items.length > 0) {
        const last = items[items.length - 1];
        if (last.t === " " && last.s === "" && L[i + items.length] === "") items.pop();
        else break;
      }
      // fold backslash lines into the line before them
      const folded: Item[] = [];
      for (const it of items) {
        if (it.t === "\\") {
          if (folded.length > 0) folded[folded.length - 1].noeol = true;
        } else {
          folded.push(it);
        }
      }
      cur.hunks.push({ A: Number(m[1]), items: folded });
      i = j;
      continue;
    }
    if (cur !== null && cur.inHeader) {
      if (line.startsWith("rename from ")) cur.renameFrom = line.slice("rename from ".length);
      else if (line.startsWith("rename to ")) cur.renameTo = line.slice("rename to ".length);
      else if (line.startsWith("new file mode")) cur.newFile = true;
      else if (line.startsWith("deleted file mode")) cur.delFile = true;
    }
    i++;
  }
  return sections.map(unifiedEdit);
}

function applyHunks(text: string, hunks: Hunk[], strict: boolean): string | null {
  const f = parseText(text);
  let d = 0;
  for (const h of hunks) {
    const O: string[] = [];
    const Nitems: Item[] = [];
    for (const it of h.items) {
      if (it.t !== "+") O.push(it.s);
      if (it.t !== "-") Nitems.push(it);
    }
    const lastN = Nitems.length > 0 ? Nitems[Nitems.length - 1] : null;
    if (O.length === 0) {
      if (Nitems.length === 0) continue;
      let pos = h.A + d;
      if (pos < 0) pos = 0;
      if (pos > f.lines.length) pos = f.lines.length;
      const atEnd = pos === f.lines.length;
      f.lines.splice(pos, 0, ...Nitems.map((x) => x.s));
      if (atEnd) f.fin = !(lastN !== null && lastN.noeol);
      d += Nitems.length;
      continue;
    }
    const target = h.A - 1 + d;
    const found = findOcc(f.lines, O, strict, () => true);
    if (found === null) return null;
    let best = found.pos[0];
    for (const p of found.pos) {
      if (Math.abs(p - target) < Math.abs(best - target)) best = p;
    }
    const repl = buildN(h.items, f.lines, best, found.tier, O);
    const atEnd = best + O.length === f.lines.length;
    f.lines.splice(best, O.length, ...repl);
    if (atEnd) f.fin = !(lastN !== null && lastN.noeol);
    d += repl.length - O.length;
  }
  return serialize(f);
}

function unifiedEdit(sec: Section): Edit {
  let oldP: string | null = null;
  let newP: string | null = null;
  if (sec.pair !== null) {
    oldP = sec.pair.o;
    newP = sec.pair.n;
  } else {
    oldP = sec.renameFrom !== null ? sec.renameFrom : sec.gitX;
    newP = sec.renameTo !== null ? sec.renameTo : sec.gitY;
  }
  const creation = (sec.pair !== null && oldP === null) || sec.newFile;
  const deletion = (sec.pair !== null && newP === null) || sec.delFile;
  const hunks = sec.hunks;

  if (creation) {
    const path = newP !== null ? newP : oldP !== null ? oldP : "";
    const lines: string[] = [];
    let noeol = false;
    for (const h of hunks) {
      for (const it of h.items) {
        if (it.t === "+") {
          lines.push(it.s);
          noeol = it.noeol;
        }
      }
    }
    const text = lines.length === 0 ? "" : lines.join("\n") + (noeol ? "" : "\n");
    return {
      paths: [path],
      run: (v) => {
        if (v.taken(path)) return { code: "exists", path };
        v.set(path, text);
        return null;
      },
    };
  }
  if (deletion) {
    const path = oldP !== null ? oldP : newP !== null ? newP : "";
    return {
      paths: [path],
      run: (v) => {
        if (v.get(path) === null) return { code: "missing", path };
        v.del(path);
        return null;
      },
    };
  }
  const op = oldP !== null ? oldP : "";
  const np = newP !== null ? newP : "";
  if (op !== np) {
    return {
      paths: [op, np],
      run: (v, strict) => {
        const t = v.get(op);
        if (t === null) return { code: "missing", path: op };
        if (v.taken(np)) return { code: "exists", path: np };
        const r = applyHunks(t, hunks, strict);
        if (r === null) return { code: "no-match", path: op };
        v.set(np, r);
        v.del(op);
        v.moves.push([op, np]);
        return null;
      },
    };
  }
  return {
    paths: [op],
    run: (v, strict) => {
      const t = v.get(op);
      if (t === null) return { code: "missing", path: op };
      const r = applyHunks(t, hunks, strict);
      if (r === null) return { code: "no-match", path: op };
      v.set(op, r);
      return null;
    },
  };
}

// ---------------------------------------------------------------- SEARCH/REPLACE

function parseSearchReplace(L: string[]): Edit[] {
  const n = L.length;
  const edits: Edit[] = [];
  const trimEnd = (s: string) => s.replace(/\s+$/, "");
  let lastEnd = -1; // index of previous REPLACE line
  let prevPath: string | null = null;
  let i = 0;
  while (i < n) {
    if (trimEnd(L[i]) !== "<<<<<<< SEARCH") {
      i++;
      continue;
    }
    let path: string | null = null;
    for (let j = i - 1; j > lastEnd; j--) {
      const t = L[j].trim();
      if (t === "" || t.startsWith("```")) continue;
      path = t;
      break;
    }
    if (path === null) path = prevPath;
    if (path === null) throw new ParseError(i + 1);
    let m = -1;
    for (let j = i + 1; j < n; j++) {
      if (trimEnd(L[j]) === "=======") {
        m = j;
        break;
      }
    }
    if (m < 0) throw new ParseError(i + 1);
    let r = -1;
    for (let j = m + 1; j < n; j++) {
      if (trimEnd(L[j]) === ">>>>>>> REPLACE") {
        r = j;
        break;
      }
    }
    if (r < 0) throw new ParseError(i + 1);
    const oldLines = L.slice(i + 1, m);
    const newLines = L.slice(m + 1, r);
    edits.push(srEdit(path, oldLines, newLines));
    prevPath = path;
    lastEnd = r;
    i = r + 1;
  }
  return edits;
}

function srEdit(path: string, O: string[], N: string[]): Edit {
  return {
    paths: [path],
    run: (v, strict) => {
      if (O.length === 0) {
        if (v.taken(path)) return { code: "exists", path };
        v.set(path, N.length === 0 ? "" : N.join("\n") + "\n");
        return null;
      }
      const t = v.get(path);
      if (t === null) return { code: "missing", path };
      const f = parseText(t);
      const found = findOcc(f.lines, O, strict, () => true);
      if (found === null) return { code: "no-match", path };
      if (found.pos.length > 1) return { code: "ambiguous", path };
      const i = found.pos[0];
      const F = leadWs(f.lines[i]);
      const P = leadWs(O[0]);
      const repl = N.map((s) => reindent(found.tier, s, F, P));
      f.lines.splice(i, O.length, ...repl);
      v.set(path, serialize(f));
      return null;
    },
  };
}

// ---------------------------------------------------------------- V4A

interface Chunk {
  anchor: string;
  items: Item[];
  eof: boolean;
}

function parseV4A(L: string[]): Edit[] {
  const n = L.length;
  let b = -1;
  for (let k = 0; k < n; k++) {
    if (!isBlank(L[k])) {
      b = k;
      break;
    }
  }
  if (b < 0) throw new ParseError(1);
  if (L[b].trim() !== "*** Begin Patch") throw new ParseError(b + 1);
  let e = -1;
  for (let k = n - 1; k >= 0; k--) {
    if (!isBlank(L[k])) {
      e = k;
      break;
    }
  }
  if (L[e].trim() !== "*** End Patch") throw new ParseError(n + 1);

  interface Sec {
    type: string;
    path: string;
    no: number;
    lines: Array<{ s: string; no: number }>;
  }
  const secs: Sec[] = [];
  let cur: Sec | null = null;
  for (let k = b + 1; k < e; k++) {
    const l = L[k];
    let type = "";
    let pre = "";
    if (l.startsWith("*** Add File: ")) {
      type = "add";
      pre = "*** Add File: ";
    } else if (l.startsWith("*** Delete File: ")) {
      type = "delete";
      pre = "*** Delete File: ";
    } else if (l.startsWith("*** Update File: ")) {
      type = "update";
      pre = "*** Update File: ";
    }
    if (type !== "") {
      cur = { type, path: trimSpaces(l.slice(pre.length)), no: k + 1, lines: [] };
      secs.push(cur);
    } else if (cur === null) {
      if (isBlank(l)) continue;
      throw new ParseError(k + 1);
    } else {
      cur.lines.push({ s: l, no: k + 1 });
    }
  }

  const edits: Edit[] = [];
  for (const sec of secs) {
    while (sec.lines.length > 0 && isBlank(sec.lines[sec.lines.length - 1].s)) sec.lines.pop();
    const path = sec.path;
    if (sec.type === "add") {
      const out: string[] = [];
      for (const ln of sec.lines) {
        if (ln.s.startsWith("+")) out.push(ln.s.slice(1));
        else if (ln.s === "") out.push("");
        else throw new ParseError(ln.no);
      }
      const text = out.length === 0 ? "" : out.join("\n") + "\n";
      edits.push({
        paths: [path],
        run: (v) => {
          if (v.taken(path)) return { code: "exists", path };
          v.set(path, text);
          return null;
        },
      });
    } else if (sec.type === "delete") {
      if (sec.lines.length > 0) throw new ParseError(sec.lines[0].no);
      edits.push({
        paths: [path],
        run: (v) => {
          if (v.get(path) === null) return { code: "missing", path };
          v.del(path);
          return null;
        },
      });
    } else {
      let idx = 0;
      let moveTo: string | null = null;
      if (sec.lines.length > 0 && sec.lines[0].s.startsWith("*** Move to: ")) {
        moveTo = trimSpaces(sec.lines[0].s.slice("*** Move to: ".length));
        idx = 1;
      }
      const chunks: Chunk[] = [];
      let open: Chunk | null = null;
      for (; idx < sec.lines.length; idx++) {
        const { s, no } = sec.lines[idx];
        if (s.startsWith("@@")) {
          open = { anchor: trimSpaces(s.slice(2)), items: [], eof: false };
          chunks.push(open);
        } else if (s === "*** End of File") {
          if (open === null) throw new ParseError(no);
          open.eof = true;
          open = null;
        } else if (s === "" || s[0] === " " || s[0] === "-" || s[0] === "+") {
          const it: Item = s === "" ? { t: " ", s: "", noeol: false } : { t: s[0], s: s.slice(1), noeol: false };
          if (open !== null) {
            open.items.push(it);
          } else if (chunks.length === 0) {
            open = { anchor: "", items: [it], eof: false };
            chunks.push(open);
          } else {
            throw new ParseError(no);
          }
        } else {
          throw new ParseError(no);
        }
      }
      if (chunks.length === 0 && moveTo === null) throw new ParseError(sec.no);
      edits.push(v4aUpdate(path, moveTo, chunks));
    }
  }
  return edits;
}

function v4aUpdate(path: string, moveTo: string | null, chunks: Chunk[]): Edit {
  const paths = moveTo === null ? [path] : [path, moveTo];
  return {
    paths,
    run: (v, strict) => {
      const t = v.get(path);
      if (t === null) return { code: "missing", path };
      if (moveTo !== null && v.taken(moveTo)) return { code: "exists", path: moveTo };
      const f = parseText(t);
      let cursor = 0;
      for (const ch of chunks) {
        if (ch.anchor !== "") {
          const found = findOcc(f.lines.slice(cursor), [ch.anchor], strict, () => true);
          if (found === null) return { code: "no-match", path };
          cursor = cursor + found.pos[0] + 1;
        }
        const O: string[] = [];
        const Nitems: Item[] = [];
        for (const it of ch.items) {
          if (it.t !== "+") O.push(it.s);
          if (it.t !== "-") Nitems.push(it);
        }
        if (O.length === 0) {
          const pos = ch.eof ? f.lines.length : cursor;
          const ins = Nitems.map((x) => x.s);
          f.lines.splice(pos, 0, ...ins);
          cursor = pos + ins.length;
        } else {
          const len = f.lines.length;
          const found = findOcc(f.lines, O, strict, (i) => i >= cursor && (!ch.eof || i + O.length === len));
          if (found === null) return { code: "no-match", path };
          const i = found.pos[0];
          const repl = buildN(ch.items, f.lines, i, found.tier, O);
          f.lines.splice(i, O.length, ...repl);
          cursor = i + repl.length;
        }
      }
      const out = serialize(f);
      if (moveTo !== null) {
        v.set(moveTo, out);
        v.del(path);
        v.moves.push([path, moveTo]);
      } else {
        v.set(path, out);
      }
      return null;
    },
  };
}

// ---------------------------------------------------------------- JSON

function jsonEdit(o: unknown): Edit | null {
  if (o === null || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const path = r["path"];
  const command = r["command"];
  if (typeof path !== "string" || typeof command !== "string") return null;
  if (command === "create") {
    const ft = r["file_text"];
    if (typeof ft !== "string") return null;
    return {
      paths: [path],
      run: (v) => {
        if (v.taken(path)) return { code: "exists", path };
        v.set(path, ft);
        return null;
      },
    };
  }
  if (command === "str_replace") {
    const os = r["old_str"];
    let ns = r["new_str"];
    if (typeof os !== "string" || os === "") return null;
    if (ns === undefined) ns = "";
    if (typeof ns !== "string") return null;
    const newStr: string = ns;
    return {
      paths: [path],
      run: (v) => {
        const t = v.get(path);
        if (t === null) return { code: "missing", path };
        const k = t.indexOf("\n");
        const crlf = k > 0 && t[k - 1] === "\r";
        let text = t;
        let o2 = os;
        let n2 = newStr;
        if (crlf) {
          text = text.split("\r\n").join("\n");
          o2 = o2.split("\r\n").join("\n");
          n2 = n2.split("\r\n").join("\n");
        }
        let count = 0;
        let first = -1;
        let from = 0;
        for (;;) {
          const p = text.indexOf(o2, from);
          if (p < 0) break;
          if (count === 0) first = p;
          count++;
          from = p + 1;
        }
        if (count === 0) return { code: "no-match", path };
        if (count > 1) return { code: "ambiguous", path };
        let res = text.slice(0, first) + n2 + text.slice(first + o2.length);
        if (crlf) res = res.split("\n").join("\r\n");
        v.set(path, res);
        return null;
      },
    };
  }
  if (command === "insert") {
    const il = r["insert_line"];
    const ns = r["new_str"];
    if (typeof il !== "number" || !Number.isInteger(il)) return null;
    if (typeof ns !== "string") return null;
    return {
      paths: [path],
      run: (v) => {
        const t = v.get(path);
        if (t === null) return { code: "missing", path };
        const f = parseText(t);
        if (il < 0 || il > f.lines.length) return { code: "no-match", path };
        const ins = splitNew(ns);
        f.lines.splice(il, 0, ...ins);
        v.set(path, serialize(f));
        return null;
      },
    };
  }
  return null;
}

function splitNew(s: string): string[] {
  if (s === "") return [];
  const parts = s.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts.map((x) => (x.endsWith("\r") ? x.slice(0, -1) : x));
}

function parseJson(L: string[], text: string): Edit[] {
  let first = -1;
  for (let k = 0; k < L.length; k++) {
    if (!isBlank(L[k])) {
      first = k;
      break;
    }
  }
  if (first < 0) throw new ParseError(1);
  const edits: Edit[] = [];
  if (L[first].trimStart()[0] === "[") {
    let arr: unknown;
    try {
      arr = JSON.parse(L.join("\n"));
    } catch {
      throw new ParseError(first + 1);
    }
    if (!Array.isArray(arr)) throw new ParseError(first + 1);
    for (const el of arr) {
      const e = jsonEdit(el);
      if (e === null) throw new ParseError(first + 1);
      edits.push(e);
    }
    return edits;
  }
  for (let k = 0; k < L.length; k++) {
    if (isBlank(L[k])) continue;
    let o: unknown;
    try {
      o = JSON.parse(L[k]);
    } catch {
      throw new ParseError(k + 1);
    }
    const e = jsonEdit(o);
    if (e === null) throw new ParseError(k + 1);
    edits.push(e);
  }
  void text;
  return edits;
}

// ---------------------------------------------------------------- format detection

function detect(L: string[]): string | null {
  let first = -1;
  for (let k = 0; k < L.length; k++) {
    if (!isBlank(L[k])) {
      first = k;
      break;
    }
  }
  if (first >= 0) {
    if (L[first].trim() === "*** Begin Patch") return "v4a";
    const c = L[first].trimStart()[0];
    if (c === "[" || c === "{") return "json";
  }
  for (const l of L) {
    if (l.replace(/\s+$/, "") === "<<<<<<< SEARCH") return "search-replace";
  }
  for (let k = 0; k < L.length; k++) {
    if (L[k].startsWith("diff --git ")) return "unified";
    if (isPairAt(L, k)) return "unified";
  }
  return null;
}

// ---------------------------------------------------------------- main

function out(lines: string[]): void {
  process.stdout.write(lines.map((l) => l + "\n").join(""));
}

function main(): void {
  const args = process.argv.slice(2);
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let usage = false;
  let endOpts = false;
  for (const a of args) {
    if (endOpts) {
      pos.push(a);
      continue;
    }
    if (a === "--") {
      endOpts = true;
      continue;
    }
    if (a === "-" || !a.startsWith("-")) {
      pos.push(a);
      continue;
    }
    if (a === "--check") {
      if (check) usage = true;
      check = true;
    } else if (a === "--strict") {
      if (strict) usage = true;
      strict = true;
    } else if (a.startsWith("--format=")) {
      const val = a.slice("--format=".length);
      if (format !== null) usage = true;
      if (!["unified", "search-replace", "v4a", "json", "auto"].includes(val)) usage = true;
      format = val;
    } else {
      usage = true;
    }
  }
  if (pos.length > 1) usage = true;
  if (usage) {
    out(["error: usage"]);
    process.exitCode = 2;
    return;
  }
  if (format === null) format = "auto";

  let buf: Buffer;
  if (pos.length === 0 || pos[0] === "-") {
    try {
      buf = fs.readFileSync(0);
    } catch {
      buf = Buffer.alloc(0);
    }
  } else {
    try {
      buf = fs.readFileSync(pos[0]);
    } catch {
      out(["error: no-patch"]);
      process.exitCode = 2;
      return;
    }
  }
  const text = buf.toString("utf8");
  const L = splitPatch(text);

  if (format === "auto") {
    const d = detect(L);
    if (d === null) {
      out(["error: format"]);
      process.exitCode = 2;
      return;
    }
    format = d;
  }

  let edits: Edit[];
  try {
    if (format === "unified") edits = parseUnified(L);
    else if (format === "search-replace") edits = parseSearchReplace(L);
    else if (format === "v4a") edits = parseV4A(L);
    else edits = parseJson(L, text);
    if (edits.length === 0) throw new ParseError(1);
  } catch (e) {
    if (e instanceof ParseError) {
      out(["error: parse " + e.line]);
      process.exitCode = 2;
      return;
    }
    throw e;
  }

  const v = new VFS();
  const fails: Fail[] = [];
  for (const e of edits) {
    let bad: string | undefined;
    for (const p of e.paths) {
      if (!isSafe(p)) {
        bad = p;
        break;
      }
    }
    if (bad !== undefined) {
      fails.push({ code: "unsafe", path: bad });
      continue;
    }
    const r = e.run(v, strict);
    if (r !== null) fails.push(r);
  }

  if (fails.length > 0) {
    const lines = fails.map((f) => "error: " + f.code + " " + f.path);
    lines.push("failed: " + fails.length + " of " + edits.length + " edits");
    out(lines);
    process.exitCode = 1;
    return;
  }

  // compute changes
  interface Row {
    key: string;
    text: string;
  }
  const rows: Row[] = [];
  const before = (p: string): Buffer | null => v.origBuf(p);
  const after = (p: string): Buffer | null => {
    const t = v.get(p);
    return t === null ? null : Buffer.from(t, "utf8");
  };
  const status: Map<string, string> = new Map();
  const toWrite: Array<[string, Buffer | null]> = [];
  for (const p of v.map.keys()) {
    const b = before(p);
    const a = after(p);
    if (b === null && a === null) continue;
    if (b === null && a !== null) status.set(p, "A");
    else if (b !== null && a === null) status.set(p, "D");
    else if (b !== null && a !== null && !b.equals(a)) status.set(p, "M");
    else continue;
    toWrite.push([p, a]);
  }
  const used: Set<string> = new Set();
  for (const [o, nw] of v.moves) {
    if (status.get(o) === "D" && status.get(nw) === "A" && !used.has(o) && !used.has(nw)) {
      used.add(o);
      used.add(nw);
      rows.push({ key: nw, text: "R " + o + " -> " + nw });
    }
  }
  for (const [p, s] of status) {
    if (used.has(p)) continue;
    rows.push({ key: p, text: s + " " + p });
  }
  rows.sort((x, y) => Buffer.compare(Buffer.from(x.key, "utf8"), Buffer.from(y.key, "utf8")));

  const lines = rows.map((r) => r.text);
  lines.push(rows.length === 1 ? "ok: 1 file" : "ok: " + rows.length + " files");

  if (!check) {
    for (const [p, a] of toWrite) {
      if (a === null) {
        try {
          fs.unlinkSync(p);
        } catch {
          // ignore
        }
      }
    }
    for (const [p, a] of toWrite) {
      if (a !== null) {
        fs.mkdirSync(nodePath.dirname(p), { recursive: true });
        fs.writeFileSync(p, a);
      }
    }
  }
  out(lines);
  process.exitCode = 0;
}

main();
