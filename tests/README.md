# mend adversarial spec suite

Checks for sentences of `../SPEC.md` that the public practice set does not exercise. Same schema as the practice
set (`{"schema", "checks": [{key, group, family, argv, stdin, files, expect: {exit, stdout, changes}}]}`), so each
file runs with the kit's checker:

    node check.ts tests/spec-unified.json      # also: spec-sr, spec-v4a, spec-json, spec-cli, spec-output

- `family` names the SPEC sentence a check targets (`s6-...` = section 6, `s3-...` = section 3, and so on).
- `note` (extra field, ignored by check.ts) explains a hand-chosen reading wherever the sentence is ambiguous.
  Notes containing `AMBIGUOUS` mark the least certain expectations.
- Every expected exit code, stdout and file was derived by hand from SPEC.md, not by running `main.ts`.
- Checks avoid file names that differ only by case (they would collide on case-insensitive file systems).

`spec-cli.json` covers section 1/2/4 (option parsing, usage / no-patch / format / parse priority, `--check`,
`--strict`, format detection); `spec-output.json` covers the output format (ordering, counts, `R` rules, error
lines). The other files are one per format (sections 5-9 plus the section 3 and 10 sentences that apply to them).

`gen/*.mjs` (with `lib.mjs`) generate the JSON files: `for g in tests/gen/*.mjs; do node $g; done`. Edit the
generators, not the JSON.
