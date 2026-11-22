import { lines, out, failOut, suite } from '../lib.mjs';

const { t, write } = suite('unified', 'unified');
const F3 = 'one\ntwo\nthree\n';
const OK1 = (p) => out(`M ${p}`, 'ok: 1 file');
const hdr = (p) => ['--- a/' + p, '+++ b/' + p];

// ---- section starts --------------------------------------------------------------------------------------------
t('s6-start-diff-git', {
  patch: lines('diff --git a/a.txt b/a.txt', 'index 111..222 100644', '--- a/a.txt', '+++ b/a.txt', '@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});
t('s6-start-bare-pair-with-prose', {
  patch: lines("Here's the fix:", '', '--- a.txt', '+++ a.txt', '@@ -2 +2 @@', '-two', '+TWO', '', 'Hope that helps.'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});
t('s6-second-section-no-git-line', {
  patch: lines(...hdr('b.txt'), '@@ -1 +1 @@', '-b1', '+B1', ...hdr('c.txt'), '@@ -1 +1 @@', '-c1', '+C1'),
  files: { 'b.txt': 'b1\nb2\n', 'c.txt': 'c1\nc2\n' }, stdout: out('M b.txt', 'M c.txt', 'ok: 2 files'),
  changes: { 'b.txt': 'B1\nb2\n', 'c.txt': 'C1\nc2\n' },
  note: 'a --- / +++ pair after a section\'s hunks ends the body and starts a new section',
});
t('s6-prose-between-sections', {
  patch: lines(...hdr('b.txt'), '@@ -1 +1 @@', '-b1', '+B1', 'Now the second file:', 'diff --git a/c.txt b/c.txt', ...hdr('c.txt'), '@@ -1 +1 @@', '-c1', '+C1', '```'),
  files: { 'b.txt': 'b1\n', 'c.txt': 'c1\n' }, stdout: out('M b.txt', 'M c.txt', 'ok: 2 files'), changes: { 'b.txt': 'B1\n', 'c.txt': 'C1\n' },
});
t('s6-header-prose-line-ignored', {
  patch: lines(...hdr('a.txt'), 'some stray note in the header', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});
t('s6-git-header-misc-lines-ignored', {
  patch: lines('diff --git a/a.txt b/a.txt', 'old mode 100644', 'new mode 100755', 'index 1111111..2222222', 'dissimilarity index 5%', '--- a/a.txt', '+++ b/a.txt', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});
t('s6-mode-only-no-hunks', {
  patch: lines('diff --git a/a.txt b/a.txt', 'old mode 100644', 'new mode 100755'),
  files: { 'a.txt': F3 }, stdout: out('ok: 0 files'),
  note: 'a section with no hunks is still one edit (a change of one path, which exists) that changes nothing',
});
t('s6-no-hunks-missing-file', {
  patch: lines('diff --git a/nofile.txt b/nofile.txt', 'old mode 100644', 'new mode 100755'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: missing nofile.txt'], 1, 1),
});

// ---- paths -----------------------------------------------------------------------------------------------------
t('s6-path-up-to-tab', {
  patch: lines('--- a/a.txt\t2024-01-01 00:00:00.000000000 +0000', '+++ b/a.txt\t2024-01-02 00:00:00.000000000 +0000', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});
t('s6-path-surrounding-spaces', {
  patch: lines('---   a/a.txt   ', '+++  b/a.txt  ', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});
t('s6-path-inner-space-kept', {
  patch: lines('--- a/my file.txt', '+++ b/my file.txt', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'my file.txt': F3 }, stdout: OK1('my file.txt'), changes: { 'my file.txt': 'one\nTWO\nthree\n' },
});
t('s6-prefix-b-on-old-side', {
  patch: lines('--- b/a.txt', '+++ a/a.txt', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
  note: 'a leading a/ or b/ is removed from either side, so both name a.txt',
});
t('s6-prefix-stripped-once', {
  patch: lines('--- a/a/x.txt', '+++ b/a/x.txt', '@@ -1 +1 @@', '-one', '+ONE'),
  files: { 'a/x.txt': 'one\n' }, stdout: OK1('a/x.txt'), changes: { 'a/x.txt': 'ONE\n' },
});
t('s6-prefix-only-exact-a-slash', {
  patch: lines('--- ab/x.txt', '+++ ab/x.txt', '@@ -1 +1 @@', '-one', '+ONE'),
  files: { 'ab/x.txt': 'one\n' }, stdout: OK1('ab/x.txt'), changes: { 'ab/x.txt': 'ONE\n' },
});
t('s6-no-prefix-paths-equal', {
  patch: lines('--- a.txt', '+++ b/a.txt', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
  note: 'old path "a.txt", new path "a.txt" after the b/ strip: not a move',
});
t('s6-pair-beats-git-paths', {
  patch: lines('diff --git a/zzz.txt b/yyy.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});
t('s6-git-paths-fallback', {
  patch: lines('diff --git a/a.txt b/a.txt', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});
t('s6-git-paths-fallback-differ-is-move', {
  patch: lines('diff --git a/a.txt b/z.txt', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: out('R a.txt -> z.txt', 'ok: 1 file'), changes: { 'a.txt': null, 'z.txt': 'one\nTWO\nthree\n' },
  note: 'diff --git paths are used when nothing else names one; X != Y then makes it a move (old and new path differ)',
});

// ---- rename / modes --------------------------------------------------------------------------------------------
t('s6-rename-lines-only', {
  patch: lines('diff --git a/old.txt b/new.txt', 'similarity index 100%', 'rename from old.txt', 'rename to new.txt'),
  files: { 'old.txt': F3 }, stdout: out('R old.txt -> new.txt', 'ok: 1 file'), changes: { 'old.txt': null, 'new.txt': F3 },
});
t('s6-rename-lines-with-hunks', {
  patch: lines('diff --git a/x/old.txt b/y/new.txt', 'similarity index 66%', 'rename from x/old.txt', 'rename to y/new.txt', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'x/old.txt': F3 }, stdout: out('R x/old.txt -> y/new.txt', 'ok: 1 file'), changes: { 'x/old.txt': null, 'y/new.txt': 'one\nTWO\nthree\n' },
});
t('s6-rename-pair-beats-rename-lines', {
  patch: lines('diff --git a/p.txt b/q.txt', 'rename from r1.txt', 'rename to r2.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
  note: 'rename from/to only name the paths when no ---/+++ pair does',
});
t('s6-rename-target-exists', {
  patch: lines('diff --git a/old.txt b/new.txt', 'rename from old.txt', 'rename to new.txt'),
  files: { 'old.txt': F3, 'new.txt': 'other\n' }, exit: 1, stdout: failOut(['error: exists new.txt'], 1, 1),
});
t('s6-rename-source-missing', {
  patch: lines('diff --git a/old.txt b/new.txt', 'rename from old.txt', 'rename to new.txt'),
  files: { 'x.txt': F3 }, exit: 1, stdout: failOut(['error: missing old.txt'], 1, 1),
});
t('s6-move-by-pair-with-hunks', {
  patch: lines('--- a/old.txt', '+++ b/new.txt', '@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three'),
  files: { 'old.txt': F3 }, stdout: out('R old.txt -> new.txt', 'ok: 1 file'), changes: { 'old.txt': null, 'new.txt': 'one\nTWO\nthree\n' },
});
t('s6-move-pair-no-hunks', {
  patch: lines('--- a/old.txt', '+++ b/sub/dir/new.txt'),
  files: { 'old.txt': F3 }, stdout: out('R old.txt -> sub/dir/new.txt', 'ok: 1 file'), changes: { 'old.txt': null, 'sub/dir/new.txt': F3 },
});
t('s6-move-hunk-nomatch-reports-old', {
  patch: lines('--- a/old.txt', '+++ b/new.txt', '@@ -1 +1 @@', '-absent', '+x'),
  files: { 'old.txt': F3 }, exit: 1, stdout: failOut(['error: no-match old.txt'], 1, 1),
  note: 'the path on an error line is the file in which the lines were not found: the old file',
});
t('s6-move-sort-by-new-path', {
  patch: lines('--- a/old.txt', '+++ b/zz.txt', '@@ -1 +1 @@', '-one', '+ONE', '--- /dev/null', '+++ b/mm.txt', '@@ -0,0 +1 @@', '+m', '--- a/gone.txt', '+++ /dev/null'),
  files: { 'old.txt': F3, 'gone.txt': 'g\n' }, stdout: out('D gone.txt', 'A mm.txt', 'R old.txt -> zz.txt', 'ok: 3 files'),
  changes: { 'old.txt': null, 'zz.txt': 'ONE\ntwo\nthree\n', 'mm.txt': 'm\n', 'gone.txt': null },
});

// ---- creation and deletion -------------------------------------------------------------------------------------
t('s6-create-plus-lines-only', {
  patch: lines('--- /dev/null', '+++ b/n.txt', '@@ -0,0 +1,2 @@', '+l1', ' ctx', '-gone', '+l2', '@@ -0,0 +3 @@', '+l3'),
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'l1\nl2\nl3\n' },
  note: 'a creation is the + lines of all its hunks in order; context and - lines are not part of it',
});
t('s6-create-dev-null-with-tab', {
  patch: lines('--- /dev/null\t1970-01-01 00:00:00', '+++ b/deep/er/n.txt\t2024-01-01', '@@ -0,0 +1 @@', '+x'),
  files: {}, stdout: out('A deep/er/n.txt', 'ok: 1 file'), changes: { 'deep/er/n.txt': 'x\n' },
});
t('s6-create-exists', {
  patch: lines('--- /dev/null', '+++ b/a.txt', '@@ -0,0 +1 @@', '+x'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: exists a.txt'], 1, 1),
});
t('s6-create-new-file-mode-no-pair', {
  patch: lines('diff --git a/n.txt b/n.txt', 'new file mode 100644', '@@ -0,0 +1,2 @@', '+hello', '+world'),
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'hello\nworld\n' },
});
t('s6-new-file-mode-with-existing-path', {
  patch: lines('diff --git a/a.txt b/a.txt', 'new file mode 100644', '--- a/a.txt', '+++ b/a.txt', '@@ -0,0 +1 @@', '+x'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: exists a.txt'], 1, 1),
  note: 'new file mode makes the section a creation even though the pair does not use /dev/null',
});
t('s6-create-without-plus-lines-is-empty-file', {
  patch: lines('diff --git a/e.txt b/e.txt', 'new file mode 100644'),
  files: {}, stdout: out('A e.txt', 'ok: 1 file'), changes: { 'e.txt': '' },
  note: 'a created file of no lines is written empty (section 3)',
});
t('s6-delete-deleted-file-mode', {
  patch: lines('diff --git a/a.txt b/a.txt', 'deleted file mode 100644', 'index 1..0', '@@ -1,3 +0,0 @@', '-one', '-two', '-three'),
  files: { 'a.txt': F3 }, stdout: out('D a.txt', 'ok: 1 file'), changes: { 'a.txt': null },
});
t('s6-delete-ignores-hunks', {
  patch: lines('--- a/a.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-this line is not in the file'),
  files: { 'a.txt': F3 }, stdout: out('D a.txt', 'ok: 1 file'), changes: { 'a.txt': null },
});
t('s6-delete-missing', {
  patch: lines('--- a/a.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-one'),
  files: { 'b.txt': F3 }, exit: 1, stdout: failOut(['error: missing a.txt'], 1, 1),
});
t('s6-change-missing', {
  patch: lines(...hdr('nofile.txt'), '@@ -1 +1 @@', '-one', '+ONE'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: missing nofile.txt'], 1, 1),
});

// ---- parse errors ----------------------------------------------------------------------------------------------
t('s6-parse-git-malformed-first', {
  patch: lines('diff --git foo bar', ...hdr('a.txt'), '@@ -1 +1 @@', '-one', '+ONE'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 1'),
});
t('s6-parse-git-malformed-no-b', {
  patch: lines('some intro', '', 'diff --git a/x c/x'),
  files: { 'x': F3 }, exit: 2, stdout: out('error: parse 3'),
});
t('s6-parse-git-malformed-after-valid-section', {
  patch: lines(...hdr('a.txt'), '@@ -2 +2 @@', '-two', '+TWO', 'diff --git a/a.txt', '@@ -1 +1 @@', '-one', '+ONE'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 6'),
  note: 'a diff --git line missing the b/ half is a parse error reported before any file is looked at',
});
t('s6-parse-lone-minus-in-header', {
  patch: lines('diff --git a/a.txt b/a.txt', '--- a/a.txt', 'index 1..2', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 3'),
});
t('s6-parse-lone-minus-last-line', {
  patch: lines('diff --git a/a.txt b/a.txt', '--- a/a.txt'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 3'),
  note: 'there is no line after the --- line; the number of patch lines plus 1 is the natural reading',
});
t('s6-lone-minus-outside-section-is-prose', {
  patch: lines('Intro', '--- some prose', 'more prose', 'diff --git a/a.txt b/a.txt', ...hdr('a.txt'), '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});
t('s6-parse-hunk-before-section', {
  patch: lines('@@ -1 +1 @@', '-one', '+ONE', ...hdr('a.txt'), '@@ -1 +1 @@', '-one', '+ONE'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 1'),
});
t('s6-parse-hunk-before-section-forced', {
  patch: lines('Here you go:', '@@ -1 +1 @@', '-one', '+ONE'),
  argv: ['--format=unified', 'p.patch'], files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 2'),
});
for (const [fam, bad] of [
  ['s6-parse-bad-header-text', '@@ foo'],
  ['s6-parse-bad-header-no-closing', '@@ -1,3 +1,3'],
  ['s6-parse-bad-header-nonnumeric', '@@ -x,3 +1,3 @@'],
  ['s6-parse-bad-header-order', '@@ +1 -1 @@'],
  ['s6-parse-bad-header-bare', '@@'],
]) {
  t(fam, {
    patch: lines(...hdr('a.txt'), bad, ' one', '-two', '+TWO'),
    files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 3'),
  });
}
t('s6-parse-bad-second-header', {
  patch: lines(...hdr('a.txt'), '@@ -1 +1 @@', '-one', '+ONE', '@@ nonsense @@', '-three', '+3'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 6'),
});
t('s6-parse-before-failure', {
  patch: lines(...hdr('missing.txt'), '@@ -1 +1 @@', '-one', '+ONE', '@@ bad'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 6'),
  note: 'a parse error is reported before any file is looked at (the missing file is never reported)',
});

// ---- hunk headers and bodies -----------------------------------------------------------------------------------
t('s6-header-trailing-text', {
  patch: lines(...hdr('a.txt'), '@@ -2,1 +2,1 @@ function two() {', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});
t('s6-header-counts-unused', {
  patch: lines(...hdr('a.txt'), '@@ -2,999 +2,0 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
  note: 'B and D are not used',
});
t('s6-body-trailing-empty-lines-dropped', {
  patch: lines(...hdr('a.txt'), '@@ -1,2 +1,2 @@', ' one', '-two', '+TWO', '', '', 'That is all.'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});
t('s6-body-trailing-empty-before-next-hunk', {
  patch: lines(...hdr('a.txt'), '@@ -1,2 +1,2 @@', ' one', '-two', '+TWO', '', '@@ -3 +3 @@', '-three', '+3'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\n3\n' },
});
t('s6-empty-line-is-empty-context', {
  patch: lines(...hdr('a.txt'), '@@ -1,3 +1,3 @@', ' a', '', '-b', '+B'),
  files: { 'a.txt': 'a\n\nb\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\n\nB\n' },
});
t('s6-space-line-is-empty-context', {
  patch: lines(...hdr('a.txt'), '@@ -1,3 +1,3 @@', ' a', ' ', '-b', '+B'),
  files: { 'a.txt': 'a\n\nb\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\n\nB\n' },
});
t('s6-body-ends-at-prose', {
  patch: lines(...hdr('a.txt'), '@@ -2 +2 @@', '-two', '+TWO', 'Note: this was easy', '-three', '+3'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
  note: 'the body ends at the first line that is not a body line; later -/+ lines are outside any body and ignored',
});
t('s6-fenced-closing-fence-ends-body', {
  patch: lines('```diff', ...hdr('a.txt'), '@@ -2 +2 @@', '-two', '+TWO', '```', 'Done.'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});
t('s6-dashes-line-is-old-line', {
  patch: lines(...hdr('a.txt'), '@@ -1,3 +1,3 @@', ' x', '--- note', '+NOTE', ' y'),
  files: { 'a.txt': 'x\n-- note\ny\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'x\nNOTE\ny\n' },
  note: '"--- note" not followed by a "+++ " line is the old line "-- note"',
});
t('s6-plus-plus-plus-line-is-new-line', {
  patch: lines(...hdr('a.txt'), '@@ -1 +1,2 @@', ' x', '+++ y'),
  files: { 'a.txt': 'x\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'x\n++ y\n' },
});

// ---- applying hunks: nearest occurrence ------------------------------------------------------------------------
const XS = 'x\na\nx\nb\nx\n';
for (const [fam, hh, want] of [
  ['s6-nearest-tie-earlier', '@@ -4 +4 @@', 'x\na\nY\nb\nx\n'],
  ['s6-nearest-exact-late', '@@ -5 +5 @@', 'x\na\nx\nb\nY\n'],
  ['s6-nearest-exact-first', '@@ -1 +1 @@', 'Y\na\nx\nb\nx\n'],
  ['s6-nearest-a-zero', '@@ -0,1 +1 @@', 'Y\na\nx\nb\nx\n'],
  ['s6-nearest-a-beyond-end', '@@ -99 +99 @@', 'x\na\nx\nb\nY\n'],
]) {
  t(fam, { patch: lines(...hdr('a.txt'), hh, '-x', '+Y'), files: { 'a.txt': XS }, stdout: OK1('a.txt'), changes: { 'a.txt': want } });
}
t('s6-nearest-uses-d-positive', {
  patch: lines(...hdr('a.txt'), '@@ -1 +1,3 @@', ' x', '+n1', '+n2', '@@ -3 +5 @@', '-x', '+Y'),
  files: { 'a.txt': 'x\n1\nx\n2\nx\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'x\nn1\nn2\n1\nY\n2\nx\n' },
  note: 'after hunk 1, d = 2; hunk 2 target 3-1+2 = 4 -> the "x" now at index 4. Ignoring d would pick index 0 (tie, earlier).',
});
t('s6-nearest-uses-d-negative', {
  patch: lines(...hdr('a.txt'), '@@ -2,2 +2,0 @@', '-d1', '-d2', '@@ -5 +3 @@', '-x', '+Y'),
  files: { 'a.txt': 'x\nd1\nd2\nm\nx\nn\nx\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'x\nm\nY\nn\nx\n' },
  note: 'd = -2 after hunk 1; hunk 2 target 5-1-2 = 2 -> the "x" now at index 2',
});
t('s6-d-is-per-section', {
  patch: lines(...hdr('a.txt'), '@@ -1 +1,3 @@', ' one', '+n1', '+n2', ...hdr('b.txt'), '@@ -4 +4 @@', '-x', '+Y'),
  files: { 'a.txt': F3, 'b.txt': 'x\nm\nm\nx\nm\nx\n' }, stdout: out('M a.txt', 'M b.txt', 'ok: 2 files'),
  changes: { 'a.txt': 'one\nn1\nn2\ntwo\nthree\n', 'b.txt': 'x\nm\nm\nY\nm\nx\n' },
  note: 'd only sums the hunks of this section: b.txt target is 3 (d = 0), not 5',
});
t('s6-overlapping-occurrences-nearest', {
  patch: lines(...hdr('a.txt'), '@@ -2,2 +2,2 @@', '-a', '-a', '+b', '+b'),
  files: { 'a.txt': 'a\na\na\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nb\nb\n' },
});
t('s6-first-tier-with-occurrence-wins', {
  patch: lines(...hdr('a.txt'), '@@ -1 +1 @@', '-x', '+Y'),
  files: { 'a.txt': 'x  \nm\nm\nx\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'x  \nm\nm\nY\n' },
  note: 'tier 0 occurs (index 3) so tier 1 (index 0, nearer) is never considered',
});
t('s6-ambiguity-is-never-an-error', {
  patch: lines(...hdr('a.txt'), '@@ -2 +2 @@', '-x', '+Y'),
  files: { 'a.txt': 'x\nx\nx\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'x\nY\nx\n' },
});

// ---- applying hunks: empty O -----------------------------------------------------------------------------------
t('s6-empty-o-top', {
  patch: lines(...hdr('a.txt'), '@@ -0,0 +1 @@', '+top'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'top\none\ntwo\nthree\n' },
});
t('s6-empty-o-after-a-lines', {
  patch: lines(...hdr('a.txt'), '@@ -2,0 +3 @@', '+NEW'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\ntwo\nNEW\nthree\n' },
});
t('s6-empty-o-past-end', {
  patch: lines(...hdr('a.txt'), '@@ -50,0 +51 @@', '+NEW'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\ntwo\nthree\nNEW\n' },
});
t('s6-empty-o-uses-d', {
  patch: lines(...hdr('a.txt'), '@@ -1 +1,2 @@', ' one', '+ONEB', '@@ -2,0 +3 @@', '+INS'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nONEB\ntwo\nINS\nthree\n' },
  note: 'd = 1 after hunk 1, so INS goes after A + d = 3 lines',
});
t('s6-empty-o-end-adds-final-break', {
  patch: lines(...hdr('a.txt'), '@@ -2,0 +3 @@', '+c'),
  files: { 'a.txt': 'a\nb' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nb\nc\n' },
});
t('s6-empty-o-middle-keeps-no-final-break', {
  patch: lines(...hdr('a.txt'), '@@ -1,0 +2 @@', '+NEW'),
  files: { 'a.txt': 'a\nb' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nNEW\nb' },
});
t('s6-empty-o-into-empty-file', {
  patch: lines(...hdr('e.txt'), '@@ -0,0 +1 @@', '+first'),
  files: { 'e.txt': '' }, stdout: OK1('e.txt'), changes: { 'e.txt': 'first\n' },
});

// ---- no newline at end of file ---------------------------------------------------------------------------------
t('s6-eof-match-adds-final-break', {
  patch: lines(...hdr('a.txt'), '@@ -1,2 +1,2 @@', ' a', '-b', '+B'),
  files: { 'a.txt': 'a\nb' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nB\n' },
  note: 'matched lines run to the end of the file and no \\ line follows: the result ends with a line break',
});
t('s6-eof-backslash-after-plus-keeps-none', {
  patch: lines(...hdr('a.txt'), '@@ -1,2 +1,2 @@', ' a', '-b', '+B', '\\ No newline at end of file'),
  files: { 'a.txt': 'a\nb' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nB' },
});
t('s6-eof-backslash-removes-final-break', {
  patch: lines(...hdr('a.txt'), '@@ -1,2 +1,2 @@', ' a', '-b', '+B', '\\ No newline at end of file'),
  files: { 'a.txt': 'a\nb\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nB' },
});
t('s6-eof-backslash-after-minus-only', {
  patch: lines(...hdr('a.txt'), '@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+B'),
  files: { 'a.txt': 'a\nb' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nB\n' },
  note: 'the \\ line follows a - line, not the hunk\'s last context or + line, so the result ends with a line break',
});
t('s6-eof-backslash-after-context', {
  patch: lines(...hdr('a.txt'), '@@ -1,2 +1,2 @@', '-a', '+A', ' b', '\\ No newline at end of file'),
  files: { 'a.txt': 'a\nb\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'A\nb' },
});
t('s6-mid-file-hunk-keeps-missing-break', {
  patch: lines(...hdr('a.txt'), '@@ -1 +1 @@', '-a', '+A'),
  files: { 'a.txt': 'a\nb\nc' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'A\nb\nc' },
});
t('s6-mid-file-backslash-no-effect', {
  patch: lines(...hdr('a.txt'), '@@ -1 +1 @@', '-a', '+A', '\\ No newline at end of file'),
  files: { 'a.txt': 'a\nb\nc\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'A\nb\nc\n' },
  note: 'matched lines do not run to the end of the file, so the file\'s final break stays as it was',
});
t('s6-eof-crlf-final-break-is-crlf', {
  patch: lines(...hdr('a.txt'), '@@ -1,2 +1,2 @@', ' a', '-b', '+B'),
  files: { 'a.txt': 'a\r\nb' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\r\nB\r\n' },
});
t('s6-create-backslash-no-final-break', {
  patch: lines('--- /dev/null', '+++ b/n.txt', '@@ -0,0 +1,2 @@', '+x', '+y', '\\ No newline at end of file'),
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'x\ny' },
});
t('s6-insert-end-backslash', {
  patch: lines(...hdr('a.txt'), '@@ -1,0 +2 @@', '+z', '\\ No newline at end of file'),
  files: { 'a.txt': 'a\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nz' },
});
t('s6-delete-all-lines-writes-empty', {
  patch: lines(...hdr('a.txt'), '@@ -1 +0,0 @@', '-x'),
  files: { 'a.txt': 'x\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': '' },
  note: 'a file of no lines is written empty (not "\\n")',
});

// ---- tiers, context lines, re-indentation ----------------------------------------------------------------------
t('s5-unified-tier1-context-is-files-text', {
  patch: lines(...hdr('a.txt'), '@@ -1,2 +1,2 @@', ' a', '-b', '+B'),
  files: { 'a.txt': 'a  \nb\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a  \nB\n' },
});
t('s5-unified-tier2-reindent-context-file-text', {
  patch: lines(...hdr('a.txt'), '@@ -1,3 +1,3 @@', ' a', '-b', '+B', ' c'),
  files: { 'a.txt': '    a\n    b\n    c\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': '    a\n    B\n    c\n' },
  note: 'P is empty, F is four spaces: B (not a context line) gains F; context lines are written as the file\'s own text',
});
t('s5-unified-tier2-deeper-and-shallower', {
  patch: lines(...hdr('a.txt'), '@@ -1,2 +1,4 @@', '-\t\told', '+\t\tnew', '+\t\t\tdeeper', '+\tshallower', '+', '+\t\t ', ' c'),
  files: { 'a.txt': '  old\nc\n' }, stdout: OK1('a.txt'),
  changes: { 'a.txt': '  new\n  \tdeeper\n\tshallower\n\n\t\t \nc\n' },
  note: 'tier 2: P = two tabs, F = two spaces. "\\t\\tnew" -> "  new"; "\\t\\t\\tdeeper" -> "  \\tdeeper"; "\\tshallower" does not start with P: as is; empty and whitespace-only lines as is. (Context line c: file text "c".)',
});
t('s5-unified-tier2-first-line-of-o-gives-p', {
  patch: lines(...hdr('a.txt'), '@@ -1,2 +1,3 @@', '-  x', '-    y', '+  X', '+    Y', '+      Z'),
  files: { 'a.txt': '\tx\n\t  y\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': '\tX\n\t  Y\n\t    Z\n' },
  note: 'P = two spaces (O first line), F = one tab; every non-blank N line starting with P gets F instead',
});
t('s5-unified-strict-no-tier1', {
  patch: lines(...hdr('a.txt'), '@@ -1,2 +1,2 @@', ' a', '-b', '+B'),
  argv: ['--strict', 'p.patch'], files: { 'a.txt': 'a  \nb\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s5-unified-hunks-apply-to-results-of-earlier', {
  patch: lines(...hdr('a.txt'), '@@ -2 +2 @@', '-two', '+TWO', '@@ -2,2 +2,2 @@', ' TWO', '-three', '+3'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\n3\n' },
});
t('s10-unified-failed-hunk-changes-nothing', {
  patch: lines(...hdr('b.txt'), '@@ -1 +1 @@', '-b1', '+B1', ...hdr('a.txt'), '@@ -1 +1 @@', '-one', '+ONE', '@@ -3 +3 @@', '-absent', '+x'),
  files: { 'a.txt': F3, 'b.txt': 'b1\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 2),
});
t('s10-unified-sections-see-earlier-sections', {
  patch: lines(...hdr('a.txt'), '@@ -2 +2 @@', '-two', '+TWO', ...hdr('a.txt'), '@@ -1,2 +1,2 @@', ' one', '-TWO', '+2'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\n2\nthree\n' },
});
t('s2-unified-error-order-and-count', {
  patch: lines(...hdr('ok.txt'), '@@ -1 +1 @@', '-one', '+ONE', ...hdr('nofile.txt'), '@@ -1 +1 @@', '-one', '+ONE', ...hdr('a.txt'), '@@ -1 +1 @@', '-absent', '+x'),
  files: { 'a.txt': F3, 'ok.txt': F3 }, exit: 1, stdout: failOut(['error: missing nofile.txt', 'error: no-match a.txt'], 2, 3),
});

// ---- unsafe paths ----------------------------------------------------------------------------------------------
for (const [fam, p1, p2, shown] of [
  ['s3-unified-unsafe-dotdot', '--- a/../x.txt', '+++ b/../x.txt', '../x.txt'],
  ['s3-unified-unsafe-absolute', '--- /etc/passwd', '+++ /etc/passwd', '/etc/passwd'],
  ['s3-unified-unsafe-empty-segment-after-strip', '--- a//x.txt', '+++ b//x.txt', '/x.txt'],
  ['s3-unified-unsafe-dot-segment', '--- a/./x.txt', '+++ b/./x.txt', './x.txt'],
  ['s3-unified-unsafe-backslash', '--- a/dir\\x.txt', '+++ b/dir\\x.txt', 'dir\\x.txt'],
  ['s3-unified-unsafe-empty-segment-middle', '--- a/d//x.txt', '+++ b/d//x.txt', 'd//x.txt'],
  ['s3-unified-unsafe-trailing-slash', '--- a/dir/', '+++ b/dir/', 'dir/'],
]) {
  t(fam, {
    patch: lines(p1, p2, '@@ -1 +1 @@', '-one', '+ONE'),
    files: { 'a.txt': F3 }, exit: 1, stdout: failOut([`error: unsafe ${shown}`], 1, 1),
    note: 'the unsafe path is reported as written after the a/ b/ strip; safety is checked before existence',
  });
}
t('s3-unified-unsafe-new-path-of-move', {
  patch: lines('--- a/a.txt', '+++ b/../z.txt'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: unsafe ../z.txt'], 1, 1),
});
t('s3-unified-unsafe-creation', {
  patch: lines('--- /dev/null', '+++ b/../n.txt', '@@ -0,0 +1 @@', '+x'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: unsafe ../n.txt'], 1, 1),
});
t('s3-unified-unsafe-does-not-stop-others', {
  patch: lines('--- a/../x.txt', '+++ b/../x.txt', '@@ -1 +1 @@', '-one', '+ONE', ...hdr('a.txt'), '@@ -1 +1 @@', '-absent', '+x'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: unsafe ../x.txt', 'error: no-match a.txt'], 2, 2),
});

// ---- line breaks and patch CRLF --------------------------------------------------------------------------------
t('s3-unified-patch-crlf-on-lf-file', {
  patch: ['--- a/a.txt', '+++ b/a.txt', '@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three'].join('\r\n') + '\r\n',
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
  note: 'each patch line has one trailing \\r removed, so the new line is TWO, not TWO\\r',
});
t('s3-unified-patch-crlf-creates-lf', {
  patch: ['--- /dev/null', '+++ b/n.txt', '@@ -0,0 +1,2 @@', '+x', '+y'].join('\r\n') + '\r\n',
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'x\ny\n' },
});
t('s3-unified-crlf-file-lf-patch', {
  patch: lines(...hdr('a.txt'), '@@ -1,3 +1,4 @@', ' one', '-two', '+TWO', '+TWO2', ' three'),
  files: { 'a.txt': 'one\r\ntwo\r\nthree\r\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\r\nTWO\r\nTWO2\r\nthree\r\n' },
});
t('s3-unified-crlf-file-no-final-break-mid-hunk', {
  patch: lines(...hdr('a.txt'), '@@ -1 +1 @@', '-one', '+ONE'),
  files: { 'a.txt': 'one\r\ntwo' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'ONE\r\ntwo' },
});
t('s3-unified-bare-cr-is-content', {
  patch: lines(...hdr('a.txt'), '@@ -1,2 +1,2 @@', ' a', '-b', '+B'),
  files: { 'a.txt': 'a\nb\r\nc\r\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
  note: 'first LF is not preceded by CR, so the file is LF and its lines are "a", "b\\r", "c\\r"; "b" does not equal "b\\r" at any tier (\\r is not a space or tab)',
});
t('s3-unified-lf-file-with-later-crlf-keeps-them', {
  patch: lines(...hdr('a.txt'), '@@ -1 +1 @@', '-a', '+A'),
  files: { 'a.txt': 'a\nb\r\nc\r\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'A\nb\r\nc\r\n' },
});
t('s3-unified-crlf-file-with-later-lone-lf', {
  patch: lines(...hdr('a.txt'), '@@ -1 +1 @@', '-a', '+A'),
  files: { 'a.txt': 'a\r\nb\nc\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'A\r\nb\nc\n' },
  note: 'CRLF file: lines are "a" and "b\\nc\\n" (the text split at CRLF); no final CRLF, so none is added',
});


// ---- more unified ---------------------------------------------------------------------------------------------
t('s6-index-and-separator-lines-before-section-ignored', {
  patch: lines('Index: a.txt', '===================================================================', '--- a.txt\t(revision 1)', '+++ a.txt\t(working copy)', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});
t('s6-git-line-with-spaces-in-paths', {
  patch: lines('diff --git a/my file.txt b/my file.txt', '--- a/my file.txt', '+++ b/my file.txt', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'my file.txt': F3 }, stdout: OK1('my file.txt'), changes: { 'my file.txt': 'one\nTWO\nthree\n' },
});
t('s6-prose-between-hunks-of-one-section', {
  patch: lines(...hdr('a.txt'), '@@ -1 +1 @@', '-one', '+ONE', 'and then the last line:', '@@ -3 +3 @@', '-three', '+3'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'ONE\ntwo\n3\n' },
});
t('s6-delete-then-create-same-path-is-m', {
  patch: lines('diff --git a/a.txt b/a.txt', 'deleted file mode 100644', '--- a/a.txt', '+++ /dev/null', '@@ -1,3 +0,0 @@', '-one', '-two', '-three', 'diff --git a/a.txt b/a.txt', 'new file mode 100644', '--- /dev/null', '+++ b/a.txt', '@@ -0,0 +1 @@', '+fresh'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'fresh\n' },
});
t('s6-two-hunks-second-uses-first-result-context', {
  patch: lines(...hdr('a.txt'), '@@ -1,2 +1,2 @@', '-one', '+ONE', ' two', '@@ -1,2 +1,2 @@', ' ONE', ' two'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'ONE\ntwo\nthree\n' },
  note: 'hunk 2 context "ONE" exists only because hunk 1 already ran',
});

write();
