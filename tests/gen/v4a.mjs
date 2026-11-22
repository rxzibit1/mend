import { lines, out, failOut, suite } from '../lib.mjs';

const { t, write } = suite('v4a', 'v4a');
const F3 = 'one\ntwo\nthree\n';
const OK1 = (p) => out(`M ${p}`, 'ok: 1 file');
const B = '*** Begin Patch';
const E = '*** End Patch';
const wrap = (...body) => lines(B, ...body, E);
const upd = (p) => `*** Update File: ${p}`;
const FA = 'def f():\n    x = 1\ndef g():\n    x = 1\n';

// ---- Begin / End rules and their parse line numbers ------------------------------------------------------------
t('s8-begin-end-whitespace-tolerant', {
  patch: lines('', '   ', '  *** Begin Patch  ', '*** Add File: n.txt', '+x', '\t*** End Patch \t', '', ''),
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'x\n' },
  note: 'trailing blank lines after End Patch are blank, so the last non-blank line is End Patch',
});
t('s8-first-line-not-begin', {
  patch: lines('hello', B, '*** Add File: n.txt', '+x', E),
  argv: ['--format=v4a', 'p.patch'], files: {}, exit: 2, stdout: out('error: parse 1'),
});
t('s8-first-nonblank-not-begin-line-number', {
  patch: lines('', '  ', 'hello', B, '*** Add File: n.txt', '+x', E),
  argv: ['--format=v4a', 'p.patch'], files: {}, exit: 2, stdout: out('error: parse 3'),
});
t('s8-empty-patch-forced-parse-1', {
  patch: '', argv: ['--format=v4a', 'p.patch'], files: {}, exit: 2, stdout: out('error: parse 1'),
});
t('s8-blank-only-patch-forced-parse-1', {
  patch: '\n  \n\t\n', argv: ['--format=v4a', 'p.patch'], files: {}, exit: 2, stdout: out('error: parse 1'),
  note: 'there is no non-blank line: parse 1',
});
t('s8-missing-end-patch', {
  patch: lines(B, '*** Add File: n.txt', '+x'),
  files: {}, exit: 2, stdout: out('error: parse 4'),
});
t('s8-missing-end-patch-counts-trailing-blank-lines', {
  patch: B + '\n*** Add File: n.txt\n+x\n\n\n',
  files: {}, exit: 2, stdout: out('error: parse 6'),
  note: 'patch lines: Begin, Add, +x, "", "" = 5 lines, so parse 5 + 1',
});
t('s8-only-begin-line', {
  patch: B + '\n', argv: ['--format=v4a', 'p.patch'], files: {}, exit: 2, stdout: out('error: parse 2'),
  note: 'the last non-blank line (line 1) is not End Patch: parse (1 patch line) + 1',
});
t('s8-begin-end-without-edit', {
  patch: lines(B, E), files: {}, exit: 2, stdout: out('error: parse 1'),
});
t('s8-begin-end-only-blank-between', {
  patch: lines(B, '', '  ', E), files: {}, exit: 2, stdout: out('error: parse 1'),
});
t('s8-end-patch-in-the-middle', {
  patch: lines(B, E, '*** Add File: n.txt', '+x', E),
  files: {}, exit: 2, stdout: out('error: parse 2'),
});
t('s8-begin-twice', {
  patch: lines(B, B, '*** Add File: n.txt', '+x', E),
  files: {}, exit: 2, stdout: out('error: parse 2'),
});
t('s8-trailing-prose-after-end', {
  patch: lines(B, '*** Add File: n.txt', '+x', E, 'thanks'),
  argv: ['--format=v4a', 'p.patch'], files: {}, exit: 2, stdout: out('error: parse 6'),
});
t('s8-other-line-right-after-begin', {
  patch: lines(B, 'hello', '*** Add File: n.txt', '+x', E),
  files: {}, exit: 2, stdout: out('error: parse 2'),
});
t('s8-other-line-in-add-section', {
  patch: lines(B, '*** Add File: n.txt', '+x', '-y', E),
  files: {}, exit: 2, stdout: out('error: parse 4'),
});
t('s8-add-section-space-line-is-parse', {
  patch: lines(B, '*** Add File: n.txt', '+x', ' y', E),
  files: {}, exit: 2, stdout: out('error: parse 4'),
  note: 'an Add File line must start with + or be empty; " y" is neither',
});
t('s8-other-line-between-sections', {
  patch: lines(B, '*** Delete File: a.txt', 'oops', '*** Add File: n.txt', '+x', E),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 3'),
});
t('s8-delete-section-has-no-lines', {
  patch: lines(B, '*** Delete File: a.txt', '-one', E),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 3'),
});
t('s8-parse-beats-failures', {
  patch: lines(B, '*** Delete File: nofile.txt', '*** Add File: n.txt', '+x', 'garbage', E),
  files: {}, exit: 2, stdout: out('error: parse 5'),
});

// ---- blank lines -----------------------------------------------------------------------------------------------
t('s8-blank-lines-between-sections-ignored', {
  patch: lines(B, '', '*** Add File: a.txt', '+x', '', '', '*** Add File: b.txt', '+y', '', E),
  files: {}, stdout: out('A a.txt', 'A b.txt', 'ok: 2 files'), changes: { 'a.txt': 'x\n', 'b.txt': 'y\n' },
});
t('s8-whitespace-only-lines-between-sections', {
  patch: lines(B, '  ', '*** Add File: a.txt', '+x', '   ', '\t', '*** Add File: b.txt', '+y', ' ', E),
  files: {}, stdout: out('A a.txt', 'A b.txt', 'ok: 2 files'), changes: { 'a.txt': 'x\n', 'b.txt': 'y\n' },
  note: 'AMBIGUOUS: section 8 does not redefine "blank"; section 4 defines it as empty or only whitespace, taken here',
});
t('s8-add-trailing-blank-lines-not-part', {
  patch: lines(B, '*** Add File: n.txt', '+x', '', '', E),
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'x\n' },
});
t('s8-add-middle-blank-line-is-empty-line', {
  patch: lines(B, '*** Add File: n.txt', '+a', '', '+b', E),
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'a\n\nb\n' },
});
t('s8-add-plus-only-line-and-indent-kept', {
  patch: lines(B, '*** Add File: n.txt', '+a', '+', '+  b  ', '+\tc', E),
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'a\n\n  b  \n\tc\n' },
});
t('s8-add-zero-lines-empty-file', {
  patch: lines(B, '*** Add File: e.txt', '*** Add File: n.txt', '+x', E),
  files: {}, stdout: out('A e.txt', 'A n.txt', 'ok: 2 files'), changes: { 'e.txt': '', 'n.txt': 'x\n' },
  note: 'an Add File with no lines: the file of no lines is written empty',
});
t('s8-update-only-blank-lines-no-chunk', {
  patch: lines(B, upd('a.txt'), '', E),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 2'),
  note: 'blank lines at the end of a section are not part of it, so the section has no chunk',
});

// ---- Add / Delete ----------------------------------------------------------------------------------------------
t('s8-add-path-spaces-trimmed', {
  patch: lines(B, '*** Add File:   my dir/a b.txt   ', '+x', E),
  files: {}, stdout: out('A my dir/a b.txt', 'ok: 1 file'), changes: { 'my dir/a b.txt': 'x\n' },
});
t('s8-add-header-needs-space-after-colon', {
  patch: lines(B, '*** Add File:n.txt', '+x', E),
  files: {}, exit: 2, stdout: out('error: parse 2'),
  note: 'sections start at "*** Add File: " (with the space); "*** Add File:n.txt" is an other line',
});
t('s8-add-exists', {
  patch: wrap('*** Add File: a.txt', '+x'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: exists a.txt'], 1, 1),
});
t('s8-add-exists-empty-file', {
  patch: wrap('*** Add File: a.txt', '+x'),
  files: { 'a.txt': '' }, exit: 1, stdout: failOut(['error: exists a.txt'], 1, 1),
});
t('s8-delete-basic', {
  patch: wrap('*** Delete File: a.txt'),
  files: { 'a.txt': F3, 'b.txt': 'b\n' }, stdout: out('D a.txt', 'ok: 1 file'), changes: { 'a.txt': null },
});
t('s8-delete-missing', {
  patch: wrap('*** Delete File: a.txt'),
  files: { 'b.txt': 'b\n' }, exit: 1, stdout: failOut(['error: missing a.txt'], 1, 1),
});
t('s8-add-double-cr-line', {
  patch: B + '\n*** Add File: n.txt\n+x\r\r\n' + E + '\n',
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'x\r\n' },
  note: 'only ONE trailing \\r is removed from a patch line, so the file line is "x\\r"',
});
t('s8-patch-crlf-add-creates-lf', {
  patch: [B, '*** Add File: n.txt', '+x', '+y', E].join('\r\n') + '\r\n',
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'x\ny\n' },
});
t('s8-patch-crlf-update-on-lf-file', {
  patch: [B, upd('a.txt'), ' one', '-two', '+TWO', ' three', E].join('\r\n') + '\r\n',
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});

// ---- Update: structure -----------------------------------------------------------------------------------------
t('s8-update-no-chunk-no-move', {
  patch: lines(B, upd('a.txt'), E),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 2'),
});
t('s8-update-no-chunk-before-next-section', {
  patch: lines(B, '*** Delete File: b.txt', upd('a.txt'), '*** Add File: n.txt', '+x', E),
  files: { 'a.txt': F3, 'b.txt': 'b\n' }, exit: 2, stdout: out('error: parse 3'),
});
t('s8-update-move-only', {
  patch: wrap(upd('a.txt'), '*** Move to: z/b.txt'),
  files: { 'a.txt': F3 }, stdout: out('R a.txt -> z/b.txt', 'ok: 1 file'), changes: { 'a.txt': null, 'z/b.txt': F3 },
});
t('s8-update-move-with-chunk', {
  patch: wrap(upd('a.txt'), '*** Move to: b.txt', '@@', ' one', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: out('R a.txt -> b.txt', 'ok: 1 file'), changes: { 'a.txt': null, 'b.txt': 'one\nTWO\nthree\n' },
});
t('s8-move-target-exists', {
  patch: wrap(upd('a.txt'), '*** Move to: b.txt'),
  files: { 'a.txt': F3, 'b.txt': 'b\n' }, exit: 1, stdout: failOut(['error: exists b.txt'], 1, 1),
});
t('s8-move-source-missing', {
  patch: wrap(upd('a.txt'), '*** Move to: b.txt'),
  files: { 'c.txt': 'c\n' }, exit: 1, stdout: failOut(['error: missing a.txt'], 1, 1),
});
t('s8-move-to-itself-exists', {
  patch: wrap(upd('a.txt'), '*** Move to: a.txt', '@@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: exists a.txt'], 1, 1),
  note: 'with Move to, the new path must not exist; a.txt exists. A literal reading, no special case for a move onto itself',
});
t('s8-move-to-after-chunk-is-parse', {
  patch: lines(B, upd('a.txt'), '@@', ' one', '*** Move to: b.txt', E),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 5'),
});
t('s8-move-to-twice-is-parse', {
  patch: lines(B, upd('a.txt'), '*** Move to: b.txt', '*** Move to: c.txt', E),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 4'),
});
t('s8-update-missing', {
  patch: wrap(upd('nofile.txt'), '@@', '-x', '+y'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: missing nofile.txt'], 1, 1),
});
t('s8-update-body-other-line-parse', {
  patch: lines(B, upd('a.txt'), '@@', ' one', 'garbage', E),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 5'),
});
t('s8-update-body-star-line-parse', {
  patch: lines(B, upd('a.txt'), '@@', ' one', '*** Frobnicate', E),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 5'),
});
t('s8-body-after-end-of-file-parse', {
  patch: lines(B, upd('a.txt'), '@@', ' three', '*** End of File', ' x', E),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 6'),
  note: 'a chunk starts at an @@ line or, for the first chunk only, at a body line; a body line after *** End of File starts no chunk. AMBIGUOUS',
});
t('s8-first-chunk-starts-at-body-line', {
  patch: wrap(upd('a.txt'), '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});
t('s8-first-chunk-body-then-at-at-chunk', {
  patch: wrap(upd('a.txt'), '-one', '+ONE', '@@', '-three', '+3'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'ONE\ntwo\n3\n' },
});

// ---- Update: anchors and cursor --------------------------------------------------------------------------------
t('s8-anchor-trimmed', {
  patch: wrap(upd('a.txt'), '@@    def g():   ', '-    x = 1', '+    x = 2'),
  files: { 'a.txt': FA }, stdout: OK1('a.txt'), changes: { 'a.txt': 'def f():\n    x = 1\ndef g():\n    x = 2\n' },
});
t('s8-anchor-no-space-after-at-at', {
  patch: wrap(upd('a.txt'), '@@def g():', '-    x = 1', '+    x = 2'),
  files: { 'a.txt': FA }, stdout: OK1('a.txt'), changes: { 'a.txt': 'def f():\n    x = 1\ndef g():\n    x = 2\n' },
  note: 'the text after @@ is the anchor, its surrounding spaces removed; no space is required after @@',
});
t('s8-empty-anchor-variants', {
  patch: wrap(upd('a.txt'), '@@   ', '-one', '+ONE', '@@', '-three', '+3'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'ONE\ntwo\n3\n' },
});
t('s8-anchor-tier2', {
  patch: wrap(upd('a.txt'), '@@ def f(self):', '-        return 1', '+        return 2'),
  files: { 'a.txt': 'class A:\n    def f(self):\n        return 1\n' }, stdout: OK1('a.txt'),
  changes: { 'a.txt': 'class A:\n    def f(self):\n        return 2\n' },
});
t('s8-anchor-first-tier-first', {
  patch: wrap(upd('a.txt'), '@@ k', '-x', '+Y'),
  files: { 'a.txt': '  k\nx\nk\nx\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': '  k\nx\nk\nY\n' },
  note: 'tier 0 finds "k" at line 2; the earlier tier-2 hit at line 0 is not used',
});
t('s8-anchor-strict-no-tier2', {
  patch: wrap(upd('a.txt'), '@@ def f(self):', '-        return 1', '+        return 2'),
  argv: ['--strict', 'p.patch'], files: { 'a.txt': 'class A:\n    def f(self):\n        return 1\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s8-anchor-not-found', {
  patch: wrap(upd('a.txt'), '@@ no such anchor', '-two', '+TWO'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s8-anchor-only-before-cursor', {
  patch: wrap(upd('a.txt'), '-three', '+3', '@@ one', '-x', '+y'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
  note: 'after chunk 1 the cursor is at line 3; "one" is at line 0, before it',
});
t('s8-anchor-moves-cursor-past-anchor-line', {
  patch: wrap(upd('a.txt'), '@@ f', ' f', ' a'),
  files: { 'a.txt': 'f\na\nf\nb\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
  note: 'anchor f matches line 0 and the cursor moves past it; O = [f, a] occurs only at line 0 (before the cursor)',
});
t('s8-anchor-repeated-advances', {
  patch: wrap(upd('a.txt'), '@@ k', '-x', '+X', '@@ k', '-x', '+Y'),
  files: { 'a.txt': 'k\nx\nk\nx\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'k\nX\nk\nY\n' },
});
t('s8-cursor-after-written-lines', {
  patch: wrap(upd('a.txt'), '-a', '+A', '@@', '-k', '+K'),
  files: { 'a.txt': 'k\na\nk\na\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'k\nA\nK\na\n' },
  note: 'chunk 1 matches line 1; the cursor is 2, so chunk 2 takes the "k" at line 2, not line 0',
});
t('s8-cursor-no-backtrack', {
  patch: wrap(upd('a.txt'), '-c', '+C', '@@', '-a', '+A'),
  files: { 'a.txt': 'a\nb\nc\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s8-first-occurrence-at-or-after-cursor', {
  patch: wrap(upd('a.txt'), '-x', '+Y'),
  files: { 'a.txt': 'x\nx\nx\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'Y\nx\nx\n' },
  note: 'ambiguity is not an error in V4A: the first occurrence is taken',
});
t('s8-cursor-moves-past-inserted-lines', {
  patch: wrap(upd('a.txt'), '-a', '+a', '+a', '@@', '-a', '+Z'),
  files: { 'a.txt': 'a\nb\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
  note: 'chunk 1 writes [a, a] at lines 0-1, cursor 2; "a" occurs only at lines 0 and 1: no-match',
});
t('s8-tier0-after-cursor-beats-earlier-tier1', {
  patch: wrap(upd('a.txt'), '-x', '+Y'),
  files: { 'a.txt': 'x  \nm\nx\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'x  \nm\nY\n' },
});
t('s8-tier1-context-is-files-text', {
  patch: wrap(upd('a.txt'), ' a', '-b', '+B'),
  files: { 'a.txt': 'a  \nb\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a  \nB\n' },
});
t('s8-tier2-reindent-and-file-context', {
  patch: wrap(upd('a.txt'), ' a', '-b', '+B', '+  deeper'),
  files: { 'a.txt': '    a\n    b\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': '    a\n    B\n      deeper\n' },
  note: 'P empty, F four spaces: both new lines are indented by F; context line "a" is the file\'s text',
});
t('s8-tier2-p-and-f', {
  patch: wrap(upd('a.txt'), '-  x', '+  X', '+      Y', '+ z'),
  files: { 'a.txt': '\t\tx\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': '\t\tX\n\t\t    Y\n z\n' },
  note: 'P = two spaces, F = two tabs; " z" (one space) does not start with P: as is',
});
t('s8-strict-no-tier2', {
  patch: wrap(upd('a.txt'), '-x', '+Y'),
  argv: ['--strict', 'p.patch'], files: { 'a.txt': '  x\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s8-empty-context-line-in-chunk', {
  patch: wrap(upd('a.txt'), '@@', ' a', '', '-b', '+B'),
  files: { 'a.txt': 'a\n\nb\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\n\nB\n' },
});
t('s8-blank-before-next-at-at-is-context', {
  patch: lines(B, upd('a.txt'), '@@', ' a', '-b', '+B', '', '@@', ' c', E),
  files: { 'a.txt': 'a\nb\nc\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
  note: 'AMBIGUOUS: only blank lines at the end of a SECTION are dropped; this one is inside the section, so it is an empty context line of chunk 1 (O = a, b, "") and does not match',
});

// ---- Update: empty O and End of File ---------------------------------------------------------------------------
t('s8-empty-o-first-chunk-inserts-at-top', {
  patch: wrap(upd('a.txt'), '+top'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'top\none\ntwo\nthree\n' },
});
t('s8-empty-o-after-anchor', {
  patch: wrap(upd('a.txt'), '@@ def g():', '+    # note'),
  files: { 'a.txt': FA }, stdout: OK1('a.txt'), changes: { 'a.txt': 'def f():\n    x = 1\ndef g():\n    # note\n    x = 1\n' },
});
t('s8-empty-o-at-cursor-after-previous-chunk', {
  patch: wrap(upd('a.txt'), '-a', '+A1', '+A2', '@@', '+ins'),
  files: { 'a.txt': 'a\nb\nc\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'A1\nA2\nins\nb\nc\n' },
});
t('s8-eof-chunk-takes-last-occurrence', {
  patch: wrap(upd('a.txt'), '-y', '+Z', '*** End of File'),
  files: { 'a.txt': 'x\ny\nx\ny\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'x\ny\nx\nZ\n' },
});
t('s8-eof-chunk-multi-line-o', {
  patch: wrap(upd('a.txt'), ' x', '-y', '+Z', '*** End of File'),
  files: { 'a.txt': 'x\ny\nx\ny\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'x\ny\nx\nZ\n' },
});
t('s8-eof-chunk-must-end-at-last-line', {
  patch: wrap(upd('a.txt'), '-y', '+Q', '*** End of File'),
  files: { 'a.txt': 'y\nm\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s8-eof-chunk-empty-o-appends', {
  patch: wrap(upd('a.txt'), '+four', '*** End of File'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\ntwo\nthree\nfour\n' },
});
t('s8-eof-chunk-with-anchor', {
  patch: wrap(upd('a.txt'), '@@ k', '-x', '+Y', '*** End of File'),
  files: { 'a.txt': 'k\nx\nk\nx\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'k\nx\nk\nY\n' },
  note: 'anchor k at line 0, cursor 1; an end-of-file chunk takes only an occurrence ending at the last line (line 3)',
});
t('s8-eof-marker-then-new-chunk', {
  patch: wrap(upd('a.txt'), '-one', '+ONE', '*** End of File', '@@', '-three', '+3'),
  files: { 'a.txt': 'one\ntwo\nthree\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
  note: 'chunk 1 is anchored to the end of the file: "one" is not at the last line, so no-match (chunk 2 never matters)',
});

// ---- Update: line breaks ---------------------------------------------------------------------------------------
t('s8-final-break-stays-absent', {
  patch: wrap(upd('a.txt'), '-b', '+B'),
  files: { 'a.txt': 'a\nb' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nB' },
  note: 'V4A has no no-newline marker: a changed file keeps whether it ended with a line break',
});
t('s8-eof-append-keeps-absent-final-break', {
  patch: wrap(upd('a.txt'), '+z', '*** End of File'),
  files: { 'a.txt': 'a\nb' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nb\nz' },
});
t('s8-empty-file-insert-no-final-break', {
  patch: wrap(upd('e.txt'), '+x'),
  files: { 'e.txt': '' }, stdout: OK1('e.txt'), changes: { 'e.txt': 'x' },
  note: 'AMBIGUOUS-ish literal reading: an empty file does not end with a line break, so the written file has none',
});
t('s8-delete-all-lines-written-empty', {
  patch: wrap(upd('a.txt'), '-x'),
  files: { 'a.txt': 'x\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': '' },
});
t('s8-crlf-file', {
  patch: wrap(upd('a.txt'), ' one', '-two', '+TWO', '+TWO2', ' three'),
  files: { 'a.txt': 'one\r\ntwo\r\nthree\r\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\r\nTWO\r\nTWO2\r\nthree\r\n' },
});
t('s8-crlf-file-no-final-break', {
  patch: wrap(upd('a.txt'), '-two', '+TWO'),
  files: { 'a.txt': 'one\r\ntwo' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\r\nTWO' },
});
t('s8-add-then-update-sees-lf', {
  patch: wrap('*** Add File: n.txt', '+x', '+y', upd('n.txt'), '-y', '+Y'),
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'x\nY\n' },
});

// ---- unsafe paths ----------------------------------------------------------------------------------------------
for (const [fam, sec, path] of [
  ['s3-v4a-unsafe-add-dotdot', (p) => ['*** Add File: ' + p, '+x'], '../x.txt'],
  ['s3-v4a-unsafe-update-absolute', (p) => [upd(p), '@@', '-one', '+ONE'], '/abs.txt'],
  ['s3-v4a-unsafe-delete-empty-segment', (p) => ['*** Delete File: ' + p], 'd//x.txt'],
  ['s3-v4a-unsafe-add-dot-segment', (p) => ['*** Add File: ' + p, '+x'], './x.txt'],
  ['s3-v4a-unsafe-add-backslash', (p) => ['*** Add File: ' + p, '+x'], 'd\\x.txt'],
  ['s3-v4a-unsafe-delete-trailing-slash', (p) => ['*** Delete File: ' + p], 'dir/'],
  ['s3-v4a-unsafe-update-dotdot-middle', (p) => [upd(p), '@@', '-one', '+ONE'], 'd/../a.txt'],
]) {
  t(fam, { patch: wrap(...sec(path)), files: { 'a.txt': F3 }, exit: 1, stdout: failOut([`error: unsafe ${path}`], 1, 1) });
}
t('s3-v4a-unsafe-move-target', {
  patch: wrap(upd('a.txt'), '*** Move to: ../z.txt'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: unsafe ../z.txt'], 1, 1),
});
t('s3-v4a-unsafe-wins-over-missing', {
  patch: wrap('*** Delete File: ../nofile.txt'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: unsafe ../nofile.txt'], 1, 1),
});
t('s3-v4a-no-a-b-prefix-stripping', {
  patch: wrap(upd('a/x.txt'), '-one', '+ONE'),
  files: { 'a/x.txt': 'one\n', 'x.txt': 'one\n' }, stdout: OK1('a/x.txt'), changes: { 'a/x.txt': 'ONE\n' },
});
t('s3-v4a-empty-path-unsafe', {
  patch: lines(B, '*** Add File: ', '+x', E),
  files: {}, exit: 1, stdout: 'error: unsafe \nfailed: 1 of 1 edits\n',
  note: 'the path is empty: unsafe, the line is "error: unsafe " with a trailing space',
});

// ---- order, atomicity --------------------------------------------------------------------------------------------
t('s10-v4a-failures-in-order-and-count', {
  patch: wrap('*** Delete File: nofile.txt', '*** Add File: a.txt', '+x', upd('a.txt'), '@@', '-absent', '+x', '*** Add File: ok.txt', '+fine'),
  files: { 'a.txt': F3 }, exit: 1,
  stdout: failOut(['error: missing nofile.txt', 'error: exists a.txt', 'error: no-match a.txt'], 3, 4),
});
t('s10-v4a-failed-chunk-changes-nothing', {
  patch: wrap(upd('a.txt'), '-one', '+ONE', '@@', '-absent', '+x'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s10-v4a-later-edit-sees-earlier-failed-edit-unchanged', {
  patch: wrap(upd('a.txt'), '@@', '-absent', '+Q', upd('a.txt'), '@@', '-Q', '+R'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: no-match a.txt', 'error: no-match a.txt'], 2, 2),
});


// ---- more V4A ------------------------------------------------------------------------------------------------
t('s8-update-trailing-blank-lines-dropped', {
  patch: lines(B, upd('a.txt'), '@@', ' one', '-two', '+TWO', '', '', E),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
  note: 'blank lines at the end of a section are not part of it; kept, they would be empty context lines (O = one, two, "") matching nothing',
});
t('s8-update-trailing-blank-lines-before-next-section-dropped', {
  patch: lines(B, upd('a.txt'), '@@', ' one', '-two', '+TWO', '', '*** Add File: n.txt', '+x', E),
  files: { 'a.txt': F3 }, stdout: out('M a.txt', 'A n.txt', 'ok: 2 files'), changes: { 'a.txt': 'one\nTWO\nthree\n', 'n.txt': 'x\n' },
});
t('s8-add-content-line-that-looks-like-end-patch', {
  patch: lines(B, '*** Add File: n.txt', '+*** End Patch', '+*** Add File: x', E),
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': '*** End Patch\n*** Add File: x\n' },
});
t('s8-empty-chunk-with-existing-anchor-is-noop', {
  patch: wrap(upd('a.txt'), '@@ two'),
  files: { 'a.txt': F3 }, stdout: out('ok: 0 files'),
});
t('s8-empty-chunk-with-missing-anchor-no-match', {
  patch: wrap(upd('a.txt'), '@@ nothere'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s8-add-then-add-same-path-second-exists', {
  patch: wrap('*** Add File: n.txt', '+x', '*** Add File: n.txt', '+y'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: exists n.txt'], 1, 2),
});

write();
