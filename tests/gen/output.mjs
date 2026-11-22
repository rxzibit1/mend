import { lines, out, failOut, block, suite } from '../lib.mjs';

const { t, write } = suite('output', 'cli');
const F3 = 'one\ntwo\nthree\n';
const B = '*** Begin Patch';
const E = '*** End Patch';
const wrap = (...body) => lines(B, ...body, E);
const upd = (p) => `*** Update File: ${p}`;
const J = JSON.stringify;
const jl = (...objs) => lines(...objs.map((o) => J(o)));
const cr = (path, file_text) => ({ command: 'create', path, file_text });
const sr = (path, old_str, new_str) => ({ command: 'str_replace', path, old_str, new_str });

// ---- counts and singular/plural -----------------------------------------------------------------------------------
t('s2-ok-zero-files', {
  patch: jl(sr('a.txt', 'one', 'one')), files: { 'a.txt': F3 }, stdout: out('ok: 0 files'),
});
t('s2-ok-two-files-plural', {
  patch: jl(cr('n.txt', 'x'), cr('m.txt', 'y')), files: {}, stdout: out('A m.txt', 'A n.txt', 'ok: 2 files'), changes: { 'n.txt': 'x', 'm.txt': 'y' },
});
{
  const names = Array.from({ length: 11 }, (_, i) => `f${i}.txt`);
  const sorted = ['f0.txt', 'f1.txt', 'f10.txt', 'f2.txt', 'f3.txt', 'f4.txt', 'f5.txt', 'f6.txt', 'f7.txt', 'f8.txt', 'f9.txt'];
  t('s2-ok-eleven-files-byte-order-not-numeric', {
    patch: jl(...names.map((n) => cr(n, n))), files: {},
    stdout: out(...sorted.map((n) => `A ${n}`), 'ok: 11 files'), changes: Object.fromEntries(names.map((n) => [n, n])),
    note: '"f1.txt" < "f10.txt" < "f2.txt" in byte order ("." is 0x2E, below "0")',
  });
}

// ---- ordering --------------------------------------------------------------------------------------------------
{
  const paths = ['b.txt', 'Z.txt', 'a/z.txt', 'a.txt', '_x', '~z', 'a-b', 'a0'];
  const sorted = ['Z.txt', '_x', 'a-b', 'a.txt', 'a/z.txt', 'a0', 'b.txt', '~z'];
  t('s2-sort-ascii-byte-order', {
    patch: jl(...paths.map((p) => cr(p, 'x'))), files: {},
    stdout: out(...sorted.map((p) => `A ${p}`), 'ok: 8 files'), changes: Object.fromEntries(paths.map((p) => [p, 'x'])),
    note: 'bytes: Z(5A) < _(5F) < a-b(2D) < a.txt(2E) < a/z.txt(2F) < a0(30) < b < ~(7E)',
  });
}
{
  const paths = ['😀.txt', '～.txt', 'é.txt', 'z.txt'];
  const sorted = ['z.txt', 'é.txt', '～.txt', '😀.txt'];
  t('s2-sort-utf8-bytes-not-utf16-units', {
    patch: jl(...paths.map((p) => cr(p, 'x'))), files: {},
    stdout: out(...sorted.map((p) => `A ${p}`), 'ok: 4 files'), changes: Object.fromEntries(paths.map((p) => [p, 'x'])),
    note: 'UTF-8: z (7A) < é (C3 A9) < U+FF5E (EF BD 9E) < U+1F600 (F0 9F 98 80). UTF-16 code units would put the emoji (D83D) before U+FF5E (FF5E).',
  });
}
t('s2-sort-states-interleaved-r-by-new-path', {
  patch: wrap(upd('a.txt'), '@@', '-one', '+ONE', '*** Delete File: c.txt', '*** Add File: e.txt', '+e', upd('d.txt'), '*** Move to: b.txt'),
  files: { 'a.txt': F3, 'c.txt': 'c\n', 'd.txt': 'd\n' },
  stdout: out('M a.txt', 'R d.txt -> b.txt', 'D c.txt', 'A e.txt', 'ok: 4 files'),
  changes: { 'a.txt': 'ONE\ntwo\nthree\n', 'c.txt': null, 'e.txt': 'e\n', 'd.txt': null, 'b.txt': 'd\n' },
  note: 'one line per changed path, sorted by path (an R line by its new path): a, b, c, e',
});

// ---- what is listed ----------------------------------------------------------------------------------------------
t('s2-unchanged-files-not-listed', {
  patch: jl(sr('a.txt', 'one', 'ONE'), sr('b.txt', 'x', 'x')), files: { 'a.txt': F3, 'b.txt': 'x\n' },
  stdout: out('M a.txt', 'ok: 1 file'), changes: { 'a.txt': 'ONE\ntwo\nthree\n' },
});
t('s2-edit-then-revert-not-listed', {
  patch: jl(sr('a.txt', 'two', 'TWO'), sr('a.txt', 'TWO', 'two')), files: { 'a.txt': F3 }, stdout: out('ok: 0 files'),
});
t('s2-create-then-delete-not-listed', {
  patch: wrap('*** Add File: n.txt', '+x', '*** Delete File: n.txt'), files: { 'a.txt': F3 }, stdout: out('ok: 0 files'),
});
t('s2-delete-then-recreate-different-is-m', {
  patch: wrap('*** Delete File: a.txt', '*** Add File: a.txt', '+new'), files: { 'a.txt': F3 }, stdout: out('M a.txt', 'ok: 1 file'), changes: { 'a.txt': 'new\n' },
});
t('s2-delete-then-recreate-same-bytes-not-listed', {
  patch: wrap('*** Delete File: a.txt', '*** Add File: a.txt', '+one', '+two', '+three'), files: { 'a.txt': F3 }, stdout: out('ok: 0 files'),
});
t('s2-crlf-to-lf-bytes-differ-is-m', {
  patch: wrap('*** Delete File: a.txt', '*** Add File: a.txt', '+one', '+two'), files: { 'a.txt': 'one\r\ntwo\r\n' },
  stdout: out('M a.txt', 'ok: 1 file'), changes: { 'a.txt': 'one\ntwo\n' },
  note: 'same text, different bytes (CRLF vs LF): M',
});
t('s2-changed-to-empty-is-m', {
  patch: jl(sr('a.txt', 'x\n', '')), files: { 'a.txt': 'x\n' }, stdout: out('M a.txt', 'ok: 1 file'), changes: { 'a.txt': '' },
});

// ---- R lines ---------------------------------------------------------------------------------------------------
t('s2-r-counts-as-one-file', {
  patch: wrap(upd('a.txt'), '*** Move to: b.txt'), files: { 'a.txt': F3 }, stdout: out('R a.txt -> b.txt', 'ok: 1 file'), changes: { 'a.txt': null, 'b.txt': F3 },
});
t('s2-r-move-then-update-new-path', {
  patch: wrap(upd('a.txt'), '*** Move to: b.txt', upd('b.txt'), '@@', '-two', '+TWO'), files: { 'a.txt': F3 },
  stdout: out('R a.txt -> b.txt', 'ok: 1 file'), changes: { 'a.txt': null, 'b.txt': 'one\nTWO\nthree\n' },
});
t('s2-r-move-then-recreate-old-degrades', {
  patch: wrap(upd('a.txt'), '*** Move to: b.txt', '*** Add File: a.txt', '+fresh'), files: { 'a.txt': F3 },
  stdout: out('M a.txt', 'A b.txt', 'ok: 2 files'), changes: { 'a.txt': 'fresh\n', 'b.txt': F3 },
  note: '<old> exists after the patch, so the pair is not an R: a.txt is M (other bytes) and b.txt is A',
});
t('s2-r-move-then-recreate-old-same-bytes', {
  patch: wrap(upd('a.txt'), '*** Move to: b.txt', '*** Add File: a.txt', '+one', '+two', '+three'), files: { 'a.txt': F3 },
  stdout: out('A b.txt', 'ok: 1 file'), changes: { 'b.txt': F3 },
  note: 'a.txt ends with its old bytes (not listed); b.txt did not exist before: A',
});
t('s2-r-move-then-delete-new', {
  patch: wrap(upd('a.txt'), '*** Move to: b.txt', '*** Delete File: b.txt'), files: { 'a.txt': F3 },
  stdout: out('D a.txt', 'ok: 1 file'), changes: { 'a.txt': null },
  note: 'b.txt does not exist after the patch: no R; a.txt is D; b.txt (absent before and after) is not listed',
});
t('s2-r-chain-of-moves-degrades', {
  patch: wrap(upd('a.txt'), '*** Move to: b.txt', upd('b.txt'), '*** Move to: c.txt'), files: { 'a.txt': F3 },
  stdout: out('D a.txt', 'A c.txt', 'ok: 2 files'), changes: { 'a.txt': null, 'c.txt': F3 },
  note: 'AMBIGUOUS: for pair (a,b) b is gone after the patch; for pair (b,c) b did not exist before. Neither pair meets the R conditions, so D a.txt and A c.txt',
});
t('s2-r-new-path-existed-before-degrades', {
  patch: wrap('*** Delete File: b.txt', upd('a.txt'), '*** Move to: b.txt'), files: { 'a.txt': F3, 'b.txt': 'old b\n' },
  stdout: out('D a.txt', 'M b.txt', 'ok: 2 files'), changes: { 'a.txt': null, 'b.txt': F3 },
  note: '<new> existed before the patch (deleted by an earlier edit, then written by the move): no R; a.txt is D and b.txt is M',
});
t('s2-r-created-then-moved-is-just-a', {
  patch: wrap('*** Add File: n.txt', '+x', upd('n.txt'), '*** Move to: m.txt'), files: { 'a.txt': F3 },
  stdout: out('A m.txt', 'ok: 1 file'), changes: { 'm.txt': 'x\n' },
  note: 'n.txt did not exist before the patch, so no R; it does not exist after either: not listed',
});
t('s2-r-unified-rename-lines', {
  patch: lines('diff --git a/a.txt b/dir/b.txt', 'similarity index 100%', 'rename from a.txt', 'rename to dir/b.txt'),
  files: { 'a.txt': F3, 'z.txt': 'z\n' }, stdout: out('R a.txt -> dir/b.txt', 'ok: 1 file'), changes: { 'a.txt': null, 'dir/b.txt': F3 },
});
t('s2-r-moves-sorted-by-new-path', {
  patch: wrap(upd('a.txt'), '*** Move to: z2.txt', upd('b.txt'), '*** Move to: a2.txt'), files: { 'a.txt': 'a\n', 'b.txt': 'b\n' },
  stdout: out('R b.txt -> a2.txt', 'R a.txt -> z2.txt', 'ok: 2 files'), changes: { 'a.txt': null, 'b.txt': null, 'z2.txt': 'a\n', 'a2.txt': 'b\n' },
});
t('s2-r-swap-two-files-is-not-r', {
  patch: wrap(upd('a.txt'), '*** Move to: tmp.txt', upd('b.txt'), '*** Move to: a.txt', upd('tmp.txt'), '*** Move to: b.txt'),
  files: { 'a.txt': 'A\n', 'b.txt': 'B\n' }, stdout: out('M a.txt', 'M b.txt', 'ok: 2 files'), changes: { 'a.txt': 'B\n', 'b.txt': 'A\n' },
  note: 'a and b exist before and after with other bytes: M lines; tmp.txt exists neither before nor after',
});

// ---- failures --------------------------------------------------------------------------------------------------
t('s2-all-five-codes-in-patch-order', {
  patch: jl(sr('a.txt', 'zzz', 'y'), sr('b.txt', 'x', 'y'), sr('nofile.txt', 'x', 'y'), cr('a.txt', 'q'), cr('../q.txt', 'q')),
  files: { 'a.txt': F3, 'b.txt': 'x\nx\n' }, exit: 1,
  stdout: failOut(['error: no-match a.txt', 'error: ambiguous b.txt', 'error: missing nofile.txt', 'error: exists a.txt', 'error: unsafe ../q.txt'], 5, 5),
});
t('s2-failed-count-uses-edits-not-lines', {
  patch: jl(sr('a.txt', 'one', 'ONE'), sr('a.txt', 'two', 'TWO'), sr('a.txt', 'nothere', 'x'), sr('a.txt', 'three', '3')), files: { 'a.txt': F3 }, exit: 1,
  stdout: failOut(['error: no-match a.txt'], 1, 4),
});
t('s2-failure-hides-all-successes', {
  patch: wrap(upd('a.txt'), '@@', '-one', '+ONE', '*** Add File: n.txt', '+x', '*** Delete File: b.txt', '*** Delete File: nofile.txt'),
  files: { 'a.txt': F3, 'b.txt': 'b\n' }, exit: 1, stdout: failOut(['error: missing nofile.txt'], 1, 4),
});
t('s2-error-line-after-failed-move-keeps-later-edits-seeing-original', {
  patch: wrap(upd('a.txt'), '*** Move to: b.txt', upd('a.txt'), '@@', '-two', '+TWO'), files: { 'a.txt': F3, 'b.txt': 'x\n' }, exit: 1,
  stdout: failOut(['error: exists b.txt'], 1, 2),
  note: 'the failed move changes nothing, so the second edit still finds a.txt (and succeeds); only the move is reported',
});

write();
