import { lines, out, failOut, block, suite } from '../lib.mjs';

const { t, write } = suite('cli', 'cli');
const F3 = 'one\ntwo\nthree\n';
const WANT = 'one\nTWO\nthree\n';
const SRP = lines(...block('a.txt', ['two'], ['TWO']));
const OK = out('M a.txt', 'ok: 1 file');
const USAGE = out('error: usage');
const NOPATCH = out('error: no-patch');
const B = '*** Begin Patch';
const E = '*** End Patch';

/** A check on the base patch: files a.txt (+ the patch), changes optional. */
const base = (family, argv, o = {}) =>
  t(family, { patch: SRP, argv, files: { 'a.txt': F3 }, exit: 0, stdout: OK, changes: { 'a.txt': WANT }, ...o });
const usage = (family, argv, o = {}) => base(family, argv, { exit: 2, stdout: USAGE, changes: {}, ...o });

// ---- option order, `--`, stdin ---------------------------------------------------------------------------------
base('s1-order-check-before-patch', ['--check', 'p.patch'], { changes: {} });
base('s1-order-patch-before-options', ['p.patch', '--strict', '--format=search-replace']);
base('s1-order-patch-in-the-middle', ['--format=auto', 'p.patch', '--strict']);
base('s1-dashdash-then-patch', ['--', 'p.patch']);
base('s1-options-before-dashdash-are-options', ['--check', '--', 'p.patch'], { changes: {} });
base('s1-dot-slash-patch-path', ['./p.patch']);
t('s1-dashdash-dash-leading-patch-name', {
  patch: SRP, patchName: '-x.patch', argv: ['--', '-x.patch'], files: { 'a.txt': F3 }, stdout: OK, changes: { 'a.txt': WANT },
});
t('s1-dashdash-option-like-name-is-the-patch', {
  patch: SRP, patchName: '--check', argv: ['--', '--check'], files: { 'a.txt': F3 }, stdout: OK, changes: { 'a.txt': WANT },
  note: 'after --, "--check" is a positional argument naming the patch file, not the option: the tree IS written',
});
t('s1-dashdash-unknown-option-like-is-positional-no-patch', {
  patch: SRP, argv: ['--', '--bogus'], files: { 'a.txt': F3 }, exit: 2, stdout: NOPATCH,
});
usage('s1-dashdash-two-positionals', ['--', 'p.patch', 'p.patch']);
t('s1-subdirectory-patch-path', {
  patch: SRP, patchName: 'sub/dir/p.patch', argv: ['sub/dir/p.patch'], files: { 'a.txt': F3 }, stdout: OK, changes: { 'a.txt': WANT },
});
t('s1-stdin-when-no-positional', {
  argv: [], stdin: SRP, files: { 'a.txt': F3 }, stdout: OK, changes: { 'a.txt': WANT },
});
t('s1-stdin-dash', {
  argv: ['-'], stdin: SRP, files: { 'a.txt': F3 }, stdout: OK, changes: { 'a.txt': WANT },
});
t('s1-stdin-dash-with-options', {
  argv: ['--strict', '-', '--format=search-replace'], stdin: SRP, files: { 'a.txt': F3 }, stdout: OK, changes: { 'a.txt': WANT },
});
t('s1-stdin-check', {
  argv: ['--check', '-'], stdin: SRP, files: { 'a.txt': F3 }, stdout: OK, changes: {},
});
t('s1-stdin-ignored-when-file-given', {
  patch: SRP, argv: ['p.patch'], stdin: 'garbage that is not a patch\n', files: { 'a.txt': F3 }, stdout: OK, changes: { 'a.txt': WANT },
});
t('s1-stdin-empty-is-format-error', {
  argv: [], stdin: null, files: { 'a.txt': F3 }, exit: 2, stdout: out('error: format'),
  note: 'an empty standard input is an empty patch: auto detects no format',
});
t('s1-stdin-dash-is-not-a-usage-error', {
  argv: ['-', '--check'], stdin: SRP, files: { 'a.txt': F3 }, stdout: OK, changes: {},
});
usage('s1-dash-plus-file-is-two-positionals', ['-', 'p.patch'], { stdin: SRP });

// ---- usage errors ----------------------------------------------------------------------------------------------
usage('s1-usage-duplicate-check', ['--check', '--check', 'p.patch']);
usage('s1-usage-duplicate-strict', ['--strict', 'p.patch', '--strict']);
usage('s1-usage-duplicate-format-same-value', ['--format=auto', '--format=auto', 'p.patch']);
usage('s1-usage-duplicate-format-different-values', ['--format=search-replace', '--format=auto', 'p.patch']);
usage('s1-usage-bad-format-diff', ['--format=diff', 'p.patch']);
usage('s1-usage-bad-format-uppercase', ['--format=AUTO', 'p.patch']);
usage('s1-usage-bad-format-underscore', ['--format=search_replace', 'p.patch']);
usage('s1-usage-bad-format-empty', ['--format=', 'p.patch']);
usage('s1-usage-format-value-as-next-argument', ['--format', 'search-replace', 'p.patch']);
usage('s1-usage-unknown-short-x', ['-x', 'p.patch']);
usage('s1-usage-unknown-short-h', ['-h']);
usage('s1-usage-unknown-long', ['--help']);
usage('s1-usage-check-with-value', ['--check=1', 'p.patch']);
usage('s1-usage-strict-with-value', ['--strict=yes', 'p.patch']);
usage('s1-usage-no-check-negation', ['--no-check', 'p.patch']);
usage('s1-usage-two-positionals', ['p.patch', 'q.patch']);
usage('s1-usage-three-positionals-stdin-dash', ['p.patch', '-', 'x']);
usage('s1-usage-unknown-option-after-patch', ['p.patch', '--wat']);
usage('s1-usage-single-dash-letters-clustered', ['-cs', 'p.patch']);
t('s1-usage-beats-no-patch', {
  patch: SRP, argv: ['--bogus', 'nofile.patch'], files: { 'a.txt': F3 }, exit: 2, stdout: USAGE,
});
t('s1-usage-beats-no-patch-bad-format', {
  patch: SRP, argv: ['--format=nope', 'nofile.patch'], files: { 'a.txt': F3 }, exit: 2, stdout: USAGE,
});
t('s1-usage-two-positionals-both-missing', {
  patch: SRP, argv: ['nofile1', 'nofile2'], files: { 'a.txt': F3 }, exit: 2, stdout: USAGE,
});

// ---- no-patch, format, parse and their order -------------------------------------------------------------------
t('s2-no-patch-missing-file', {
  patch: SRP, argv: ['nofile.patch'], files: { 'a.txt': F3 }, exit: 2, stdout: NOPATCH,
});
t('s2-no-patch-directory', {
  argv: ['d'], files: { 'd/x.txt': 'y\n', 'a.txt': F3 }, exit: 2, stdout: NOPATCH,
  note: 'a directory cannot be read as a patch',
});
t('s2-no-patch-beats-forced-format', {
  patch: SRP, argv: ['--format=json', 'nofile.patch'], files: { 'a.txt': F3 }, exit: 2, stdout: NOPATCH,
});
t('s2-no-patch-with-check-and-strict', {
  patch: SRP, argv: ['--check', '--strict', 'nofile.patch'], files: { 'a.txt': F3 }, exit: 2, stdout: NOPATCH,
});
t('s2-format-error-prose-patch', {
  patch: 'Please change the second line to TWO.\nThanks!\n', files: { 'a.txt': F3 }, exit: 2, stdout: out('error: format'),
});
t('s2-format-error-empty-patch-file', {
  patch: '', files: { 'a.txt': F3 }, exit: 2, stdout: out('error: format'),
});
t('s2-format-error-whitespace-only-patch', {
  patch: ' \n\t\n\n', files: { 'a.txt': F3 }, exit: 2, stdout: out('error: format'),
});
t('s2-format-error-only-with-auto', {
  patch: 'Please change the second line to TWO.\n', argv: ['--format=unified', 'p.patch'], files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 1'),
  note: 'a named format reads the text as that format whatever it holds: no edit at all is parse 1',
});
t('s2-format-forced-unified-on-sr-text', {
  patch: SRP, argv: ['--format=unified', 'p.patch'], files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 1'),
});
t('s2-format-forced-v4a-on-sr-text', {
  patch: SRP, argv: ['--format=v4a', 'p.patch'], files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 1'),
});
t('s2-format-forced-json-on-sr-text', {
  patch: SRP, argv: ['--format=json', 'p.patch'], files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 1'),
});
t('s2-format-forced-sr-on-json-text', {
  patch: lines('{"command":"str_replace","path":"a.txt","old_str":"two","new_str":"TWO"}'), argv: ['--format=search-replace', 'p.patch'],
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 1'),
});
t('s2-format-forced-sr-on-unified-text', {
  patch: lines('--- a/a.txt', '+++ b/a.txt', '@@ -2 +2 @@', '-two', '+TWO'), argv: ['--format=search-replace', 'p.patch'],
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 1'),
});
t('s2-format-forced-matching-works', {
  patch: lines('--- a/a.txt', '+++ b/a.txt', '@@ -2 +2 @@', '-two', '+TWO'), argv: ['--format=unified', 'p.patch'],
  files: { 'a.txt': F3 }, stdout: OK, changes: { 'a.txt': WANT },
});
t('s2-format-forced-json-works', {
  patch: lines('{"command":"str_replace","path":"a.txt","old_str":"two","new_str":"TWO"}'), argv: ['--format=json', 'p.patch'],
  files: { 'a.txt': F3 }, stdout: OK, changes: { 'a.txt': WANT },
});
t('s2-parse-leaves-tree-alone-even-with-check', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'two'), argv: ['--check', 'p.patch'], files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 2'),
});

// ---- detection (section 4) -------------------------------------------------------------------------------------
t('s4-v4a-beats-sr-text', {
  patch: lines(B, 'a.txt', '<<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE', E),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 2'),
  note: 'rule 1 (first non-blank line is Begin Patch) wins: read as V4A, line 2 is an "other line"',
});
t('s4-json-beats-sr-text', {
  patch: lines('{"command":"create","path":"n.txt","file_text":"x"}', ...block('a.txt', ['two'], ['TWO'])),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 2'),
  note: 'rule 2 (first char { or [) is tried before rule 3: JSON Lines, line 2 is not an edit object',
});
t('s4-json-beats-unified-text', {
  patch: lines('[note]', '--- a/a.txt', '+++ b/a.txt', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 1'),
});
t('s4-json-first-nonblank-whitespace-indented', {
  patch: '\n \n\t  {"command":"create","path":"n.txt","file_text":"x"}\n',
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'x' },
});
t('s4-bracket-not-on-first-nonblank-line-is-not-json', {
  patch: lines('Here:', '[{"command":"create","path":"n.txt","file_text":"x"}]'),
  files: {}, exit: 2, stdout: out('error: format'),
});
t('s4-begin-patch-not-first-nonblank-is-not-v4a', {
  patch: lines('hello', B, '*** Add File: n.txt', '+x', E),
  files: {}, exit: 2, stdout: out('error: format'),
});
t('s4-begin-patch-with-trailing-text-is-not-v4a', {
  patch: lines('*** Begin Patch now', '*** Add File: n.txt', '+x', E),
  files: {}, exit: 2, stdout: out('error: format'),
});
t('s4-sr-marker-leading-whitespace-not-detected', {
  patch: lines('a.txt', '  <<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: format'),
});
t('s4-sr-marker-eight-angle-brackets-not-detected', {
  patch: lines('a.txt', '<<<<<<<< SEARCH', 'two', '=======', 'TWO', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: format'),
});
t('s4-sr-marker-lowercase-not-detected', {
  patch: lines('a.txt', '<<<<<<< search', 'two', '=======', 'TWO', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: format'),
});
t('s4-sr-marker-with-trailing-text-not-detected', {
  patch: lines('a.txt', '<<<<<<< SEARCH here', 'two', '=======', 'TWO', '>>>>>>> REPLACE'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: format'),
});
t('s4-unified-diff-git-only', {
  patch: lines('diff --git a/a.txt b/a.txt'),
  files: { 'a.txt': F3 }, stdout: out('ok: 0 files'),
});
t('s4-unified-bare-pair-is-a-move', {
  patch: lines('--- a.txt', '+++ b.txt'),
  files: { 'a.txt': F3 }, stdout: out('R a.txt -> b.txt', 'ok: 1 file'), changes: { 'a.txt': null, 'b.txt': F3 },
  note: '"+++ b.txt" has no b/ prefix to strip (it is "b.txt"), so the new path differs: a move',
});
t('s4-unified-minus-line-then-non-plus-line', {
  patch: lines('--- a.txt', 'x', '+++ b.txt'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: format'),
});
t('s4-unified-pair-with-blank-between-not-detected', {
  patch: lines('--- a.txt', '', '+++ a.txt', '@@ -1 +1 @@', '-one', '+ONE'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: format'),
});
t('s4-unified-minus-without-space-not-detected', {
  patch: lines('---a.txt', '+++a.txt', '@@ -1 +1 @@', '-one', '+ONE'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: format'),
});
t('s4-unified-diff-git-needs-trailing-space', {
  patch: lines('diff --git', '--- a.txt', 'x'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: format'),
});
t('s4-unified-diff-git-must-start-the-line', {
  patch: lines(' diff --git a/a.txt b/a.txt', '@@ -1 +1 @@', '-one', '+ONE'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: format'),
});
t('s4-unified-detected-late-line', {
  patch: lines('Some long explanation', 'that goes on', '', '--- a/a.txt', '+++ b/a.txt', '@@ -2 +2 @@', '-two', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK, changes: { 'a.txt': WANT },
});
t('s4-malformed-diff-git-detected-as-unified-then-parse', {
  patch: lines('Some intro', 'diff --git x y'),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 2'),
});

// ---- --check ---------------------------------------------------------------------------------------------------
t('s1-check-add-delete-move-written-nowhere', {
  patch: lines(B, '*** Add File: n.txt', '+x', '*** Delete File: b.txt', '*** Update File: a.txt', '*** Move to: z.txt', E),
  argv: ['--check', 'p.patch'], files: { 'a.txt': F3, 'b.txt': 'b\n' },
  stdout: out('D b.txt', 'A n.txt', 'R a.txt -> z.txt', 'ok: 3 files'), changes: {},
});
t('s1-check-failure-same-output-exit-1', {
  patch: lines(...block('a.txt', ['two'], ['TWO']), ...block('nofile.txt', ['x'], ['y'])),
  argv: ['--check', 'p.patch'], files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: missing nofile.txt'], 1, 2), changes: {},
});
t('s1-check-noop', {
  patch: lines(...block('a.txt', ['two'], ['two'])),
  argv: ['p.patch', '--check'], files: { 'a.txt': F3 }, stdout: out('ok: 0 files'), changes: {},
});
t('s1-check-creates-no-directories-or-files', {
  patch: lines(...block('d1/d2/n.txt', [], ['x'])),
  argv: ['--check', 'p.patch'], files: { 'a.txt': F3 }, stdout: out('A d1/d2/n.txt', 'ok: 1 file'), changes: {},
});
t('s1-check-still-detects-conflicts-between-edits', {
  patch: lines(B, '*** Add File: n.txt', '+x', '*** Add File: n.txt', '+y', E),
  argv: ['--check', 'p.patch'], files: {}, exit: 1, stdout: failOut(['error: exists n.txt'], 1, 2), changes: {},
});

// ---- --strict --------------------------------------------------------------------------------------------------
t('s1-strict-needs-exact-lines-unified', {
  patch: lines('--- a/a.txt', '+++ b/a.txt', '@@ -2 +2 @@', '-two ', '+TWO'),
  argv: ['--strict', 'p.patch'], files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s1-without-strict-trailing-space-ok', {
  patch: lines('--- a/a.txt', '+++ b/a.txt', '@@ -2 +2 @@', '-two ', '+TWO'),
  files: { 'a.txt': F3 }, stdout: OK, changes: { 'a.txt': WANT },
});
t('s1-strict-with-check', {
  patch: lines(...block('a.txt', ['two '], ['TWO'])),
  argv: ['--check', '--strict', 'p.patch'], files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s1-strict-leaves-json-alone', {
  patch: lines('{"command":"str_replace","path":"a.txt","old_str":"two","new_str":"TWO"}'),
  argv: ['--strict', 'p.patch'], files: { 'a.txt': F3 }, stdout: OK, changes: { 'a.txt': WANT },
});

// ---- section 3: files, lines, UTF-8 -----------------------------------------------------------------------------
t('s3-utf8-paths-and-content-roundtrip', {
  patch: lines('déjà/日本.txt', '<<<<<<< SEARCH', 'héllo 😀', '=======', 'héllo 世界', '>>>>>>> REPLACE'),
  files: { 'déjà/日本.txt': 'x\nhéllo 😀\ny\n' },
  stdout: out('M déjà/日本.txt', 'ok: 1 file'), changes: { 'déjà/日本.txt': 'x\nhéllo 世界\ny\n' },
});
t('s3-empty-file-has-no-lines', {
  patch: lines('--- a/e.txt', '+++ b/e.txt', '@@ -1 +1 @@', ' '),
  files: { 'e.txt': '' }, exit: 1, stdout: failOut(['error: no-match e.txt'], 1, 1),
  note: 'the hunk\'s only body line is a context line with empty text; an empty file has no lines, so O = [""] occurs nowhere',
});
t('s3-newline-only-file-has-one-empty-line', {
  patch: lines('--- a/e.txt', '+++ b/e.txt', '@@ -1 +1 @@', '-', '+X'),
  files: { 'e.txt': '\n' }, stdout: out('M e.txt', 'ok: 1 file'), changes: { 'e.txt': 'X\n' },
});
t('s3-lone-cr-is-not-a-line-break', {
  patch: lines('a.txt', '<<<<<<< SEARCH', 'a\rb', '=======', 'X', '>>>>>>> REPLACE'),
  files: { 'a.txt': 'a\rb\n' }, stdout: OK, changes: { 'a.txt': 'X\n' },
  note: 'no LF is preceded by a CR in the file, so it is an LF file with the single line "a\\rb"',
});
t('s3-crlf-file-edit-keeps-crlf-everywhere', {
  patch: lines(B, '*** Update File: a.txt', '@@', ' one', '-two', '+TWO', '+2b', ' three', E),
  files: { 'a.txt': 'one\r\ntwo\r\nthree\r\n' }, stdout: OK, changes: { 'a.txt': 'one\r\nTWO\r\n2b\r\nthree\r\n' },
});
t('s3-patch-last-line-without-final-lf', {
  patch: SRP.slice(0, -1), files: { 'a.txt': F3 }, stdout: OK, changes: { 'a.txt': WANT },
  note: 'the patch text has no final LF; its last line is still a line',
});

// ---- priorities between error classes ------------------------------------------------------------------------
t('s2-usage-writes-nothing', {
  patch: SRP, argv: ['p.patch', '--bogus'], files: { 'a.txt': F3 }, exit: 2, stdout: USAGE,
});
t('s2-exit1-writes-nothing-creations-and-deletions-too', {
  patch: lines(B, '*** Add File: n.txt', '+x', '*** Delete File: b.txt', '*** Update File: nofile.txt', '@@', '-x', '+y', E),
  files: { 'a.txt': F3, 'b.txt': 'b\n' }, exit: 1, stdout: failOut(['error: missing nofile.txt'], 1, 3),
});

write();
