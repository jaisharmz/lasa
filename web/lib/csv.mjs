export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === "\"" && text[index + 1] === "\"") {
        field += "\"";
        index++;
      } else if (char === "\"") quoted = false;
      else field += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((values) => values.some((value) => value !== ""));
  if (!header) return [];
  const names = header.map((name) => name.replace(/^﻿/, "").trim());
  return body.map((values) => Object.fromEntries(names.map((name, i) => [name, values[i] ?? ""])));
}

export function pick(row, ...names) {
  const wanted = names.map((name) => name.toLowerCase().replace(/[\s_]/g, ""));
  for (const key of Object.keys(row)) {
    if (wanted.includes(key.toLowerCase().replace(/[\s_]/g, ""))) return row[key];
  }
  return undefined;
}
