/**
 * Number and date notation of the browser's locale. Cell editing and the clipboard use it
 * (without thousands separators) so values round-trip with Numbers, Sheets and Excel set
 * to the same locale. Stored values stay locale-free: numbers and ISO dates.
 */

export const browserLocale = typeof navigator !== "undefined" ? navigator.language : "en-US";
let locale = browserLocale;

/** Choices for Settings → Number and date notation ("" follows the browser). */
export const NOTATIONS = [
  ["", "Browser default"],
  ["de-DE", "German – 1.234,56 · 25.11.2026"],
  ["en-US", "English (US) – 1,234.56 · 11/25/2026"],
  ["en-GB", "English (UK) – 1,234.56 · 25/11/2026"],
] as const;
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

/** True if `t` reads as whole thousands grouped with `sep`, e.g. "1,234" or "12.345.678". */
const isGrouping = (t: string, sep: string) => new RegExp(`^-?[1-9]\\d{0,2}(\\${sep}\\d{3})+$`).test(t);

/**
 * Reads a number written with a decimal comma or point, in any locale: "0,5", "12.99", "1.234,56",
 * "1,234.56". With both marks the last one is the decimal mark. A single kind of mark only counts as
 * thousands grouping when it groups exactly like that and the locale uses the other mark as decimal,
 * so "1,234" is 1234 in English and "1.234" is 1234 in German. "12,5 %" means 0.125.
 */
export function parseNumber(s: string): number | undefined {
  const percent = /%\s*$/.test(s);
  let t = s.replace(/[%\s€$'’]/g, "");
  const [comma, dot] = [t.lastIndexOf(","), t.lastIndexOf(".")];
  let mark: string | undefined;
  if (comma >= 0 && dot >= 0) mark = comma > dot ? "," : ".";
  else if (comma >= 0) mark = decimal === "." && isGrouping(t, ",") ? undefined : ",";
  else if (dot >= 0) mark = decimal === "," && isGrouping(t, ".") ? undefined : ".";
  const group = mark === "," ? "." : mark === "." ? "," : comma >= 0 ? "," : ".";
  t = t.split(group).join("");
  if (mark === ",") t = t.replace(",", ".");
  const n = Number(t);
  return t && Number.isFinite(n) ? (percent ? Number((n / 100).toPrecision(12)) : n) : undefined;
}

export const formatNumber = (n: number) => String(n).replace(".", decimal);

/** Number formats of a column; without one, numbers show in the locale's default notation. */
export const NUMBER_FORMATS = [
  ["integer", "Integer", "1,235"],
  ["decimal2", "2 decimals", "1,234.50"],
  ["EUR", "Euro", "€1,234.50"],
  ["USD", "Dollar", "$1,234.50"],
  ["percent", "Percent", "12.5%"],
] as const;

export function displayNumber(n: number, format?: string): string {
  const options: Intl.NumberFormatOptions =
    format === "integer" ? { maximumFractionDigits: 0 }
    : format === "decimal2" ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : format === "EUR" || format === "USD" ? { style: "currency", currency: format }
    : format === "percent" ? { style: "percent", maximumFractionDigits: 2 }
    : {};
  return n.toLocaleString(locale, options);
}

/** Percent columns are edited as "12.5%" but store 0.125. */
export const formatPercent = (n: number) => `${formatNumber(Number((n * 100).toPrecision(12)))}%`;

type Part = "day" | "month" | "year";

/** Date formats of a column; without one, dates use the locale's numeric order. */
export const DATE_FORMATS = ["DD.MM.YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD/MM/YYYY", "D MMM YYYY"] as const;
const LONG = "D MMM YYYY";

/** Field order and separator of a numeric date format; the long format is edited in the locale's order. */
function pattern(format?: string): { order: Part[]; sep: string } {
  if (!format || format === LONG || !/^[DMY]+\W[DMY]+\W[DMY]+$/.test(format)) return { order: dateOrder, sep: dateSep };
  const order = format.split(/\W/).map((t): Part => (t[0] === "D" ? "day" : t[0] === "M" ? "month" : "year"));
  return { order, sep: format.match(/\W/)![0] };
}

function parseInOrder(s: string, order: Part[]): string | undefined {
  const nums = s.split(/[./-]/);
  if (nums.length !== 3 || nums.some((x) => !/^\d{1,4}$/.test(x))) return undefined;
  const p = Object.fromEntries(order.map((k, i) => [k, Number(nums[i])]));
  if (p.year < 100) p.year += 2000;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (d.getUTCMonth() !== p.month - 1 || d.getUTCDate() !== p.day) return undefined;
  return d.toISOString().slice(0, 10);
}

const DMY: Part[] = ["day", "month", "year"];

/**
 * Accepts ISO dates, the column's format and the locale's numeric order (e.g. 11/25/2026); returns ISO.
 * Dates written with dots are always day.month.year – no locale writes month first with dots.
 */
export function parseDate(s: string, format?: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s.includes(".")) return parseInOrder(s, DMY);
  return parseInOrder(s, pattern(format).order) ?? (format ? parseInOrder(s, dateOrder) : undefined);
}

/** Format for a new date column, taken from how its values are written: dots → DD.MM.YYYY, ISO → YYYY-MM-DD. */
export function guessDateFormat(values: string[]): string | undefined {
  const vs = values.map((v) => v.trim()).filter(Boolean);
  if (vs.length && vs.every((v) => v.includes("."))) return "DD.MM.YYYY";
  if (vs.length && vs.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return "YYYY-MM-DD";
  return undefined;
}

/** Editable text of an ISO date in a numeric format. */
export function formatDate(iso: string, format?: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const parts = { year: m[1], month: m[2], day: m[3] };
  const { order, sep } = pattern(format);
  return order.map((k) => parts[k]).join(sep);
}

/** Shown text of an ISO date; the long format spells out the month. */
export function displayDate(iso: string, format?: string): string {
  if (format !== LONG || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatDate(iso, format);
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Booleans: spreadsheet apps paste TRUE/FALSE; common words in English and German are accepted too.
const TRUE = /^(true|yes|y|x|1|on|ja|j|wahr)$/i;
const BOOL = /^(true|false|yes|no|y|n|1|0|on|off|ja|nein|wahr|falsch)$/i;
export const parseBoolean = (s: string) => TRUE.test(s);
export const isBoolean = (s: string) => BOOL.test(s);
export const formatBoolean = (b: boolean) => (b ? "TRUE" : "FALSE");
