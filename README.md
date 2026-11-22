# csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/jesshqi/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/jesshqi/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for csv-reader 1.0.0: a single-pass CSV reader that answers exactly as the reference on every case — BOM, LF/CRLF, stray CRs, quoted fields with `""` escapes, quote junk, unterminated quotes, short/long rows — at about 3× the reference's speed on the practice set (10.19 MB in ~0.43 s of CPU vs ~1.3 s). No dependencies, no network, Node 22 only.

## How it works

`solve.js` exports `run(input)` for `{text, header}` → `{columns, rows, errors}`. The scanner reads the text once, left to right:

- **Fast path:** a physical line with no quote and no stray CR is split natively (`String.split(',')`); blank lines are no record.
- **Slow path:** only lines holding a quote or a stray CR are parsed field by field, with `indexOf` jumps for commas, line breaks and closing quotes — never a per-character loop. Quoted fields handle `""` escapes and CRLF/lone-CR-inside-quotes → LF; junk after a closing quote is appended with a `quote_junk` error; a quote that never closes is literal and only that field is re-read as unquoted.

`main.ts` is the house driver: it reads every case from `cases.json`, answers each alone with `run`, and writes `answers.json`.

## Run it

```sh
MAKEFUN_INPUT_DIR=<input-dir> MAKEFUN_OUTPUT_DIR=<output-dir> node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
