/**
 * The meta model: types, their properties (columns) and the relations between types that link
 * columns define. Derived from the data – there is nothing extra to keep in sync.
 */
import { columnsOf, instancesOf, linkIds, typesOf } from "./graph";
import { cellValue } from "./formula";
import type { Column, Graph } from "./types";

export interface MetaRelation {
  id: string;
  from: string;
  to: string;
  column: Column;
  /** Some row links to several targets through this column. */
  many: boolean;
}

/** One relation per link column whose target type exists. */
export function metaRelations(g: Graph): MetaRelation[] {
  return typesOf(g).flatMap((t) =>
    columnsOf(g, t.id)
      .filter((c) => c.type === "relation" && c.targetTypeId && g.nodes[c.targetTypeId]?.isType)
      .map((c) => ({
        id: `${t.id}:${c.key}`,
        from: t.id,
        to: c.targetTypeId!,
        column: c,
        many: instancesOf(g, t.id).some((n) => linkIds(n.props[c.key]).length > 1),
      })),
  );
}

/** Rows of a type and, per column, how many of them have a value. */
export function typeStats(g: Graph, typeId: string): { rows: number; filled: Record<string, number> } {
  const rows = instancesOf(g, typeId);
  const filled: Record<string, number> = {};
  for (const c of columnsOf(g, typeId)) {
    filled[c.key] = rows.filter((n) => {
      const v = cellValue(g, n, c);
      return v !== undefined && v !== "" && !(Array.isArray(v) && !v.length);
    }).length;
  }
  return { rows: rows.length, filled };
}

export const TYPE_NAMES: Record<Column["type"], string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes / No",
  relation: "Link",
  formula: "Formula",
};
