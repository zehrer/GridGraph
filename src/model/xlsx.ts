/**
 * Minimal Excel (.xlsx) reader for simple tables: unzips with the browser's DecompressionStream
 * and reads cell values (shared and inline strings, numbers, booleans, dates) from the sheet XML.
 * No formulas are evaluated – Excel stores their last results, which are used. Formatting,
 * merged cells and charts are ignored.
 */

import { formatNumber } from "./locale";

export interface XlsxSheet { name: string; rows: string[][] }

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** The files of a zip archive, as a lazy text reader by path. */
function unzip(bytes: Uint8Array<ArrayBuffer>): Map<string, () => Promise<string>> {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This is not an Excel (.xlsx) file.");
  const files = new Map<string, () => Promise<string>>();
  let p = u32(bytes, eocd + 16);
  for (let n = u16(bytes, eocd + 10); n > 0 && u32(bytes, p) === 0x02014b50; n--) {
    const method = u16(bytes, p + 10);
    const size = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const local = u32(bytes, p + 42);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + u16(bytes, p + 30) + u16(bytes, p + 32);
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const data = bytes.subarray(start, start + size);
    files.set(name, async () => {
      if (method === 0) return new TextDecoder().decode(data);
      if (method !== 8) throw new Error(`Unsupported compression in ${name}`);
      const stream = new DecompressionStream("deflate-raw");
      const writer = stream.writable.getWriter();
      void writer.write(data);
      void writer.close();
      return new TextDecoder().decode(await new Response(stream.readable).arrayBuffer());
    });
  }
  return files;
}

const xml = (text: string) => new DOMParser().parseFromString(text, "application/xml");
/** Elements by local name, whatever namespace prefix the file uses. */
const all = (n: Document | Element, tag: string) => Array.from(n.getElementsByTagNameNS("*", tag));
const attr = (e: Element, name: string) => e.getAttribute(name) ?? e.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", name.replace(/^r:/, "")) ?? "";

/** Built-in number formats that show dates or times. */
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const isDateFormat = (code: string) => /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ""));

/** Excel day number (1900 system; 1899-12-30 is day 0 because of Excel's 1900 leap year bug) as "YYYY-MM-DD", with time if it has one. */
export function excelDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  const iso = d.toISOString();
  return serial % 1 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + ch.toUpperCase().charCodeAt(0) - 64;
  return n - 1;
};

/** Reads all sheets of a workbook as rows of cell texts (numbers in the locale's notation, dates as YYYY-MM-DD). */
export async function readXlsx(buffer: ArrayBuffer): Promise<XlsxSheet[]> {
  const files = unzip(new Uint8Array(buffer));
  const read = async (path: string) => (files.has(path) ? xml(await files.get(path)!()) : undefined);
  const workbook = await read("xl/workbook.xml");
  if (!workbook) throw new Error("This is not an Excel (.xlsx) file.");

  const relDoc = await read("xl/_rels/workbook.xml.rels");
  const rels = new Map(relDoc ? all(relDoc, "Relationship").map((r) => [r.getAttribute("Id")!, r.getAttribute("Target")!]) : []);
  const shared = all((await read("xl/sharedStrings.xml")) ?? xml("<sst/>"), "si").map((si) =>
    all(si, "t").filter((t) => (t.parentElement?.localName ?? "") !== "rPh").map((t) => t.textContent ?? "").join(""),
  );
  const styles = await read("xl/styles.xml");
  const custom = new Map(styles ? all(styles, "numFmt").map((f) => [Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode") ?? ""]) : []);
  const cellXfs = styles ? all(styles, "cellXfs")[0] : undefined;
  const dateStyle = (cellXfs ? all(cellXfs, "xf") : []).map((xf) => {
    const id = Number(xf.getAttribute("numFmtId") ?? 0);
    return DATE_IDS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!));
  });

  const sheets: XlsxSheet[] = [];
  for (const s of all(workbook, "sheet")) {
    const target = rels.get(attr(s, "r:id")) ?? "";
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const doc = await read(path);
    if (!doc) continue;
    const rows: string[][] = [];
    for (const r of all(doc, "row")) {
      const ri = Number(r.getAttribute("r") ?? rows.length + 1) - 1;
      const row: string[] = (rows[ri] = rows[ri] ?? []);
      all(r, "c").forEach((c, i) => {
        const ref = c.getAttribute("r");
        const ci = ref ? colIndex(ref) : i;
        const t = c.getAttribute("t") ?? "n";
        const v = all(c, "v")[0]?.textContent ?? "";
        let text: string;
        if (t === "s") text = shared[Number(v)] ?? "";
        else if (t === "inlineStr") text = all(c, "t").map((x) => x.textContent ?? "").join("");
        else if (t === "b") text = v === "1" ? "TRUE" : "FALSE";
        else if (t === "n" && v !== "" && dateStyle[Number(c.getAttribute("s") ?? 0)]) text = excelDate(Number(v));
        // Numbers in the locale's notation, so "1.234" stays 1.234 where the comma is the decimal mark.
        else if (t === "n" && v !== "" && Number.isFinite(Number(v))) text = formatNumber(Number(v));
        else text = v;
        row[ci] = text;
      });
    }
    // Empty rows are left out, as in the CSV import.
    const filled = Array.from(rows, (r) => Array.from(r ?? [], (x) => x ?? "")).filter((r) => r.some((x) => x.trim()));
    const width = Math.max(0, ...filled.map((r) => r.length));
    sheets.push({ name: s.getAttribute("name") ?? `Sheet ${sheets.length + 1}`, rows: filled.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")) });
  }
  return sheets;
}
