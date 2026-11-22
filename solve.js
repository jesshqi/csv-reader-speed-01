// Fast drop-in for csv-reader 1.0.0 — make.fun csv-reader-speed-01-run-20261121.
// Written from the competition's published rules (RULES.txt) and verified against
// the reference oracle as a black box (practice set + differential fuzzing).
// Single-pass scanner: a native fast path for quote-free lines, indexOf jumps
// everywhere else, no per-character loops in the hot path.

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

  // Scan one unquoted field (or quote junk) from p.
  // Returns { value, next, term } with term ',' | '\n' | 'eof'.
  // Stray CRs are dropped, one stray_cr error each (a trailing CR before the
  // LF is the CRLF line ending, not stray). Line/row of every error is the
  // record's start line / the record's row index.
  const scanUnquoted = (p, recLine, row) => {
    const comma = text.indexOf(',', p);
    const lf = text.indexOf('\n', p);
    let end = n;
    let term = 'eof';
    let next = n;
    if (comma !== -1 && (lf === -1 || comma < lf)) {
      end = comma;
      term = ',';
      next = comma + 1;
    } else if (lf !== -1) {
      end = lf;
      term = '\n';
      next = lf + 1;
    }
    let value = text.slice(p, end);
    const cr = value.indexOf('\r');
    if (cr !== -1) {
      const isCRLF = term === '\n' && value.charCodeAt(value.length - 1) === 13;
      let strays = 0;
      let idx = cr;
      while (idx !== -1) {
        strays++;
        idx = value.indexOf('\r', idx + 1);
      }
      if (isCRLF) strays--;
      for (let k = 0; k < strays; k++) errors.push({ code: 'stray_cr', line: recLine, row });
      value = value.replaceAll('\r', '');
    }
    return { value, next, term };
  };

  // Parse one record starting at i (slow path: the line holds a quote or a
  // stray CR). Advances i and line past the record.
  const parseSlow = (recLine, row) => {
    const fields = [];
    let content = false;
    let p = i;
    for (;;) {
      if (p < n && text.charCodeAt(p) === 34) {
        content = true; // the opening quote is a character of this record
        let q = text.indexOf('"', p + 1);
        while (q !== -1 && q + 1 < n && text.charCodeAt(q + 1) === 34) q = text.indexOf('"', q + 2);
        if (q === -1) {
          // A quote that never closes is literal; only this field is re-read
          // as unquoted (to its next comma or line break) — the fields and
          // records after it are read normally, quotes included.
          errors.push({ code: 'unterminated_quote', line: recLine, row });
          const r = scanUnquoted(p + 1, recLine, row);
          fields.push('"' + r.value);
          if (r.term === ',') content = true;
          p = r.next;
          if (r.term === '\n') line++;
          if (r.term !== ',') break;
          continue;
        }
        // Quoted content is [p+1, q). "" is one quote; CRLF / lone CR read as LF.
        const escAt = text.indexOf('""', p + 1);
        const hasEsc = escAt !== -1 && escAt < q;
        const nlAt = text.indexOf('\n', p + 1);
        const crAt = text.indexOf('\r', p + 1);
        const hasLB = (nlAt !== -1 && nlAt < q) || (crAt !== -1 && crAt < q);
        let val;
        if (!hasEsc && !hasLB) {
          val = text.slice(p + 1, q);
        } else {
          val = text.slice(p + 1, q);
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
        }
        // What follows the closing quote, up to the next comma or line break,
        // is appended as it stands (quote_junk, when the field ends).
        const r = scanUnquoted(q + 1, recLine, row);
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
      const r = scanUnquoted(p, recLine, row);
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
    if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
      if (seg.length !== 0) finishRecord(seg.split(','), recLine, true);
      line++;
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    parseSlow(recLine, row);
  }

  if (header && width === -1) columns = [];
  return { columns, rows, errors };
}
