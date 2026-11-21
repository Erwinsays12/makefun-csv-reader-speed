# Pembaca CSV rusak yang lebih cepat

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Erwinsays12/makefun-csv-reader-speed/rank.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Erwinsays12/makefun-csv-reader-speed/reward.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)

Entry for the [make.fun competition "Read broken CSV files faster, 21 November 2026"](https://make.fun/c/csv-reader-speed-01-run-20261121).

## What it is

A faster drop-in for csv-reader 1.0.0: `solve.js` exports `run(input)`, which
returns exactly csv-reader's answer `{columns, rows, errors}` for every
`{text, header}` — including every broken-row case (short/long rows, stray
CRs, quote junk, unterminated quotes, multi-line quoted fields, BOM) — while
reading the text much faster than the reference's one-character-at-a-time
loop. `main.ts` is the harness driver: it reads every case from
`/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.

## How it is faster

Two paths, both byte-faithful to the reference policy:

- **Fast path** — a record whose line holds no double quote has no quoted
  field, so its fields are just the line split on commas (`String.split`,
  native), with lone CRs dropped (one `stray_cr` error each). A line left
  with no characters is no record.
- **Slow path** — a record whose line holds a quote is parsed field by
  field with native scans: quoted fields run to the next non-doubled quote
  (chunks sliced whole, `""` collapsed, CR/CRLF inside read as LF), junk
  after a closing quote is appended as it stands, and a quote that never
  closes is re-read as an unquoted field starting with the quote. Unquoted
  fields find their next delimiter with a single shared regex scan.

## Local results (practice set, this machine)

- All 6 practice cases identical to csv-reader 1.0.0's answers, and to the
  kit's `practice/reference/expected.json`.
- 240 fuzzed cases drawn with the kit's own generator, plus 38 hand-written
  edge cases (empty text, lone CRs, CRLF, BOM, unterminated quotes, quote
  junk, multi-line quoted fields, short/long rows): all identical to
  csv-reader 1.0.0.
- CPU time on the practice set (6 cases, ~10.2 MB of CSV): ~131 ms median
  against ~495 ms for the house baseline — about 3.8x faster.

## Files

- `solve.js` — the entry: dependency-free ES module, `run(input)`.
- `main.ts` — the harness driver (reads `/input/cases.json`, writes
  `/output/answers.json`).
- `package.json` — `{"type": "module"}`.
- `LICENSE` — MIT.
