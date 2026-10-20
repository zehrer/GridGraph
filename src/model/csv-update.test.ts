import { beforeEach, describe, expect, it } from "vitest";
import { importTable, matchSheet, parseCSV, toTable, updateKeys, updateTable } from "./csv";
import { addType, columnsOf, convertColumn, emptyGraph, extractType, instancesOf, linkIds, nodeName } from "./graph";
import { setLocale } from "./locale";

const table = (csv: string) => toTable(parseCSV(csv, ","), true);
const V1 = "Title,Author,Year,Country\nDune,Herbert,1965,USA\nMomo,Ende,1973,Germany\nUlysses,Joyce,1922,Ireland";
const V2 = "Title,Author,Year,Country,Pages\nDune,Frank Herbert,1965,USA,412\nMomo,Ende,1973,Germany,304\nEmil,Kästner,1929,Germany,180";

function books() {
  const g = emptyGraph();
  const t = importTable(g, "Books", table(V1));
  const country = columnsOf(g, t).find((c) => c.label === "Country")!;
  extractType(g, t, country, "Country");
  const year = columnsOf(g, t).find((c) => c.label === "Year")!;
  g.nodes[t].columns!.push({ key: "age", label: "Age", type: "formula", formula: "2026 - [Year]" });
  g.nodes[t].views = [{ id: "v1", name: "Old", columns: ["name", year.key, "age"], filters: { [year.key]: { condition: { op: "lt", a: "1950" } } } }];
  return { g, t };
}

describe("CSV update of an existing sheet", () => {
  beforeEach(() => setLocale("en-US"));

  it("suggests the sheet a file is a new state of", () => {
    const { g, t } = books();
    expect(matchSheet(g, table(V2), "books.csv")).toBe(t);
    expect(matchSheet(g, table("A,B\n1,2"), "books.csv")).toBeUndefined();
    addType(g, "Other");
    expect(matchSheet(g, table("Title,Foo,Bar\nx,1,2"), "Books.csv")).toBeUndefined();
  });

  it("offers the name column first as the key", () => {
    const { g, t } = books();
    expect(updateKeys(g, t, table(V2)).map((k) => k.label)).toEqual(["Title", "Author", "Year", "Country"]);
  });

  it("updates matching rows, adds new ones, keeps the rest and the sheet's settings", () => {
    const { g, t } = books();
    const momo = instancesOf(g, t).find((n) => nodeName(g, n) === "Momo")!;
    const r = updateTable(g, t, table(V2), "name", false);
    expect(r).toEqual({ matched: 2, changed: 2, added: 1, missing: 1, removed: false, newColumns: ["Pages"] });
    const rows = instancesOf(g, t);
    expect(rows.map((n) => nodeName(g, n)).sort()).toEqual(["Dune", "Emil", "Momo", "Ulysses"]);
    expect(g.nodes[momo.id]).toBe(momo); // same row: links to it survive
    expect(rows.find((n) => nodeName(g, n) === "Emil")!.no).toBe(4);
    // The link column stays a link; Germany is reused, not duplicated.
    const country = columnsOf(g, t).find((c) => c.label === "Country")!;
    expect(country.type).toBe("relation");
    expect(instancesOf(g, country.targetTypeId!).length).toBe(3);
    expect(linkIds(rows.find((n) => nodeName(g, n) === "Emil")!.props[country.key])).toEqual(linkIds(momo.props[country.key]));
    expect(columnsOf(g, t).some((c) => c.key === "age")).toBe(true);
    expect(g.nodes[t].views![0].name).toBe("Old");
  });

  it("deletes rows not in the file when asked", () => {
    const { g, t } = books();
    expect(updateTable(g, t, table(V2), "name", true)).toMatchObject({ missing: 1, removed: true });
    expect(instancesOf(g, t).map((n) => nodeName(g, n)).sort()).toEqual(["Dune", "Emil", "Momo"]);
  });

  it("matches by ID when the file has an ID column", () => {
    const g = emptyGraph();
    const t = importTable(g, "P", table("ID,Name,Score\n1,A,10\n5,B,20"));
    const r = updateTable(g, t, table("ID,Name,Score\n5,B renamed,25\n7,C,30"), "", false);
    expect(r).toMatchObject({ matched: 1, added: 1, missing: 1 });
    expect(instancesOf(g, t).map((n) => `${n.no}:${nodeName(g, n)}`).sort()).toEqual(["1:A", "5:B renamed", "7:C"]);
    expect(g.nodes[t].nextNo).toBe(8);
  });

  it("matches numbers whatever their notation", () => {
    const g = emptyGraph();
    const t = importTable(g, "P", table("Name,Code\nA,1.5"));
    const code = columnsOf(g, t).find((c) => c.label === "Code")!;
    convertColumn(g, t, code, "number");
    expect(updateTable(g, t, toTable(parseCSV("Name;Code\nA new;1,5", ";"), true), code.key, false)).toMatchObject({ matched: 1, added: 0 });
  });
});

describe("new sheet taking views from an earlier version", () => {
  beforeEach(() => setLocale("en-US"));

  it("reuses keys, links, formulas and views of the template", () => {
    const { g, t } = books();
    const t2 = importTable(g, "Books 2", table(V2), t);
    const cols = columnsOf(g, t2);
    expect(cols.find((c) => c.label === "Country")).toMatchObject({ type: "relation", targetTypeId: columnsOf(g, t).find((c) => c.label === "Country")!.targetTypeId });
    expect(cols.some((c) => c.key === "age" && c.type === "formula")).toBe(true);
    expect(g.nodes[t2].views![0]).toMatchObject({ name: "Old", columns: g.nodes[t].views![0].columns });
    expect(Object.keys(g.nodes[t2].views![0].filters)).toEqual(Object.keys(g.nodes[t].views![0].filters));
    expect(g.nodes[t2].nameKey).toBe("name");
  });
});
