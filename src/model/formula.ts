/**
 * Formula columns: a small, safe expression language (no eval) evaluated per row.
 *
 *   AGE([Birthday])            [Deadline] - TODAY()          [Name] & " (" & [City] & ")"
 *   IF([Age] >= 40, "senior", "junior")                       ROUND([Budget] * 1.19, 2)
 *   [Employer].[City]          SUM([Client].[Employees])     COUNT([Lead])
 *
 * Columns are referenced by their label in brackets; `.[Column]` follows a link column to the
 * linked rows. Arguments are separated by "," or ";" — with ";" a comma inside numbers is a
 * decimal comma (as in German Excel). Results are computed when shown, never stored.
 */
import { columnsOf, linkIds, nodeName } from "./graph";
import { formatBoolean, formatDate, formatNumber, parseDate, parseNumber } from "./locale";
import type { Column, ColumnType, Graph, GraphNode, Value } from "./types";

// --- Values at runtime ---

/** A date as days since 1970-01-01 (UTC). */
class DateV {
  constructor(readonly days: number) {}
  static of(iso: string) {
    return new DateV(Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000));
  }
  get iso() {
    return new Date(this.days * 86_400_000).toISOString().slice(0, 10);
  }
  get parts() {
    const d = new Date(this.days * 86_400_000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
}
/** Linked rows, from a link column. */
class Links {
  constructor(readonly ids: string[]) {}
}
type RV = number | string | boolean | DateV | Links | RV[] | null;

export class FormulaError extends Error {}
const fail = (msg: string): never => {
  throw new FormulaError(msg);
};

// --- Parsing ---

type Tok = { t: "num"; v: number } | { t: "str" | "col" | "id" | "op"; v: string };
type Ast =
  | { k: "lit"; v: RV }
  | { k: "col"; name: string }
  | { k: "path"; base: Ast; name: string }
  | { k: "call"; name: string; args: Ast[] }
  | { k: "neg"; a: Ast }
  | { k: "bin"; op: string; a: Ast; b: Ast };

function tokenize(src: string): Tok[] {
  // With ";" as argument separator, a comma between digits is a decimal comma.
  const semicolons = /;/.test(src.replace(/"(?:[^"]|"")*"/g, ""));
  const toks: Tok[] = [];
  let i = src.trimStart().startsWith("=") ? src.indexOf("=") + 1 : 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\s+/))) i += m[0].length;
    else if ((m = rest.match(semicolons ? /^\d+(?:[.,]\d+)?/ : /^\d+(?:\.\d+)?/))) {
      toks.push({ t: "num", v: Number(m[0].replace(",", ".")) });
      i += m[0].length;
    } else if (rest[0] === '"') {
      const end = rest.slice(1).search(/"(?!")/);
      if (end < 0) fail("A text is missing its closing quote");
      toks.push({ t: "str", v: rest.slice(1, end + 1).replace(/""/g, '"') });
      i += end + 2;
    } else if (rest[0] === "[") {
      const end = rest.indexOf("]");
      if (end < 0) fail("A column reference is missing its closing ]");
      toks.push({ t: "col", v: rest.slice(1, end).trim() });
      i += end + 1;
    } else if ((m = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/))) {
      toks.push({ t: "id", v: m[0].toUpperCase() });
      i += m[0].length;
    } else if ((m = rest.match(/^(<=|>=|<>|!=|[-+*/&=<>(),.;])/))) {
      toks.push({ t: "op", v: m[0] === "!=" ? "<>" : m[0] });
      i += m[0].length;
    } else fail(`Unexpected "${rest[0]}"`);
  }
  return toks;
}

function parse(src: string): Ast {
  const toks = tokenize(src);
  let p = 0;
  const peek = (v?: string): string | undefined => {
    const tok = toks[p];
    return tok?.t === "op" && (v === undefined || tok.v === v) ? tok.v : undefined;
  };
  const take = (v: string) => (peek(v) ? (p++, true) : false);

  const binary = (next: () => Ast, ops: string[]) => (): Ast => {
    let a = next();
    for (let op = peek(); op && ops.includes(op); op = peek()) {
      p++;
      a = { k: "bin", op, a, b: next() };
    }
    return a;
  };
  const primary = (): Ast => {
    const tok = toks[p++];
    if (!tok) return fail("The formula ends too early");
    if (tok.t === "num") return { k: "lit", v: tok.v };
    if (tok.t === "str") return { k: "lit", v: tok.v };
    if (tok.t === "col") return { k: "col", name: tok.v };
    if (tok.t === "id") {
      if (tok.v === "TRUE" || tok.v === "FALSE") return { k: "lit", v: tok.v === "TRUE" };
      if (!take("(")) return fail(`Unknown name ${tok.v} – use [${tok.v}] for a column`);
      const args: Ast[] = [];
      if (!take(")")) {
        do args.push(expr());
        while (take(",") || take(";"));
        if (!take(")")) fail(`Missing ) after the arguments of ${tok.v}`);
      }
      return { k: "call", name: tok.v, args };
    }
    if (tok.v === "(") {
      const e = expr();
      if (!take(")")) fail("Missing )");
      return e;
    }
    return fail(`Unexpected "${tok.v}"`);
  };
  const postfix = (): Ast => {
    let a = primary();
    while (take(".")) {
      const tok = toks[p++];
      if (tok?.t !== "col") fail("Expected [Column] after the dot");
      a = { k: "path", base: a, name: tok.v as string };
    }
    return a;
  };
  const unary = (): Ast => (take("-") ? { k: "neg", a: unary() } : take("+") ? unary() : postfix());
  const mult = binary(unary, ["*", "/"]);
  const add = binary(mult, ["+", "-"]);
  const concat = binary(add, ["&"]);
  const expr = binary(concat, ["=", "<>", "<", ">", "<=", ">="]);

  const ast = expr();
  if (p < toks.length) fail(`Unexpected "${(toks[p] as { v: unknown }).v}"`);
  return ast;
}

const parsed = new Map<string, Ast | FormulaError>();
function compile(src: string): Ast {
  if (!parsed.has(src)) {
    try {
      parsed.set(src, parse(src));
    } catch (e) {
      parsed.set(src, e instanceof FormulaError ? e : new FormulaError(String(e)));
    }
  }
  const r = parsed.get(src)!;
  if (r instanceof FormulaError) throw r;
  return r;
}

// --- Evaluation ---

interface Ctx { g: Graph; stack: Set<string> }

/** Columns by label (case-insensitive) per type; cached per graph version. */
const columnCache = new WeakMap<Graph, Map<string, Map<string, Column>>>();
function columnByLabel(g: Graph, typeId: string, label: string): Column | undefined {
  let byType = columnCache.get(g);
  if (!byType) columnCache.set(g, (byType = new Map()));
  let cols = byType.get(typeId);
  if (!cols) byType.set(typeId, (cols = new Map(columnsOf(g, typeId).map((c) => [c.label.toLowerCase(), c]))));
  return cols.get(label.toLowerCase());
}

function columnValue(ctx: Ctx, node: GraphNode, label: string): RV {
  const col = node.typeId ? columnByLabel(ctx.g, node.typeId, label) : undefined;
  if (!col) return fail(`Unknown column [${label}]`);
  if (col.type === "formula") {
    const key = `${node.id}:${col.key}`;
    if (ctx.stack.has(key)) fail(`[${label}] refers to itself`);
    ctx.stack.add(key);
    try {
      return evaluate(compile(col.formula ?? ""), ctx, node);
    } finally {
      ctx.stack.delete(key);
    }
  }
  const v = node.props[col.key];
  if (v === undefined || v === "") return null;
  if (col.type === "relation") return new Links(linkIds(v).filter((id) => ctx.g.nodes[id]));
  if (col.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return DateV.of(v);
  return Array.isArray(v) ? v : v;
}

/** Items of lists and links, flattened; empty values dropped. */
const items = (vs: RV[]): RV[] => vs.flatMap((v) => (Array.isArray(v) ? items(v) : v instanceof Links ? v.ids : v === null || v === "" ? [] : [v]));

function toNum(v: RV): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null) return 0;
  if (v instanceof DateV) return v.days;
  if (typeof v === "string") return parseNumber(v) ?? fail(`"${v}" is not a number`);
  const list = items([v]);
  return list.length === 1 ? toNum(list[0]) : fail("Several values – use SUM(), MIN() or COUNT()");
}

function toDate(v: RV): DateV {
  if (v instanceof DateV) return v;
  if (typeof v === "string") {
    const iso = parseDate(v);
    if (iso) return DateV.of(iso);
  }
  if (Array.isArray(v) && items(v).length === 1) return toDate(items(v)[0]);
  return fail(`${v === null ? "An empty value" : `"${toText(v)}"`} is not a date`);
}

function toText(v: RV, g?: Graph): string {
  if (v === null) return "";
  if (typeof v === "number") return formatNumber(Number(v.toPrecision(12)));
  if (typeof v === "boolean") return formatBoolean(v);
  if (v instanceof DateV) return formatDate(v.iso);
  if (v instanceof Links) return v.ids.map((id) => (g?.nodes[id] ? nodeName(g, g.nodes[id]) : id)).join(", ");
  if (Array.isArray(v)) return items(v).map((x) => toText(x, g)).join(", ");
  return v;
}

const toBool = (v: RV): boolean => (typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : v !== null && v !== "" && !/^false$/i.test(toText(v)));

function compare(a: RV, b: RV): number {
  if (a instanceof DateV || b instanceof DateV) return toDate(a).days - toDate(b).days;
  const [x, y] = [typeof a === "number" ? a : typeof a === "string" ? parseNumber(a) : undefined, typeof b === "number" ? b : typeof b === "string" ? parseNumber(b) : undefined];
  if (x !== undefined && y !== undefined && (typeof a === "number" || typeof b === "number")) return x - y;
  return toText(a).localeCompare(toText(b), undefined, { sensitivity: "accent" });
}

function datedif(a: DateV, b: DateV, unit: string): number {
  const [s, e] = [a.parts, b.parts];
  const months = (e.y - s.y) * 12 + (e.m - s.m) - (e.d < s.d ? 1 : 0);
  if (unit === "D") return b.days - a.days;
  if (unit === "M") return months;
  if (unit === "Y") return Math.floor(months / 12);
  return fail('DATEDIF unit must be "Y", "M" or "D"');
}

const today = () => {
  const d = new Date();
  return DateV.of(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
};

const nums = (vs: RV[]) => items(vs).map(toNum);

function call(name: string, args: Ast[], ctx: Ctx, node: GraphNode): RV {
  const ev = (i: number) => (args[i] ? evaluate(args[i], ctx, node) : null);
  const all = () => args.map((_, i) => ev(i));
  const need = (n: number) => args.length < n && fail(`${name} needs ${n} argument${n > 1 ? "s" : ""}`);
  switch (name) {
    case "IF":
      need(2);
      return toBool(ev(0)) ? ev(1) : ev(2);
    case "AND":
      return args.every((_, i) => toBool(ev(i)));
    case "OR":
      return args.some((_, i) => toBool(ev(i)));
    case "NOT":
      need(1);
      return !toBool(ev(0));
    case "ROUND": {
      need(1);
      const f = 10 ** (args[1] ? toNum(ev(1)) : 0);
      return Math.round(toNum(ev(0)) * f) / f;
    }
    case "ABS":
      need(1);
      return Math.abs(toNum(ev(0)));
    case "SUM":
      return nums(all()).reduce((a, b) => a + b, 0);
    case "AVERAGE": {
      const n = nums(all());
      return n.length ? n.reduce((a, b) => a + b, 0) / n.length : fail("AVERAGE of no values");
    }
    case "MIN":
    case "MAX": {
      const vs = items(all());
      if (!vs.length) return null;
      if (vs.some((v) => v instanceof DateV)) {
        const ds = vs.map(toDate).map((d) => d.days);
        return new DateV(name === "MIN" ? Math.min(...ds) : Math.max(...ds));
      }
      return name === "MIN" ? Math.min(...vs.map(toNum)) : Math.max(...vs.map(toNum));
    }
    case "COUNT":
      return items(all()).length;
    case "TODAY":
      return today();
    case "YEAR":
    case "MONTH":
    case "DAY": {
      need(1);
      const p = toDate(ev(0)).parts;
      return name === "YEAR" ? p.y : name === "MONTH" ? p.m : p.d;
    }
    case "DATEDIF":
      need(3);
      return datedif(toDate(ev(0)), toDate(ev(1)), toText(ev(2)).toUpperCase());
    case "AGE": {
      need(1);
      const v = ev(0);
      return v === null ? null : datedif(toDate(v), today(), "Y");
    }
    case "LEN":
      need(1);
      return toText(ev(0), ctx.g).length;
    case "UPPER":
    case "LOWER": {
      need(1);
      const t = toText(ev(0), ctx.g);
      return name === "UPPER" ? t.toUpperCase() : t.toLowerCase();
    }
    case "CONCAT":
      return all().map((v) => toText(v, ctx.g)).join("");
    default:
      return fail(`Unknown function ${name}`);
  }
}

function evaluate(ast: Ast, ctx: Ctx, node: GraphNode): RV {
  switch (ast.k) {
    case "lit":
      return ast.v;
    case "col":
      return columnValue(ctx, node, ast.name);
    case "path": {
      const base = evaluate(ast.base, ctx, node);
      if (base === null) return null;
      if (!(base instanceof Links)) return fail(`Only link columns can be followed with .[${ast.name}]`);
      const vs = base.ids.map((id) => columnValue(ctx, ctx.g.nodes[id], ast.name));
      // Following links again yields one combined set of links.
      if (vs.every((v) => v instanceof Links || v === null)) return new Links([...new Set(vs.flatMap((v) => (v instanceof Links ? v.ids : [])))]);
      return vs.length === 1 ? vs[0] : vs;
    }
    case "call":
      return call(ast.name, ast.args, ctx, node);
    case "neg":
      return -toNum(evaluate(ast.a, ctx, node));
    case "bin": {
      const [a, b] = [evaluate(ast.a, ctx, node), evaluate(ast.b, ctx, node)];
      switch (ast.op) {
        case "&":
          return toText(a, ctx.g) + toText(b, ctx.g);
        case "+":
        case "-": {
          if (a instanceof DateV && b instanceof DateV) return ast.op === "-" ? a.days - b.days : fail("Dates cannot be added");
          if (a instanceof DateV) return new DateV(a.days + (ast.op === "+" ? 1 : -1) * toNum(b));
          if (b instanceof DateV && ast.op === "+") return new DateV(b.days + toNum(a));
          return ast.op === "+" ? toNum(a) + toNum(b) : toNum(a) - toNum(b);
        }
        case "*":
          return toNum(a) * toNum(b);
        case "/":
          return toNum(b) === 0 ? fail("Division by zero") : toNum(a) / toNum(b);
        default: {
          const c = compare(a, b);
          return { "=": c === 0, "<>": c !== 0, "<": c < 0, ">": c > 0, "<=": c <= 0, ">=": c >= 0 }[ast.op]!;
        }
      }
    }
  }
}

// --- Public API ---

export interface Computed {
  value?: Value;
  /** How to show the value (a formula yields numbers, dates, text, yes/no or links). */
  type: ColumnType;
  error?: string;
}

/** Evaluates a formula for one row. */
export function computeFormula(g: Graph, node: GraphNode, formula: string): Computed {
  if (!formula.trim() || formula.trim() === "=") return { type: "text" };
  try {
    const v = evaluate(compile(formula), { g, stack: new Set() }, node);
    if (v === null) return { type: "text" };
    if (typeof v === "number") return Number.isFinite(v) ? { value: Number(v.toPrecision(12)), type: "number" } : { type: "text", error: "Not a number" };
    if (typeof v === "boolean") return { value: v, type: "boolean" };
    if (v instanceof DateV) return { value: v.iso, type: "date" };
    if (v instanceof Links) return { value: v.ids.length > 1 ? v.ids : v.ids[0], type: "relation" };
    if (Array.isArray(v)) {
      const list = items(v);
      if (list.length && list.every((x) => typeof x === "number")) return { value: list.map((x) => toText(x)).join(", "), type: "text" };
      return { value: toText(v, g), type: "text" };
    }
    return { value: v, type: "text" };
  } catch (e) {
    return { type: "text", error: e instanceof FormulaError ? e.message : String(e) };
  }
}

/** Value of a cell: stored, or computed for formula columns. */
export function cellValue(g: Graph, node: GraphNode, col: Column): Value | undefined {
  return col.type === "formula" ? computeFormula(g, node, col.formula ?? "").value : node.props[col.key];
}

/** The column as it should be displayed for this row's value (formula columns take their result's type). */
export function shownColumn(g: Graph, node: GraphNode, col: Column): { col: Column; value?: Value; error?: string } {
  if (col.type !== "formula") return { col, value: node.props[col.key] };
  const r = computeFormula(g, node, col.formula ?? "");
  const format = col.format ?? (r.type === "number" && node.typeId ? formulaFormat(g, node.typeId, col) : undefined);
  return { col: { ...col, type: r.type, format }, value: r.value, error: r.error };
}

// --- Number format of formula results ---

/** The number format a column's values are shown in: its own, or for formulas the inferred one. */
export const numberFormat = (g: Graph, typeId: string | undefined, col: Column): string | undefined =>
  col.type === "formula" && typeId ? formulaFormat(g, typeId, col) : col.format;

/** Functions whose result has the format of their (value) arguments. */
const KEEPS_FORMAT = new Set(["SUM", "AVERAGE", "MIN", "MAX", "ROUND", "ABS"]);

/**
 * The number format a formula's result inherits from the columns it calculates with, like in
 * spreadsheets: € + € = €, € * 1.19 = €, € / COUNT(…) = €, € / € = plain, COUNT(…) = plain.
 * Different formats (€ + $) give none. An explicit column format always wins.
 */
export function formulaFormat(g: Graph, typeId: string, col: Column): string | undefined {
  if (col.format) return col.format;
  let byCol = formatCache.get(g);
  if (!byCol) formatCache.set(g, (byCol = new Map()));
  const key = `${typeId}:${col.key}`;
  if (byCol.has(key)) return byCol.get(key) ?? undefined;
  byCol.set(key, null); // guards against formulas that refer to each other
  let format: string | undefined;
  try {
    format = astFormat(g, typeId, compile(col.formula ?? ""));
  } catch {
    format = undefined;
  }
  byCol.set(key, format ?? null);
  return format;
}
const formatCache = new WeakMap<Graph, Map<string, string | null>>();

/** Format of a column's numbers; formula columns contribute their inferred format. */
function columnFormat(g: Graph, typeId: string, col: Column): string | undefined {
  if (col.type === "number") return col.format;
  if (col.type === "formula") return formulaFormat(g, typeId, col);
  return undefined;
}

/** Type id an expression's links point to (for `.[Column]`), if it is a link. */
function linkTarget(g: Graph, typeId: string, ast: Ast): string | undefined {
  if (ast.k === "col") {
    const c = columnByLabel(g, typeId, ast.name);
    return c?.type === "relation" ? c.targetTypeId : undefined;
  }
  if (ast.k === "path") {
    const base = linkTarget(g, typeId, ast.base);
    return base ? linkTarget(g, base, { k: "col", name: ast.name }) : undefined;
  }
  return undefined;
}

function astFormat(g: Graph, typeId: string, ast: Ast): string | undefined {
  const same = (a?: string, b?: string) => (a && b && a !== b ? undefined : (a ?? b));
  switch (ast.k) {
    case "lit":
      return undefined;
    case "col": {
      const c = columnByLabel(g, typeId, ast.name);
      return c ? columnFormat(g, typeId, c) : undefined;
    }
    case "path": {
      const target = linkTarget(g, typeId, ast.base);
      const c = target ? columnByLabel(g, target, ast.name) : undefined;
      return target && c ? columnFormat(g, target, c) : undefined;
    }
    case "neg":
      return astFormat(g, typeId, ast.a);
    case "call": {
      const args = ast.name === "IF" ? ast.args.slice(1, 3) : ast.name === "ROUND" ? ast.args.slice(0, 1) : ast.args;
      if (!KEEPS_FORMAT.has(ast.name) && ast.name !== "IF") return undefined;
      const formats = args.map((x) => astFormat(g, typeId, x));
      return formats.reduce<string | undefined>((a, b) => same(a, b), undefined);
    }
    case "bin": {
      const [a, b] = [astFormat(g, typeId, ast.a), astFormat(g, typeId, ast.b)];
      if (ast.op === "+" || ast.op === "-") return same(a, b);
      // € * 1.19 keeps €; € / 3 keeps €; € / € or € * € are plain.
      if (ast.op === "*") return a && b ? undefined : (a ?? b);
      if (ast.op === "/") return b ? undefined : a;
      return undefined;
    }
  }
}

/** Rewrites references to a renamed column, e.g. [Geburtstag] → [Birthday]. */
export function renameReference(formula: string, from: string, to: string): string {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return formula.replace(new RegExp(`\\[\\s*${esc}\\s*\\]`, "gi"), `[${to}]`);
}

export const FUNCTIONS = "IF, AND, OR, NOT, ROUND, ABS, SUM, AVERAGE, MIN, MAX, COUNT, TODAY, YEAR, MONTH, DAY, DATEDIF, AGE, LEN, UPPER, LOWER, CONCAT";
