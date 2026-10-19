import { beforeEach, describe, expect, it } from "vitest";
import { applyFilters, distinctValues, passes } from "./filter";
import { columnsOf, instancesOf, nodeName } from "./graph";
import { setLocale } from "./locale";
import { sampleGraph } from "./sample";
import type { ColumnFilter } from "./types";

describe("column filters", () => {
  beforeEach(() => setLocale("en-US"));
  const g = sampleGraph();
  const people = instancesOf(g, "type_person");
  const col = (key: string) => columnsOf(g, "type_person").find((c) => c.key === key)!;
  const names = (f: ColumnFilter, key: string) => people.filter((n) => passes(g, n, col(key), f)).map((n) => nodeName(g, n));

  it("filters by values, including blanks and links", () => {
    expect(names({ values: ["comp_acme"] }, "company")).toEqual(["Alice Schmidt", "Bob Meier"]);
    expect(names({ values: [""] }, "birthday")).toEqual(["Clara Weber"]);
    expect(names({ values: ["true"] }, "isRemote")).toEqual(["Alice Schmidt", "Clara Weber"]);
  });

  it("filters by conditions on numbers, dates and text", () => {
    expect(names({ condition: { op: "gt", a: "30" } }, "age")).toEqual(["Alice Schmidt", "Clara Weber"]);
    expect(names({ condition: { op: "between", a: "28", b: "32" } }, "age")).toEqual(["Alice Schmidt", "Bob Meier"]);
    expect(names({ condition: { op: "lt", a: "01/01/1995" } }, "birthday")).toEqual(["Alice Schmidt"]);
    expect(names({ condition: { op: "gt", a: "not a date" } }, "birthday")).toEqual([]);
    expect(names({ condition: { op: "contains", a: "ME" } }, "name")).toEqual(["Bob Meier"]);
    expect(names({ condition: { op: "startsWith", a: "c" } }, "name")).toEqual(["Clara Weber"]);
    expect(names({ condition: { op: "empty" } }, "hobbies")).toEqual(["Bob Meier", "Clara Weber"]);
    expect(names({ condition: { op: "notEmpty" } }, "hobbies")).toEqual(["Alice Schmidt"]);
    // Formula results can be filtered too.
    expect(names({ condition: { op: "equals", a: "Munich" } }, "employerCity")).toEqual(["Clara Weber"]);
  });

  it("combines columns, and lists values left by the other filters", () => {
    const t = { ...g.nodes.type_person, filterOn: true, filters: { company: { values: ["comp_acme"] }, isRemote: { values: ["true"] } } };
    expect(applyFilters(g, t, columnsOf(g, "type_person"), people).map((n) => nodeName(g, n))).toEqual(["Alice Schmidt"]);
    expect(applyFilters(g, { ...t, filterOn: false }, columnsOf(g, "type_person"), people)).toHaveLength(3);
    const left = applyFilters(g, t, columnsOf(g, "type_person"), people, "isRemote");
    expect(distinctValues(g, col("isRemote"), left)).toEqual([{ key: "false", label: "FALSE", count: 1 }, { key: "true", label: "TRUE", count: 1 }]);
  });

  it("lists values with counts: blanks first, numbers and dates in order", () => {
    expect(distinctValues(g, col("age"), people).map((v) => v.label)).toEqual(["28", "32", "41"]);
    expect(distinctValues(g, col("birthday"), people).map((v) => v.label)).toEqual(["(Blanks)", "05/14/1994", "11/20/1998"]);
    expect(distinctValues(g, col("company"), people)).toEqual([
      { key: "comp_acme", label: "Acme Technologies", count: 2 },
      { key: "comp_nova", label: "Nova Dynamics", count: 1 },
    ]);
  });
});
