// A faster drop-in for csv-reader 1.0.0: returns exactly csv-reader's answer
// {columns, rows, errors} for every {text, header}, but reads the text with
// native scans instead of one character at a time.
//
// Two paths, both byte-faithful to the reference policy:
//  - Fast path: a record whose line holds no double quote has no quoted field,
//    so its fields are just the line split on commas, with lone CRs dropped
//    (one stray_cr error each). A line with no characters is no record.
//  - Slow path: a record whose line holds a quote is parsed field by field
//    with indexOf scans: quoted fields run to the next non-doubled quote
//    (chunks sliced whole, "" collapsed, CR/CRLF inside read as LF),
//    junk after a closing quote is appended as it stands, and a quote that
//    never closes is re-read as an unquoted field starting with the quote.
//
// Original work, written for this competition. No dependencies.

const COMMA = 0;
const BREAK = 1;
const END = 2;

/** The next field delimiter: a comma, a line feed or a carriage return. One
 *  shared regex (never re-entered: the field readers call each other only
 *  in sequence), its lastIndex set before every search. */
const DELIM = /[,\n\r]/g;

/** Count the line breaks inside a quoted chunk and turn its CRs into LF.
 *  Returns [value, breaks]: one break per LF, per CRLF and per lone CR. */
function convertChunk(s) {
  const cr = s.indexOf('\r');
  if (cr === -1) {
    const nl = s.indexOf('\n');
    if (nl === -1) return [s, 0];
    let b = 0;
    for (let i = nl; i !== -1; i = s.indexOf('\n', i + 1)) b++;
    return [s, b];
  }
  let out = '';
  let b = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 13) {
      out += s.slice(start, i) + '\n';
      b++;
      if (s.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
    } else if (c === 10) {
      b++;
    }
  }
  out += s.slice(start);
  return [out, b];
}

/**
 * Read one unquoted field starting at pos (the field's first character).
 * `value` is what the field holds so far ('' normally, the quoted content
 * when reading junk after a closing quote, '"' when re-reading an
 * unterminated quote). Returns {value, added, ended, pos, line}: added is
 * how many characters this read kept, ended is COMMA, BREAK or END.
 */
function readUnquoted(text, pos, line, errors, recordLine, recordRow, value) {
  const len = text.length;
  let added = 0;
  let start = pos;
  while (pos < len) {
    DELIM.lastIndex = pos;
    const m = DELIM.exec(text);
    if (m === null) break;
    const d = m.index;
    const kind = m[0] === ',' ? COMMA : m[0] === '\n' ? BREAK : 2;
    if (kind === COMMA) {
      value += text.slice(start, d);
      added += d - start;
      return { value, added, ended: COMMA, pos: d + 1, line };
    }
    if (kind === BREAK) {
      value += text.slice(start, d);
      added += d - start;
      return { value, added, ended: BREAK, pos: d + 1, line: line + 1 };
    }
    // A CR: CRLF ends the field as a line break, a lone CR is dropped.
    if (text.charCodeAt(d + 1) === 10) {
      value += text.slice(start, d);
      added += d - start;
      return { value, added, ended: BREAK, pos: d + 2, line: line + 1 };
    }
    errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
    value += text.slice(start, d);
    added += d - start;
    pos = d + 1;
    start = d + 1;
  }
  value += text.slice(start, len);
  added += len - start;
  return { value, added, ended: END, pos: len, line };
}

/**
 * Read one quoted field whose opening quote is at pos. Returns the same
 * shape as readUnquoted.
 */
function readQuoted(text, pos, line, errors, recordLine, recordRow) {
  const open = pos;
  const openLine = line;
  pos += 1;
  let parts = null;
  let chunkStart = pos;
  let closed = false;
  while (true) {
    const q = text.indexOf('"', pos);
    if (q === -1) break;
    if (text.charCodeAt(q + 1) === 34) {
      // A doubled quote: one quote in the value, and the field goes on.
      const r = convertChunk(text.slice(chunkStart, q));
      line += r[1];
      if (parts === null) parts = [r[0]];
      else parts.push(r[0]);
      parts.push('"');
      pos = q + 2;
      chunkStart = pos;
      continue;
    }
    const r = convertChunk(text.slice(chunkStart, q));
    line += r[1];
    const value = parts === null ? r[0] : parts.join('') + r[0];
    pos = q + 1;
    closed = true;
    const len = text.length;
    if (pos >= len) return { value, added: 0, ended: END, pos, line };
    const c = text.charCodeAt(pos);
    if (c === 44) return { value, added: 0, ended: COMMA, pos: pos + 1, line };
    if (c === 10) return { value, added: 0, ended: BREAK, pos: pos + 1, line: line + 1 };
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      return { value, added: 0, ended: BREAK, pos: pos + 2, line: line + 1 };
    }
    // What follows the closing quote is appended as it stands.
    const junk = readUnquoted(text, pos, line, errors, recordLine, recordRow, value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }
  // The quote never closes: it is a literal character, and the text after it
  // is read again as unquoted.
  errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
  return readUnquoted(text, open + 1, openLine, errors, recordLine, recordRow, '"');
}

/**
 * Parse one record that holds a quote, starting at pos. Returns
 * {fields, firstQuoted, pos, line} at the character after the record.
 */
function readRecordSlow(text, pos, line, errors, recordLine, recordRow) {
  const fields = [];
  let firstQuoted = false;
  let first = true;
  for (;;) {
    let f;
    if (text.charCodeAt(pos) === 34) {
      if (first) firstQuoted = true;
      f = readQuoted(text, pos, line, errors, recordLine, recordRow);
    } else {
      f = readUnquoted(text, pos, line, errors, recordLine, recordRow, '');
    }
    first = false;
    fields.push(f.value);
    pos = f.pos;
    line = f.line;
    if (f.ended !== COMMA) break;
  }
  return { fields, firstQuoted, pos, line };
}

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  while (pos < len) {
    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? len : nl;
    const q = text.indexOf('"', pos);

    let fields;
    let firstQuoted = false;
    if (q !== -1 && q < lineEnd) {
      const r = readRecordSlow(text, pos, line, errors, recordLine, recordRow);
      fields = r.fields;
      firstQuoted = r.firstQuoted;
      pos = r.pos;
      line = r.line;
    } else {
      // No quote on this line: no quoted field, so split on commas.
      let seg = text.slice(pos, lineEnd);
      if (nl !== -1 && seg.charCodeAt(seg.length - 1) === 13) seg = seg.slice(0, -1);
      if (seg === '') {
        // A line left with no characters is no record.
        pos = lineEnd + 1;
        line += 1;
        continue;
      }
      fields = seg.split(',');
      // A CR left in the line (the CRLF's own was stripped above) is a
      // stray one: drop it, one stray_cr error each, in field order.
      if (seg.indexOf('\r') !== -1) {
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i];
          if (f.indexOf('\r') !== -1) {
            const parts = f.split('\r');
            for (let k = 1; k < parts.length; k++) {
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            }
            fields[i] = parts.join('');
          }
        }
      }
      pos = lineEnd + 1;
      line += 1;
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !firstQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
