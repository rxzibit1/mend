import { lines, out, failOut, block, suite } from '../lib.mjs';

const { t, write } = suite('sr', 'search_replace');
const F3 = 'one\ntwo\nthree\n';
const OK1 = (p) => out(`M ${p}`, 'ok: 1 file');
const TWO = block('a.txt', ['two'], ['TWO']);
const WANT = 'one\nTWO\nthree\n';

// ---- markers and path lines ------------------------------------------------------------------------------------
t('s7-marker-trailing-whitespace', {
  patch: lines('a.txt', '<<<<<<< SEARCH  ', 'two', '=======\t', 'TWO', '>>>>>>> REPLACE   '),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': WANT },
});
t('s7-path-surrounding-whitespace', {
  patch: lines('\t  a.txt \t', '<<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': WANT },
});
t('s7-path-inner-spaces-kept', {
  patch: lines('src dir/a b.txt', '<<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE'),
  files: { 'src dir/a b.txt': F3 }, stdout: OK1('src dir/a b.txt'), changes: { 'src dir/a b.txt': WANT },
});
t('s7-path-skips-fence-before-search', {
  patch: lines('a.txt', '```python', '<<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE', '```'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': WANT },
  note: 'the path is the nearest line that is not blank and not a fence; the fence between path and SEARCH is skipped',
});
t('s7-path-skips-indented-fence-and-blank', {
  patch: lines('Here is the edit:', 'a.txt', '', '   ', '  ```diff', '', '<<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': WANT },
});
t('s7-path-single-backtick-is-a-path', {
  patch: lines('`a.txt`', '<<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: missing `a.txt`'], 1, 1),
  note: 'only lines starting with three backticks are skipped; "`a.txt`" is taken whole as the path',
});
t('s7-path-no-prefix-stripping', {
  patch: lines('a/x.txt', '<<<<<<< SEARCH', 'one', '=======', 'ONE', '>>>>>>> REPLACE'),
  files: { 'a/x.txt': 'one\n', 'x.txt': 'one\n' }, stdout: OK1('a/x.txt'), changes: { 'a/x.txt': 'ONE\n' },
  note: 'a/ and b/ are only removed in unified diffs (section 6)',
});
t('s7-inherit-previous-path', {
  patch: lines(...TWO, '<<<<<<< SEARCH', 'three', '=======', '3', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\n3\n' },
});
t('s7-inherit-after-closing-and-opening-fences', {
  patch: lines('```', ...TWO, '```', '', '```', '<<<<<<< SEARCH', 'three', '=======', '3', '>>>>>>> REPLACE', '```'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\n3\n' },
});
t('s7-inherit-is-previous-block-not-first', {
  patch: lines(...block('a.txt', ['one'], ['ONE']), ...block('b.txt', ['b1'], ['B1']), '<<<<<<< SEARCH', 'b2', '=======', 'B2', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3, 'b.txt': 'b1\nb2\n' }, stdout: out('M a.txt', 'M b.txt', 'ok: 2 files'),
  changes: { 'a.txt': 'ONE\ntwo\nthree\n', 'b.txt': 'B1\nB2\n' },
});
t('s7-inherit-from-failed-block', {
  patch: lines(...block('nofile.txt', ['x'], ['y']), '<<<<<<< SEARCH', 'x', '=======', 'z', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: missing nofile.txt', 'error: missing nofile.txt'], 2, 2),
});
t('s7-prose-line-between-blocks-becomes-path', {
  patch: lines(...TWO, 'Next edit:', '<<<<<<< SEARCH', 'three', '=======', '3', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: missing Next edit:'], 1, 2),
  note: 'the path is the nearest non-blank, non-fence line after the previous REPLACE line, so the prose line is the path',
});
t('s7-first-block-no-path-parse', {
  patch: lines('<<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 1'),
});
t('s7-first-block-only-fence-and-blank-before', {
  patch: lines('', '```', '', '<<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE', '```'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 4'),
});
t('s7-lines-outside-blocks-ignored', {
  patch: lines('Sure, here you go.', '', ...TWO, '', 'And that is the end of the change.', '```'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': WANT },
});

// ---- parse errors ----------------------------------------------------------------------------------------------
t('s7-parse-missing-equals', {
  patch: lines(...block('a.txt', ['one'], ['ONE']), 'a.txt', '<<<<<<< SEARCH', 'two', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 8'),
  note: 'second block\'s SEARCH line is line 8 (first block takes lines 1-6, path line is 7)',
});
t('s7-parse-missing-replace', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'two', '=======', 'TWO'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 2'),
});
t('s7-parse-replace-before-equals', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'two', '>>>>>>> REPLACE', '=======', 'TWO'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 2'),
  note: '"no ======= and then >>>>>>> REPLACE after it": here ======= comes after the REPLACE line, so it does not count',
});
t('s7-parse-indented-equals-is-not-marker', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'two', ' =======', 'TWO', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 2'),
  note: 'markers are matched with trailing whitespace removed only; a leading space makes it an ordinary line',
});
t('s7-parse-beats-failures', {
  patch: lines(...block('nofile.txt', ['x'], ['y']), 'a.txt', '<<<<<<< SEARCH', 'two'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 8'),
});
t('s7-parse-leading-space-search-forced', {
  patch: lines('a.txt', ' <<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE'),
  argv: ['--format=search-replace', 'p.patch'], files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 1'),
  note: 'no block is found at all: error: parse 1',
});

// ---- block semantics -------------------------------------------------------------------------------------------
t('s7-create-basic', {
  patch: lines('n.txt', '<<<<<<< SEARCH', '=======', 'x', 'y', '>>>>>>> REPLACE'),
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'x\ny\n' },
});
t('s7-create-nested-dirs', {
  patch: lines('d1/d2/n.txt', '<<<<<<< SEARCH', '=======', 'x', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, stdout: out('A d1/d2/n.txt', 'ok: 1 file'), changes: { 'd1/d2/n.txt': 'x\n' },
});
t('s7-create-exists', {
  patch: lines('a.txt', '<<<<<<< SEARCH', '=======', 'x', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: exists a.txt'], 1, 1),
});
t('s7-create-over-empty-file-exists', {
  patch: lines('a.txt', '<<<<<<< SEARCH', '=======', 'x', '>>>>>>> REPLACE'),
  files: { 'a.txt': '' }, exit: 1, stdout: failOut(['error: exists a.txt'], 1, 1),
});
t('s7-create-empty-file', {
  patch: lines('n.txt', '<<<<<<< SEARCH', '=======', '>>>>>>> REPLACE'),
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': '' },
  note: 'created from no lines: a file of no lines is written empty',
});
t('s7-create-then-edit-same-patch', {
  patch: lines('n.txt', '<<<<<<< SEARCH', '=======', 'x', 'y', '>>>>>>> REPLACE', '<<<<<<< SEARCH', 'y', '=======', 'Y', '>>>>>>> REPLACE'),
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'x\nY\n' },
});
t('s7-create-patch-crlf-is-lf', {
  patch: ['n.txt', '<<<<<<< SEARCH', '=======', 'x', 'y', '>>>>>>> REPLACE'].join('\r\n') + '\r\n',
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'x\ny\n' },
});
t('s7-blank-old-line-is-not-create', {
  patch: lines('a.txt', '<<<<<<< SEARCH', '', '=======', 'X', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'a\n\nb\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nX\nb\n' },
  note: 'one empty old line is one old line (not "old lines empty"); it matches the file\'s blank line',
});
t('s7-ambiguous-simple', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'x', '=======', 'Y', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'x\nm\nx\n' }, exit: 1, stdout: failOut(['error: ambiguous a.txt'], 1, 1),
});
t('s7-ambiguous-overlapping', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'a', 'a', '=======', 'b', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'a\na\na\n' }, exit: 1, stdout: failOut(['error: ambiguous a.txt'], 1, 1),
});
t('s7-ambiguous-at-tier1', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'x', '=======', 'Y', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'x \nx\t\n' }, exit: 1, stdout: failOut(['error: ambiguous a.txt'], 1, 1),
});
t('s7-ambiguous-at-tier2', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'x', '=======', 'Y', '>>>>>>> REPLACE'),
  files: { 'a.txt': ' x\n\tx \n' }, exit: 1, stdout: failOut(['error: ambiguous a.txt'], 1, 1),
});
t('s7-tier0-unique-beats-tier1-multiple', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'x', '=======', 'Y', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'x \nx\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'x \nY\n' },
  note: 'tier 0 has exactly one occurrence, so the tier-1 occurrence (line 1) is never considered',
});
t('s7-tier1-unique-beats-tier2-multiple', {
  patch: lines('a.txt', '<<<<<<< SEARCH', '  x', '=======', '  Y', '>>>>>>> REPLACE'),
  files: { 'a.txt': '  x  \nx\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': '  Y\nx\n' },
  note: 'tier 0: none; tier 1: "  x" matches only line 0 (line 1 has no indent); tier 2 would match both',
});
t('s7-tier1-old-line-trailing-ws', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'two   ', '=======', 'TWO', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': WANT },
});
t('s7-tier1-new-lines-as-is', {
  patch: lines('a.txt', '<<<<<<< SEARCH', '  x', '=======', '  Y', '>>>>>>> REPLACE'),
  files: { 'a.txt': '  x  \n' }, stdout: OK1('a.txt'), changes: { 'a.txt': '  Y\n' },
});
t('s7-lines-are-whole-lines', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'tw', '=======', 'TW', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s7-strict-no-tier1', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'x', '=======', 'Y', '>>>>>>> REPLACE'),
  argv: ['--strict', 'p.patch'], files: { 'a.txt': 'x  \n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s7-strict-no-tier2', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'x', '=======', 'Y', '>>>>>>> REPLACE'),
  argv: ['p.patch', '--strict'], files: { 'a.txt': '  x\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s7-strict-exact-ok', {
  patch: lines('a.txt', '<<<<<<< SEARCH', '  x  ', '=======', 'Y', '>>>>>>> REPLACE'),
  argv: ['--strict', 'p.patch'], files: { 'a.txt': '  x  \n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'Y\n' },
});
t('s7-tier2-adds-file-indent-to-all-new-lines', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'foo()', '=======', 'bar()', 'baz()', '>>>>>>> REPLACE'),
  files: { 'a.txt': '    foo()\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': '    bar()\n    baz()\n' },
  note: 'P is empty (every line starts with it), F is four spaces',
});
t('s7-tier2-p-replaced-by-f', {
  patch: lines('a.txt', '<<<<<<< SEARCH', '    x', '      y', '=======', '    X', '      Y', '  z', '', '>>>>>>> REPLACE'),
  files: { 'a.txt': '\tx\n\t\ty\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': '\tX\n\t  Y\n  z\n\n' },
  note: 'P = four spaces, F = tab. "    X" -> "\\tX", "      Y" -> "\\t  Y", "  z" does not start with P: as is, then an empty new line as is',
});
t('s7-tier2-blank-and-whitespace-only-new-lines-as-is', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'q', '=======', 'a', '', '   ', 'b', '>>>>>>> REPLACE'),
  files: { 'a.txt': '  q\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': '  a\n\n   \n  b\n' },
  note: 'P empty, F two spaces: empty line and whitespace-only line "   " are written as they are',
});
t('s7-tier2-multi-line-old', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'if (x) {', '  go();', '}', '=======', 'if (y) {', '  stop();', '}', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'f() {\n    if (x) {\n      go();\n    }\n}\n' }, stdout: OK1('a.txt'),
  changes: { 'a.txt': 'f() {\n    if (y) {\n      stop();\n    }\n}\n' },
  note: 'P empty, F four spaces: "if (y) {" -> 4sp, "  stop();" -> 4sp+2sp, "}" -> 4sp',
});
t('s7-delete-lines', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'two', '=======', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nthree\n' },
});
t('s7-delete-all-lines-file-written-empty', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'x', '=======', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'x\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': '' },
});
t('s7-old-on-empty-file-nomatch', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'x', '=======', 'y', '>>>>>>> REPLACE'),
  files: { 'a.txt': '' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s7-missing-file', {
  patch: lines('nofile.txt', '<<<<<<< SEARCH', 'x', '=======', 'y', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: missing nofile.txt'], 1, 1),
});
t('s7-sequential-blocks-see-results', {
  patch: lines(...TWO, '<<<<<<< SEARCH', 'TWO', '=======', 'II', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nII\nthree\n' },
});
t('s10-sr-failed-block-changes-nothing-others-run', {
  patch: lines(...block('a.txt', ['x'], ['y']), ...block('nofile.txt', ['x'], ['y']), ...block('a.txt', ['one'], ['ONE'])),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: no-match a.txt', 'error: missing nofile.txt'], 2, 3),
});
t('s10-sr-earlier-failed-edit-changes-nothing-for-later', {
  patch: lines(...block('a.txt', ['nothere'], ['Q']), ...block('a.txt', ['Q'], ['R'])),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: no-match a.txt', 'error: no-match a.txt'], 2, 2),
});
t('s10-sr-atomic-no-partial-writes', {
  patch: lines(...block('a.txt', ['one'], ['ONE']), ...block('b.txt', ['zzz'], ['y'])),
  files: { 'a.txt': F3, 'b.txt': 'b\n' }, exit: 1, stdout: failOut(['error: no-match b.txt'], 1, 2),
});

// ---- line breaks and patch CRLF --------------------------------------------------------------------------------
t('s3-sr-crlf-file-new-lines-crlf', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'two', '=======', 'TWO', 'TWO2', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'one\r\ntwo\r\nthree\r\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\r\nTWO\r\nTWO2\r\nthree\r\n' },
});
t('s3-sr-no-final-break-kept', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'two', '=======', 'TWO', 'TWO2', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'one\ntwo' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nTWO2' },
});
t('s3-sr-crlf-no-final-break-kept', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'one\r\ntwo' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\r\nTWO' },
});
t('s3-sr-patch-crlf-on-lf-file', {
  patch: ['a.txt', '<<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE'].join('\r\n') + '\r\n',
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': WANT },
});
t('s3-sr-first-lf-decides-lf', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'one', '=======', 'ONE', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'one\ntwo\r\nthree\r\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'ONE\ntwo\r\nthree\r\n' },
});
t('s3-sr-first-lf-decides-lf-cr-lines-no-match', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'one\ntwo\r\nthree\r\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
  note: 'the file is LF; its second line is "two\\r", which equals "two" at no tier (\\r is not a space or tab)',
});
t('s3-sr-first-lf-decides-crlf', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'one', '=======', 'ONE', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'one\r\ntwo\nthree\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'ONE\r\ntwo\nthree\n' },
  note: 'CRLF file: lines are "one" and "two\\nthree\\n"; no final CRLF',
});

// ---- unsafe paths ----------------------------------------------------------------------------------------------
for (const [fam, path] of [
  ['s3-sr-unsafe-dotdot', '../x.txt'],
  ['s3-sr-unsafe-absolute', '/etc/x.txt'],
  ['s3-sr-unsafe-dot-segment', './a.txt'],
  ['s3-sr-unsafe-empty-segment', 'd//a.txt'],
  ['s3-sr-unsafe-backslash', 'd\\a.txt'],
  ['s3-sr-unsafe-trailing-slash', 'dir/'],
  ['s3-sr-unsafe-dotdot-middle', 'd/../a.txt'],
]) {
  t(fam, {
    patch: lines(path, '<<<<<<< SEARCH', 'one', '=======', 'ONE', '>>>>>>> REPLACE'),
    files: { 'a.txt': F3 }, exit: 1, stdout: failOut([`error: unsafe ${path}`], 1, 1),
  });
}
t('s3-sr-unsafe-create-block', {
  patch: lines('../n.txt', '<<<<<<< SEARCH', '=======', 'x', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: unsafe ../n.txt'], 1, 1),
});
t('s3-sr-unsafe-then-others-evaluated', {
  patch: lines(...block('/abs.txt', ['one'], ['ONE']), ...block('a.txt', ['nothere'], ['x'])),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: unsafe /abs.txt', 'error: no-match a.txt'], 2, 2),
});

// ---- detection interplay ---------------------------------------------------------------------------------------
t('s4-sr-wins-over-unified-text', {
  patch: lines('diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '', 'a.txt', '<<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': WANT },
  note: 'rule 3 (SEARCH marker) is tried before rule 4 (unified); the path line is the nearest non-blank line before SEARCH',
});
t('s4-sr-detected-with-trailing-ws-marker', {
  patch: lines('a.txt', '<<<<<<< SEARCH \t', 'two', '=======', 'TWO', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': WANT },
});


// ---- more block semantics -------------------------------------------------------------------------------------
t('s7-new-lines-may-contain-equals-line', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'x', '=======', 'a', '=======', 'b', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'x\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\n=======\nb\n' },
  note: 'AMBIGUOUS: the first ======= after SEARCH ends the old lines; the new lines run to the first REPLACE marker and may hold another ======= line',
});
t('s7-create-twice-second-exists', {
  patch: lines('n.txt', '<<<<<<< SEARCH', '=======', 'x', '>>>>>>> REPLACE', '<<<<<<< SEARCH', '=======', 'y', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: exists n.txt'], 1, 2),
});
t('s5-sr-tier1-noop-edit-still-strips-trailing-ws', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'x', '=======', 'x', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'x  \n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'x\n' },
  note: 'matched at tier 1, the new line "x" is written as it is, so the file\'s bytes change',
});
t('s5-sr-tier2-noop-edit-leaves-file-unchanged', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'x', '=======', 'x', '>>>>>>> REPLACE'),
  files: { 'a.txt': '  x\n' }, stdout: out('ok: 0 files'),
  note: 'tier 2: P empty, F two spaces, so "x" is written as "  x": same bytes, not listed',
});
t('s5-sr-tier1-whitespace-only-file-line-equals-empty-old-line', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'a', '', 'b', '=======', 'a', 'X', 'b', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'a\n   \nb\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nX\nb\n' },
  note: 'tier 1: "   " and "" are equal once trailing spaces are removed',
});
t('s5-sr-tier1-whitespace-only-old-line-equals-empty-file-line', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'a', '  ', 'b', '=======', 'a', 'X', 'b', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'a\n\nb\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nX\nb\n' },
});
t('s7-second-block-sees-ambiguity-created-by-first', {
  patch: lines(...block('a.txt', ['two'], ['one']), ...block('a.txt', ['one'], ['x'])),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: ambiguous a.txt'], 1, 2),
});
t('s7-two-files-output-order-is-by-path-not-patch', {
  patch: lines(...block('z.txt', ['z'], ['Z']), ...block('a.txt', ['one'], ['ONE'])),
  files: { 'a.txt': F3, 'z.txt': 'z\n' }, stdout: out('M a.txt', 'M z.txt', 'ok: 2 files'), changes: { 'a.txt': 'ONE\ntwo\nthree\n', 'z.txt': 'Z\n' },
});
t('s7-old-lines-must-be-consecutive', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'one', 'three', '=======', 'x', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s7-tier2-old-first-line-indent-decides-p', {
  patch: lines('a.txt', '<<<<<<< SEARCH', '  a', 'b', '=======', '  A', 'B', '>>>>>>> REPLACE'),
  files: { 'a.txt': '\ta\n\t\tb\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': '\tA\nB\n' },
  note: 'P = two spaces (O first line), F = one tab: "  A" -> "\\tA"; "B" does not start with P: as is (the file\'s deeper indent of b is lost)',
});
t('s7-new-lines-longer-than-old-no-final-break-added', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'b', '=======', 'b', 'c', 'd', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'a\nb' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nb\nc\nd' },
});
t('s7-marker-lines-inside-code-fence-block', {
  patch: lines('Edit:', '```python', 'src/m.py', '<<<<<<< SEARCH', '    return 1', '=======', '    return 2', '>>>>>>> REPLACE', '```', 'Done.'),
  files: { 'src/m.py': 'def f():\n    return 1\n' }, stdout: out('M src/m.py', 'ok: 1 file'), changes: { 'src/m.py': 'def f():\n    return 2\n' },
});

write();
