// Fast drop-in for csv-reader 1.0.0 — make.fun csv-reader-speed-01-run-20261121.
// Written from the competition's published rules (RULES.txt) and verified against
// the reference oracle as a black box (practice set + differential fuzzing).
// v2 (second attempt): single-pass scanner. A native fast path for quote-free
// lines; elsewhere one indexOf per field against the line end the caller
// knows, the per-field stray-CR check skipped on lines that hold none, and
// the quoted-field checks run on the sliced content (the closing-quote scan
// already reports "" escapes for free). No per-character loops anywhere.

export function run(input) {
  const text = typeof input.text === 'string' ? input.text : String(input.text ?? '');
  const header = !!input.header;
  const n = text.length;
  let i = 0;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1; // drop leading BOM

  let line = 1; // 1-based physical line at the current position
  let width = -1; // field count of the first record; -1 until seen
  let columns = null;
  const rows = [];
  const errors = [];

  // Close out a record. A line left with no characters is no record.
  const finishRecord = (fields, recLine, content) => {
    if (!content) return;
    if (width === -1) {
      width = fields.length;
      if (header) {
        columns = fields;
        return;
      }
      rows.push(fields);
      return;
    }
    const row = rows.length;
    if (fields.length < width) {
      const f = fields.length;
      while (fields.length < width) fields.push('');
      errors.push({ code: 'short_row', line: recLine, row, fields: f });
    } else if (fields.length > width) {
      const extra = fields.slice(width);
      fields.length = width;
      errors.push({ code: 'long_row', line: recLine, row, extra });
    }
    rows.push(fields);
  };

  // Scan one unquoted field (or quote junk) from p, ending at the next comma
  // or at `ve` (the line's value end: the next LF `le`, less a trailing CR
  // when the line ends CRLF). The field never crosses `ve`, so one indexOf
  // finds its end. Every CR left in the value is stray (the CRLF CR is
  // already outside it): one stray_cr error each, then dropped. When
  // `checkCR` is false the caller knows this physical line holds no stray
  // CR, so the value is returned as sliced.
  const scanUnquoted = (p, recLine, row, le, ve, checkCR) => {
    const comma = text.indexOf(',', p);
    let end;
    let term;
    let next;
    if (comma !== -1 && comma < ve) {
      end = comma;
      term = ',';
      next = comma + 1;
    } else if (le < n) {
      end = ve;
      term = '\n';
      next = le + 1;
    } else {
      end = n;
      term = 'eof';
      next = n;
    }
    let value = text.slice(p, end);
    if (checkCR) {
      const cr = value.indexOf('\r');
      if (cr !== -1) {
        let strays = 0;
        let idx = cr;
        while (idx !== -1) {
          strays++;
          idx = value.indexOf('\r', idx + 1);
        }
        for (let k = 0; k < strays; k++) errors.push({ code: 'stray_cr', line: recLine, row });
        value = value.replaceAll('\r', '');
      }
    }
    return { value, next, term };
  };

  // Parse one record starting at i (slow path: the line holds a quote or a
  // stray CR). `le0` is the next LF at or after i (or n) and `ve0` its value
  // end (less a trailing CRLF CR); `cr0` says this physical line may hold a
  // stray CR. Advances i and line past the record. `le`/`ve` track the
  // current physical line's end across quoted fields that embed line breaks;
  // `checkCR` is reset conservatively after one.
  const parseSlow = (recLine, row, le0, ve0, cr0) => {
    const fields = [];
    let content = false;
    let p = i;
    let le = le0;
    let ve = ve0;
    let checkCR = cr0;
    for (;;) {
      if (p < n && text.charCodeAt(p) === 34) {
        content = true; // the opening quote is a character of this record
        let q = text.indexOf('"', p + 1);
        let hasEsc = false;
        while (q !== -1 && q + 1 < n && text.charCodeAt(q + 1) === 34) {
          hasEsc = true;
          q = text.indexOf('"', q + 2);
        }
        if (q === -1) {
          // A quote that never closes is literal; only this field is re-read
          // as unquoted (to its next comma or line break) — the fields and
          // records after it are read normally, quotes included.
          errors.push({ code: 'unterminated_quote', line: recLine, row });
          const r = scanUnquoted(p + 1, recLine, row, le, ve, checkCR);
          fields.push('"' + r.value);
          if (r.term === ',') content = true;
          p = r.next;
          if (r.term === '\n') line++;
          if (r.term !== ',') break;
          continue;
        }
        // Quoted content is [p+1, q). "" is one quote; CRLF / lone CR read as LF.
        let val = text.slice(p + 1, q);
        const nlAt = val.indexOf('\n');
        const crAt = val.indexOf('\r');
        const hasLB = nlAt !== -1 || crAt !== -1;
        if (hasLB) val = val.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
        if (hasEsc) val = val.replaceAll('""', '"');
        if (hasLB) {
          let c = 0;
          let idx = val.indexOf('\n');
          while (idx !== -1) {
            c++;
            idx = val.indexOf('\n', idx + 1);
          }
          line += c;
        }
        // What follows the closing quote, up to the next comma or line break,
        // is appended as it stands (quote_junk, when the field ends). The
        // line end after this field is `le`, unless the content held a line
        // break (then it is the next LF past the closing quote).
        if (hasLB) {
          le = text.indexOf('\n', q + 1);
          if (le === -1) le = n;
          ve = le < n && text.charCodeAt(le - 1) === 13 ? le - 1 : le;
          checkCR = true;
        }
        const r = scanUnquoted(q + 1, recLine, row, le, ve, checkCR);
        if (r.value.length > 0) {
          val += r.value;
          errors.push({ code: 'quote_junk', line: recLine, row });
        }
        fields.push(val);
        p = r.next;
        if (r.term === '\n') line++;
        if (r.term !== ',') break;
        continue;
      }
      const r = scanUnquoted(p, recLine, row, le, ve, checkCR);
      if (r.value.length > 0) content = true;
      if (r.term === ',') content = true; // the comma is a character of this record
      fields.push(r.value);
      p = r.next;
      if (r.term === '\n') line++;
      if (r.term !== ',') break;
    }
    i = p;
    finishRecord(fields, recLine, content);
  };

  while (i < n) {
    const recLine = line;
    const row = header && width === -1 ? null : rows.length;
    // Fast path: one physical line with no quote and no stray CR.
    const nl = text.indexOf('\n', i);
    const lineEnd = nl === -1 ? n : nl;
    let segEnd = lineEnd;
    if (nl !== -1 && segEnd > i && text.charCodeAt(segEnd - 1) === 13) segEnd--; // CRLF
    const seg = text.slice(i, segEnd);
    const qAt = seg.indexOf('"');
    const crAt = seg.indexOf('\r');
    if (qAt === -1 && crAt === -1) {
      if (seg.length !== 0) {
        const f = seg.split(',');
        if (width !== -1 && f.length === width) rows.push(f);
        else finishRecord(f, recLine, true);
      }
      line++;
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    parseSlow(recLine, row, lineEnd, segEnd, crAt !== -1);
  }

  if (header && width === -1) columns = [];
  return { columns, rows, errors };
}
