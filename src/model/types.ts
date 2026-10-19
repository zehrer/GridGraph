/** "formula" columns compute their values from `formula`; nothing is stored in the rows. */
export type ColumnType = "text" | "number" | "date" | "boolean" | "relation" | "formula";
/** A link cell holds one node id, or several as an array. */
export type Value = string | number | boolean | string[];
/** Conditions of a column filter; `a`/`b` are the user's input (b only for "between"). */
export type FilterOp = "empty" | "notEmpty" | "contains" | "notContains" | "startsWith" | "endsWith" | "equals" | "gt" | "gte" | "lt" | "lte" | "between";

/** Excel-style column filter: rows pass when their value is in `values` (if set) and meets `condition` (if set). */
export interface ColumnFilter {
  /** Allowed values as canonical keys (see filter.ts); "" stands for blanks. */
  values?: string[];
  condition?: { op: FilterOp; a?: string; b?: string };
}

/**
 * Toolbar quick filter: shows the rows whose value in a column matches, browsable with ‹ ›.
 * `value` is "2026" (year), "2026-05" (month), a number (number columns), a node id (link
 * columns: rows linking to it) or a text (text columns).
 */
export interface QuickFilter { key: string; unit: "year" | "month" | "number" | "link" | "text"; value: string }

/** Sort order of a sheet; key "" sorts by ID. */
export interface SortOrder { key: string; asc: boolean }

/** A named filter view of a sheet: filters, visible columns in order, and sort. */
export interface SavedView {
  id: string;
  name: string;
  /** Keys of the visible columns, in display order; other columns are hidden. */
  columns: string[];
  filters: Record<string, ColumnFilter>;
  sort?: SortOrder;
  quick?: QuickFilter;
}

/** Aggregate shown in the sheet footer. */
export type Summary = "sum" | "avg" | "min" | "max" | "count" | "empty";

export interface Column {
  key: string;
  label: string;
  type: ColumnType;
  /** For relation columns: the type whose instances can be referenced. */
  targetTypeId?: string;
  /** Display options of the sheet. */
  width?: number;
  hidden?: boolean;
  wrap?: boolean;
  summary?: Summary;
  /** Date format (e.g. "DD.MM.YYYY") or number format (e.g. "EUR"); see locale.ts. */
  format?: string;
  /** For formula columns, e.g. "AGE([Birthday])"; see formula.ts. */
  formula?: string;
}

/**
 * A node is either a base type (`isType`, owns the column schema) or an
 * instance (`typeId` points to its type). Instances may carry properties
 * that no column declares — the schema is only a hint.
 */
export interface GraphNode {
  id: string;
  /** Name of a type. Instances take their name from the type's name column; only untyped (imported) nodes use it. */
  label?: string;
  isType?: boolean;
  typeId?: string;
  color?: string;
  // Types only:
  /** Hidden sheet (e.g. a lookup table): not among the tabs, left out of the graph by default. */
  hiddenSheet?: boolean;
  columns?: Column[];
  /** Key of the column that names the instances (graph labels, link matching). */
  nameKey?: string;
  /** Running number the next instance gets; numbers are never reused. */
  nextNo?: number;
  /** Whether the sheet shows filter buttons, and the active column filters by column key. */
  filterOn?: boolean;
  filters?: Record<string, ColumnFilter>;
  /** Saved filter views, and the one last applied (to show when it was changed since). */
  views?: SavedView[];
  activeView?: string;
  quickFilter?: QuickFilter;
  // Instances only:
  /** ID shown in the sheet: running number per type, assigned on creation. */
  no?: number;
  props: Record<string, Value>;
}

/** Free edges drawn in the graph view. typeOf and relation-column edges are derived. */
export interface Edge {
  id: string;
  source: string;
  target: string;
  relation: string;
}

export interface Graph {
  nodes: Record<string, GraphNode>;
  edges: Record<string, Edge>;
}

export interface DerivedEdge extends Edge {
  kind: "typeOf" | "column" | "free";
  /** For column edges: the column key that holds the reference. */
  colKey?: string;
}
