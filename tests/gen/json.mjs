import { lines, out, failOut, suite } from '../lib.mjs';

const { t, write } = suite('json', 'json');
const F3 = 'one\ntwo\nthree\n';
const OK1 = (p) => out(`M ${p}`, 'ok: 1 file');
const J = JSON.stringify;
const jl = (...objs) => lines(...objs.map((o) => J(o)));
const ja = (objs) => J(objs, null, 2) + '\n';
const sr = (path, old_str, new_str) => ({ command: 'str_replace', path, old_str, new_str });
const cr = (path, file_text) => ({ command: 'create', path, file_text });
const ins = (path, insert_line, new_str) => ({ command: 'insert', path, insert_line, new_str });

// ---- array vs JSON Lines ---------------------------------------------------------------------------------------
t('s9-array-form-pretty', {
  patch: ja([sr('a.txt', 'two', 'TWO'), cr('n.txt', 'x\n')]),
  files: { 'a.txt': F3 }, stdout: out('M a.txt', 'A n.txt', 'ok: 2 files'), changes: { 'a.txt': 'one\nTWO\nthree\n', 'n.txt': 'x\n' },
});
t('s9-array-after-blank-lines', {
  patch: '\n  \n  ' + J([sr('a.txt', 'two', 'TWO')]) + '\n',
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});
t('s9-lines-blank-and-whitespace-lines-ignored', {
  patch: '\n' + J(sr('a.txt', 'one', 'ONE')) + '\n   \n\t\n' + J(sr('a.txt', 'three', '3')) + '\n\n',
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'ONE\ntwo\n3\n' },
});
t('s9-lines-crlf-endings', {
  patch: [J(sr('a.txt', 'one', 'ONE')), J(sr('a.txt', 'three', '3'))].join('\r\n') + '\r\n',
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'ONE\ntwo\n3\n' },
});
t('s9-lines-leading-whitespace-on-line', {
  patch: '   ' + J(sr('a.txt', 'one', 'ONE')) + '   \n',
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'ONE\ntwo\nthree\n' },
});

// ---- parse faults, array form: error: parse <line where the array starts> -----------------------------------
t('s9-array-invalid-json', {
  patch: '[\n' + J(cr('n.txt', 'x')) + ',\n{bad}\n]\n',
  files: {}, exit: 2, stdout: out('error: parse 1'),
});
t('s9-array-fault-reports-start-line', {
  patch: '\n\n[\n' + J(cr('n.txt', 'x')) + ',\n{"command":"nope","path":"n.txt"}\n]\n',
  files: {}, exit: 2, stdout: out('error: parse 3'),
});
t('s9-array-element-not-object', {
  patch: '[1]\n', files: {}, exit: 2, stdout: out('error: parse 1'),
});
t('s9-array-trailing-garbage', {
  patch: J([cr('n.txt', 'x')]) + ' x\n', files: {}, exit: 2, stdout: out('error: parse 1'),
});
t('s9-array-trailing-comma', {
  patch: '[' + J(cr('n.txt', 'x')) + ',]\n', files: {}, exit: 2, stdout: out('error: parse 1'),
});
t('s9-array-two-arrays', {
  patch: J([cr('n.txt', 'x')]) + '\n' + J([cr('m.txt', 'y')]) + '\n', files: {}, exit: 2, stdout: out('error: parse 1'),
});
t('s9-array-empty', {
  patch: '[]\n', files: {}, exit: 2, stdout: out('error: parse 1'),
  note: 'a patch in which the reader finds no edit at all is error: parse 1',
});
t('s9-array-one-bad-edit-poisons-all', {
  patch: ja([sr('a.txt', 'one', 'ONE'), { command: 'view', path: 'a.txt' }]),
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 1'),
});
t('s9-array-fault-line-is-array-start-not-element', {
  patch: '  [\n  ' + J(cr('n.txt', 'x')) + ',\n  ' + J({ command: 'create', path: 'm.txt' }) + '\n]\n',
  files: {}, exit: 2, stdout: out('error: parse 1'),
});

// ---- parse faults, JSON Lines: error: parse <that line> --------------------------------------------------------
t('s9-lines-fault-line-number-counts-blank-lines', {
  patch: J(cr('n.txt', 'x')) + '\n\n{not json}\n',
  files: {}, exit: 2, stdout: out('error: parse 3'),
});
t('s9-lines-array-on-a-line-is-fault', {
  patch: J(cr('n.txt', 'x')) + '\n' + J([cr('m.txt', 'y')]) + '\n',
  files: {}, exit: 2, stdout: out('error: parse 2'),
});
t('s9-lines-two-objects-on-one-line', {
  patch: J(cr('n.txt', 'x')) + ' ' + J(cr('m.txt', 'y')) + '\n',
  files: {}, exit: 2, stdout: out('error: parse 1'),
});
t('s9-lines-multiline-object', {
  patch: '{\n  "command": "create",\n  "path": "n.txt",\n  "file_text": "x"\n}\n',
  files: {}, exit: 2, stdout: out('error: parse 1'),
});
t('s9-lines-object-without-command', {
  patch: J(cr('n.txt', 'x')) + '\n' + '\n' + J({ path: 'm.txt', file_text: 'y' }) + '\n',
  files: {}, exit: 2, stdout: out('error: parse 3'),
});
t('s9-lines-fault-beats-failing-edit', {
  patch: J(sr('a.txt', 'nothere', 'x')) + '\n' + J({ command: 'create', path: 'n.txt' }) + '\n',
  files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 2'),
});
t('s9-empty-patch-forced-json', {
  patch: '', argv: ['--format=json', 'p.patch'], files: {}, exit: 2, stdout: out('error: parse 1'),
});
t('s9-blank-only-patch-forced-json', {
  patch: '\n \n', argv: ['--format=json', 'p.patch'], files: {}, exit: 2, stdout: out('error: parse 1'),
});
t('s9-lines-scalar-line-is-fault', {
  patch: J(cr('n.txt', 'x')) + '\n42\n',
  argv: ['--format=json', 'p.patch'], files: {}, exit: 2, stdout: out('error: parse 2'),
  note: 'forced json: second line is a valid JSON value but not an edit object',
});

// ---- parse faults: wrong command, missing or mistyped keys ----------------------------------------------------
const faults = [
  ['unknown-command', { command: 'view', path: 'a.txt' }, null],
  ['command-case-sensitive', { command: 'Create', path: 'n.txt', file_text: 'x' }, null],
  ['undo-edit-not-supported', { command: 'undo_edit', path: 'a.txt' }, null],
  ['command-not-a-string', { command: 1, path: 'a.txt', old_str: 'one', new_str: 'x' }, null],
  ['no-command', { path: 'a.txt', old_str: 'one', new_str: 'x' }, null],
  ['no-path', { command: 'create', file_text: 'x' }, null],
  ['path-not-a-string', { command: 'create', path: 7, file_text: 'x' }, null],
  ['path-null', { command: 'str_replace', path: null, old_str: 'one', new_str: 'x' }, null],
  ['create-no-file-text', { command: 'create', path: 'n.txt' }, null],
  ['create-file-text-number', { command: 'create', path: 'n.txt', file_text: 5 }, null],
  ['create-file-text-null', { command: 'create', path: 'n.txt', file_text: null }, null],
  ['str-replace-no-old-str', { command: 'str_replace', path: 'a.txt', new_str: 'x' }, null],
  ['str-replace-old-str-number', { command: 'str_replace', path: 'a.txt', old_str: 1, new_str: 'x' }, null],
  ['str-replace-new-str-null', { command: 'str_replace', path: 'a.txt', old_str: 'one', new_str: null }, null],
  ['str-replace-new-str-number', { command: 'str_replace', path: 'a.txt', old_str: 'one', new_str: 3 }, null],
  ['insert-line-string', { command: 'insert', path: 'a.txt', insert_line: '1', new_str: 'x' }, null],
  ['insert-line-null', { command: 'insert', path: 'a.txt', insert_line: null, new_str: 'x' }, null],
  ['insert-line-bool', { command: 'insert', path: 'a.txt', insert_line: true, new_str: 'x' }, null],
  ['insert-line-missing', { command: 'insert', path: 'a.txt', new_str: 'x' }, null],
  ['insert-line-fraction', { command: 'insert', path: 'a.txt', insert_line: 0.5, new_str: 'x' }, null],
  ['insert-new-str-number', { command: 'insert', path: 'a.txt', insert_line: 1, new_str: 9 }, null],
];
for (const [name, obj] of faults) {
  t(`s9-parse-${name}`, { patch: jl(obj), files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 1') });
}
t('s9-parse-str-replace-empty-old-str', {
  patch: jl(sr('a.txt', '', 'x')), files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 1'),
  note: 'AMBIGUOUS: old_str must be "a non-empty string"; an empty one is read here as a parse fault (a mistyped key), not no-match',
});
t('s9-parse-insert-without-new-str', {
  patch: jl({ command: 'insert', path: 'a.txt', insert_line: 1 }), files: { 'a.txt': F3 }, exit: 2, stdout: out('error: parse 1'),
  note: 'only str_replace says "new_str (absent is empty)"; insert says "new_str a string", so absent is a missing key. AMBIGUOUS',
});
t('s9-unknown-keys-ignored', {
  patch: jl({ command: 'create', path: 'n.txt', file_text: 'x\n', description: 'hi', old_str: 5, insert_line: 'zz', new_str: null, extra: { a: [1] } }),
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'x\n' },
});
t('s9-unknown-keys-ignored-str-replace', {
  patch: jl({ command: 'str_replace', path: 'a.txt', old_str: 'two', new_str: 'TWO', file_text: 7, insert_line: 'q', view_range: [1, 2] }),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO\nthree\n' },
});

// ---- create ------------------------------------------------------------------------------------------------------
t('s9-create-byte-for-byte-no-final-newline', {
  patch: jl(cr('n.txt', 'a\r\nb\tc')), files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'a\r\nb\tc' },
});
t('s9-create-escapes-and-unicode', {
  patch: jl(cr('n.txt', 'café 日本 😀\n\n\n')), files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'café 日本 😀\n\n\n' },
});
t('s9-create-empty-file-text', {
  patch: jl(cr('n.txt', '')), files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': '' },
});
t('s9-create-lone-newline', {
  patch: jl(cr('n.txt', '\n')), files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': '\n' },
});
t('s9-create-nested-dirs', {
  patch: jl(cr('d1/d2/d3/n.txt', 'x')), files: {}, stdout: out('A d1/d2/d3/n.txt', 'ok: 1 file'), changes: { 'd1/d2/d3/n.txt': 'x' },
});
t('s9-create-exists', {
  patch: jl(cr('a.txt', 'x')), files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: exists a.txt'], 1, 1),
});
t('s9-create-exists-empty-file', {
  patch: jl(cr('a.txt', 'x')), files: { 'a.txt': '' }, exit: 1, stdout: failOut(['error: exists a.txt'], 1, 1),
});
t('s9-create-no-path-prefix-stripping', {
  patch: jl(cr('a/x.txt', 'x')), files: { 'x.txt': 'old' }, stdout: out('A a/x.txt', 'ok: 1 file'), changes: { 'a/x.txt': 'x' },
});
t('s9-create-then-str-replace-then-insert', {
  patch: jl(cr('n.txt', 'a\nb\n'), sr('n.txt', 'b', 'B'), ins('n.txt', 0, 'top')),
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'top\na\nB\n' },
});
t('s9-create-patch-crlf-lines-keeps-file-text', {
  patch: J(cr('n.txt', 'x\r\ny\r\n')) + '\r\n',
  files: {}, stdout: out('A n.txt', 'ok: 1 file'), changes: { 'n.txt': 'x\r\ny\r\n' },
  note: 'file_text is written byte for byte (its \\r\\n escapes are not patch line breaks)',
});

// ---- str_replace -------------------------------------------------------------------------------------------------
t('s9-str-replace-substring-not-whole-lines', {
  patch: jl(sr('a.txt', 'o b', 'O_B')), files: { 'a.txt': 'foo bar\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'foO_Bar\n' },
});
t('s9-str-replace-across-lines-partial', {
  patch: jl(sr('a.txt', 'e\ntw', 'E-TW')), files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'onE-TWo\nthree\n' },
});
t('s9-str-replace-no-tier1', {
  patch: jl(sr('a.txt', 'x\n', 'y\n')), files: { 'a.txt': 'x  \n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
  note: 'no tier applies in JSON: "x\\n" is not a substring of "x  \\n"',
});
t('s9-str-replace-no-tier2', {
  patch: jl(sr('a.txt', ' y', 'z')), files: { 'a.txt': '\ty\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s9-str-replace-strict-flag-irrelevant', {
  patch: jl(sr('a.txt', 'o b', 'X')), argv: ['--strict', 'p.patch'], files: { 'a.txt': 'foo bar\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'foXar\n' },
});
t('s9-str-replace-ambiguous', {
  patch: jl(sr('a.txt', 'x', 'y')), files: { 'a.txt': 'x\nm\nx\n' }, exit: 1, stdout: failOut(['error: ambiguous a.txt'], 1, 1),
});
t('s9-str-replace-ambiguous-overlapping', {
  patch: jl(sr('a.txt', 'aa', 'b')), files: { 'a.txt': 'aaa\n' }, exit: 1, stdout: failOut(['error: ambiguous a.txt'], 1, 1),
  note: 'positions may overlap: "aa" occurs at 0 and 1 in "aaa"',
});
t('s9-str-replace-absent-new-str-deletes', {
  patch: jl({ command: 'str_replace', path: 'a.txt', old_str: ' world' }), files: { 'a.txt': 'hello world\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'hello\n' },
});
t('s9-str-replace-empty-new-str-deletes-lines', {
  patch: jl(sr('a.txt', 'two\n', '')), files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nthree\n' },
});
t('s9-str-replace-dollar-patterns-literal', {
  patch: jl(sr('a.txt', 'x', "$&|$1|$$|$'|$`|$<n>")), files: { 'a.txt': 'x\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': "$&|$1|$$|$'|$`|$<n>\n" },
});
t('s9-str-replace-regex-chars-literal', {
  patch: jl(sr('a.txt', 'a.c*(', 'Z')), files: { 'a.txt': 'abc\na.c*(\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'abc\nZ\n' },
});
t('s9-str-replace-unicode', {
  patch: jl(sr('a.txt', 'wörld', '日本語')), files: { 'a.txt': 'héllo wörld\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'héllo 日本語\n' },
});
t('s9-str-replace-same-text-is-noop', {
  patch: jl(sr('a.txt', 'two', 'two')), files: { 'a.txt': F3 }, stdout: out('ok: 0 files'),
});
t('s9-str-replace-no-final-newline-kept', {
  patch: jl(sr('a.txt', 'two', 'TWO')), files: { 'a.txt': 'one\ntwo' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nTWO' },
});
t('s9-str-replace-missing-file', {
  patch: jl(sr('nofile.txt', 'x', 'y')), files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: missing nofile.txt'], 1, 1),
});
t('s9-str-replace-empty-file-no-match', {
  patch: jl(sr('a.txt', 'x', 'y')), files: { 'a.txt': '' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s9-str-replace-crlf-file-lf-strings', {
  patch: jl(sr('a.txt', 'a\nb', 'x\ny')), files: { 'a.txt': 'a\r\nb\r\nc\r\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'x\r\ny\r\nc\r\n' },
});
t('s9-str-replace-crlf-file-crlf-in-old-str', {
  patch: jl(sr('a.txt', 'a\r\nb', 'X')), files: { 'a.txt': 'a\r\nb\r\nc\r\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'X\r\nc\r\n' },
});
t('s9-str-replace-crlf-file-crlf-in-new-str', {
  patch: jl(sr('a.txt', 'a', 'x\r\ny')), files: { 'a.txt': 'a\r\nb\r\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'x\r\ny\r\nb\r\n' },
  note: 'new_str is read with \\r\\n as \\n, then everything is written back with \\r\\n: no doubled \\r',
});
t('s9-str-replace-crlf-file-lone-lf-becomes-crlf', {
  patch: jl(sr('a.txt', 'c', 'C')), files: { 'a.txt': 'a\r\nb\nc\r\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\r\nb\r\nC\r\n' },
  note: 'AMBIGUOUS: the text is read with every \\r\\n as \\n and the result is written back with \\r\\n, so the lone \\n after b also becomes \\r\\n',
});
t('s9-str-replace-crlf-file-final-newline-and-no-final', {
  patch: jl(sr('a.txt', 'b', 'B')), files: { 'a.txt': 'a\r\nb' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\r\nB' },
});
t('s9-str-replace-lf-file-crlf-strings-not-normalized', {
  patch: jl(sr('a.txt', 'a\r\nb', 'X')), files: { 'a.txt': 'a\nb\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
  note: 'LF file: the \\r\\n normalization applies only to a CRLF file',
});
t('s9-str-replace-lf-file-with-inner-crlf-matches-literally', {
  patch: jl(sr('a.txt', 'b\r\nc', 'X')), files: { 'a.txt': 'a\nb\r\nc\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nX\n' },
});
t('s9-str-replace-sees-earlier-edit', {
  patch: jl(sr('a.txt', 'two', 'TWO'), sr('a.txt', 'TWO', 'II')), files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nII\nthree\n' },
});
t('s9-str-replace-second-edit-can-become-ambiguous', {
  patch: jl(sr('a.txt', 'two', 'one'), sr('a.txt', 'one', 'x')), files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: ambiguous a.txt'], 1, 2),
  note: 'after edit 1 the text holds "one" twice; edit 2 sees that',
});

// ---- insert ------------------------------------------------------------------------------------------------------
t('s9-insert-top', {
  patch: jl(ins('a.txt', 0, 'top')), files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'top\none\ntwo\nthree\n' },
});
t('s9-insert-middle-multi-line', {
  patch: jl(ins('a.txt', 1, 'a\nb')), files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\na\nb\ntwo\nthree\n' },
});
t('s9-insert-bottom-line-count', {
  patch: jl(ins('a.txt', 3, 'X')), files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\ntwo\nthree\nX\n' },
});
t('s9-insert-beyond-lines-no-match', {
  patch: jl(ins('a.txt', 4, 'X')), files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s9-insert-negative-no-match', {
  patch: jl(ins('a.txt', -1, 'X')), files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s9-insert-trailing-newline-in-new-str-is-not-a-line', {
  patch: jl(ins('a.txt', 1, 'X\n')), files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nX\ntwo\nthree\n' },
});
t('s9-insert-two-trailing-newlines-one-empty-line', {
  patch: jl(ins('a.txt', 1, 'X\n\n')), files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\nX\n\ntwo\nthree\n' },
});
t('s9-insert-lone-newline-is-one-empty-line', {
  patch: jl(ins('a.txt', 1, '\n')), files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\n\ntwo\nthree\n' },
});
t('s9-insert-empty-new-str-inserts-nothing', {
  patch: jl(ins('a.txt', 1, '')), files: { 'a.txt': F3 }, stdout: out('ok: 0 files'),
});
t('s9-insert-crlf-in-new-str-split', {
  patch: jl(ins('a.txt', 1, 'a\r\nb\r\n')), files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\na\nb\ntwo\nthree\n' },
});
t('s9-insert-into-crlf-file', {
  patch: jl(ins('a.txt', 1, 'a\nb')), files: { 'a.txt': 'one\r\ntwo\r\n' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'one\r\na\r\nb\r\ntwo\r\n' },
});
t('s9-insert-final-break-absent-kept-at-end', {
  patch: jl(ins('a.txt', 2, 'c')), files: { 'a.txt': 'a\nb' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nb\nc' },
  note: 'the file\'s final break stays as it was: it had none, so none is added',
});
t('s9-insert-final-break-absent-kept-middle', {
  patch: jl(ins('a.txt', 1, 'X')), files: { 'a.txt': 'a\nb' }, stdout: OK1('a.txt'), changes: { 'a.txt': 'a\nX\nb' },
});
t('s9-insert-lines-count-ignores-final-empty-piece', {
  patch: jl(ins('a.txt', 2, 'X')), files: { 'a.txt': 'a\n' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
  note: '"a\\n" has 1 line, so insert_line 2 is out of range',
});
t('s9-insert-lines-count-without-final-break', {
  patch: jl(ins('a.txt', 3, 'X')), files: { 'a.txt': 'a\nb' }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 1),
});
t('s9-insert-into-empty-file', {
  patch: jl(ins('e.txt', 0, 'x')), files: { 'e.txt': '' }, stdout: OK1('e.txt'), changes: { 'e.txt': 'x' },
  note: 'AMBIGUOUS-ish literal reading: the empty file did not end with a line break, so "the file\'s final break stays as it was" gives "x" without one',
});
t('s9-insert-into-empty-file-line-1-no-match', {
  patch: jl(ins('e.txt', 1, 'x')), files: { 'e.txt': '' }, exit: 1, stdout: failOut(['error: no-match e.txt'], 1, 1),
});
t('s9-insert-missing-file', {
  patch: jl(ins('nofile.txt', 0, 'x')), files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: missing nofile.txt'], 1, 1),
});
t('s9-insert-sequential-sees-earlier', {
  patch: jl(ins('a.txt', 0, 'A'), ins('a.txt', 0, 'B'), ins('a.txt', 5, 'END')),
  files: { 'a.txt': F3 }, stdout: OK1('a.txt'), changes: { 'a.txt': 'B\nA\none\ntwo\nthree\nEND\n' },
});

// ---- unsafe paths and order ----------------------------------------------------------------------------------
for (const [fam, path] of [
  ['s3-json-unsafe-dotdot', '../x.txt'],
  ['s3-json-unsafe-absolute', '/etc/x.txt'],
  ['s3-json-unsafe-dot-segment', 'd/./x.txt'],
  ['s3-json-unsafe-empty-segment', 'd//x.txt'],
  ['s3-json-unsafe-backslash', 'd\\x.txt'],
  ['s3-json-unsafe-trailing-slash', 'dir/'],
  ['s3-json-unsafe-single-dot', '.'],
]) {
  t(fam, { patch: jl(cr(path, 'x')), files: { 'a.txt': F3 }, exit: 1, stdout: failOut([`error: unsafe ${path}`], 1, 1) });
}
t('s3-json-unsafe-str-replace-wins-over-missing', {
  patch: jl(sr('../nofile.txt', 'x', 'y')), files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: unsafe ../nofile.txt'], 1, 1),
});
t('s3-json-unsafe-insert', {
  patch: jl(ins('/abs.txt', 0, 'x')), files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: unsafe /abs.txt'], 1, 1),
});
t('s3-json-empty-path-unsafe', {
  patch: jl(cr('', 'x')), files: { 'a.txt': F3 }, exit: 1, stdout: 'error: unsafe \nfailed: 1 of 1 edits\n',
  note: 'an empty path is not safe; the error line is "error: unsafe " with a trailing space',
});
t('s10-json-failures-in-order-and-count', {
  patch: jl(sr('a.txt', 'one', 'ONE'), sr('nofile.txt', 'x', 'y'), cr('a.txt', 'z'), sr('a.txt', 'nothere', 'q'), ins('a.txt', 99, 'x')),
  files: { 'a.txt': F3 }, exit: 1,
  stdout: failOut(['error: missing nofile.txt', 'error: exists a.txt', 'error: no-match a.txt', 'error: no-match a.txt'], 4, 5),
});
t('s10-json-atomic-nothing-written', {
  patch: jl(cr('n.txt', 'x'), sr('a.txt', 'one', 'ONE'), sr('a.txt', 'nothere', 'q')),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: no-match a.txt'], 1, 3),
});
t('s10-json-earlier-failed-edit-does-not-change-state', {
  patch: jl(sr('a.txt', 'nothere', 'Q'), sr('a.txt', 'Q', 'R')),
  files: { 'a.txt': F3 }, exit: 1, stdout: failOut(['error: no-match a.txt', 'error: no-match a.txt'], 2, 2),
});

write();
