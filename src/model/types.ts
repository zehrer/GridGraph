export type ColumnType = "text" | "number" | "date" | "boolean" | "relation";
export type Value = string | number | boolean;

export interface Column {
  key: string;
  label: string;
  type: ColumnType;
  /** For relation columns: the type whose instances can be referenced. */
  targetTypeId?: string;
}

/**
 * A node is either a base type (`isType`, owns the column schema) or an
 * instance (`typeId` points to its type). Instances may carry properties
 * that no column declares — the schema is only a hint.
 */
export interface GraphNode {
  id: string;
  label: string;
  isType?: boolean;
  typeId?: string;
  color?: string;
  columns?: Column[];
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
