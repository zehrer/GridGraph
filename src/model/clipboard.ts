/**
 * Clipboard formats shared with Numbers, Google Sheets and Excel:
 * tab-separated text (quoted cells for tabs/newlines) and an HTML <table>.
 */

export type Matrix = string[][];

const quote = (s: string) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export const toTSV = (m: Matrix) => m.map((row) => row.map(quote).join("\t")).join("\n");

const esc = (s: string) => s.replace(/[&<>]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt" }[c]};`);
export const toHTML = (m: Matrix) =>
  `<table>${m.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;

export function parseTSV(text: string): Matrix {
  const rows: Matrix = [[]];
  let cell = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && cell === "") {
      // Quoted cell: runs to the closing quote; "" is an escaped quote.
      for (i++; i < text.length; i++) {
        if (text[i] === '"' && text[i + 1] === '"') (cell += '"'), i++;
        else if (text[i] === '"') break;
        else cell += text[i];
      }
    } else if (ch === "\t") {
      rows.at(-1)!.push(cell);
      cell = "";
    } else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
      if (ch === "\r") i++;
      rows.at(-1)!.push(cell);
      cell = "";
      rows.push([]);
    } else cell += ch;
  }
  rows.at(-1)!.push(cell);
  // A trailing newline leaves one empty cell behind.
  if (rows.length > 1 && rows.at(-1)!.join("") === "") rows.pop();
  return rows;
}

function parseHTML(html: string): Matrix | null {
  const table = new DOMParser().parseFromString(html, "text/html").querySelector("table");
  if (!table) return null;
  return [...table.querySelectorAll("tr")].map((tr) =>
    [...tr.querySelectorAll("td, th")].flatMap((td) => {
      // innerText is not available in detached documents; keep <br> as newlines.
      td.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      const text = (td.textContent ?? "").replace(/ /g, " ").trim();
      return Array(Number(td.getAttribute("colspan")) || 1).fill("").map((_, i) => (i ? "" : text));
    }),
  );
}

/** Prefers the HTML table (keeps multi-line cells intact), falls back to plain text. */
export const parseClipboard = (html: string, text: string): Matrix => (html && parseHTML(html)) || parseTSV(text);
