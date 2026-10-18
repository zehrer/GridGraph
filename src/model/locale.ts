/**
 * Number and date notation of the browser's locale. Cell editing and the clipboard use it
 * (without thousands separators) so values round-trip with Numbers, Sheets and Excel set
 * to the same locale. Stored values stay locale-free: numbers and ISO dates.
 */

let locale = typeof navigator !== "undefined" ? navigator.language : "en-US";
let decimal = ".";
let dateOrder: ("day" | "month" | "year")[] = ["month", "day", "year"];
let dateSep = "/";

/** Switches the notation; called once at startup and by tests. */
export function setLocale(tag: string) {
  locale = tag;
  decimal = (1.5).toLocaleString(tag).charAt(1);
  const parts = new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(new Date(2026, 10, 25));
  dateOrder = parts.filter((p) => p.type !== "literal").map((p) => p.type as "day" | "month" | "year");
  dateSep = parts.find((p) => p.type === "literal")?.value.trim() || "/";
}
setLocale(locale);

export function parseNumber(s: string): number | undefined {
  // Grouping separators are dropped: "1.234,5" (de) or "1,234.5" (en).
  const t = decimal === "," ? (s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s) : s.replace(/,/g, "");
  const n = Number(t);
  return t.trim() && Number.isFinite(n) ? n : undefined;
}

export const formatNumber = (n: number) => String(n).replace(".", decimal);
export const displayNumber = (n: number) => n.toLocaleString(locale);

/** Accepts ISO dates and the locale's numeric order (e.g. 25.11.2026 or 11/25/2026); returns ISO. */
export function parseDate(s: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const nums = s.split(/[./-]/);
  if (nums.length !== 3 || nums.some((x) => !/^\d{1,4}$/.test(x))) return undefined;
  const p = Object.fromEntries(dateOrder.map((k, i) => [k, Number(nums[i])]));
  if (p.year < 100) p.year += 2000;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (d.getUTCMonth() !== p.month - 1 || d.getUTCDate() !== p.day) return undefined;
  return d.toISOString().slice(0, 10);
}

export function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const parts = { year: m[1], month: m[2], day: m[3] };
  return dateOrder.map((k) => parts[k]).join(dateSep);
}

// Booleans: spreadsheet apps paste TRUE/FALSE; common words in English and German are accepted too.
const TRUE = /^(true|yes|y|x|1|on|ja|j|wahr)$/i;
const BOOL = /^(true|false|yes|no|y|n|1|0|on|off|ja|nein|wahr|falsch)$/i;
export const parseBoolean = (s: string) => TRUE.test(s);
export const isBoolean = (s: string) => BOOL.test(s);
export const formatBoolean = (b: boolean) => (b ? "TRUE" : "FALSE");
