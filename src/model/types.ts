export type ColumnType = "text" | "number" | "date" | "boolean" | "relation";
export type Value = string | number | boolean;
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
  columns?: Column[];
  /** Key of the column that names the instances (graph labels, link matching). */
  nameKey?: string;
  /** Running number the next instance gets; numbers are never reused. */
  nextNo?: number;
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
