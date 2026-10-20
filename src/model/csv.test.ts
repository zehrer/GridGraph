import { beforeEach, describe, expect, it } from "vitest";
import { decodeText, detectDelimiter, importTable, parseCSV, toTable } from "./csv";
import { columnsOf, emptyGraph, instancesOf, nodeName } from "./graph";
import { setLocale } from "./locale";

const bytes = (s: string, enc: "utf8" | "latin1" = "utf8") => {
  const arr = enc === "utf8" ? new TextEncoder().encode(s) : Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
  return arr.buffer as ArrayBuffer;
};

describe("CSV import", () => {
  beforeEach(() => setLocale("en-US"));

  it("detects comma, semicolon, tab and pipe", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("Name;Preis;Ort\nSchraube;0,15;Berlin\nDübel;1,99;Köln")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter("a|b|c\n1|2|3")).toBe("|");
    // A comma inside quotes does not count; the semicolon splits consistently.
    expect(detectDelimiter('Name;Note\n"Smith, John";"x, y, z"\nDoe;a')).toBe(";");
  });

  it("parses quotes, escaped quotes, line breaks in cells and any line ending", () => {
    const text = 'Name,Note\r\n"Smith, John","He said ""hi""\nand left"\rBob,plain\n\n,\n';
    expect(parseCSV(text, ",")).toEqual([["Name", "Note"], ["Smith, John", 'He said "hi"\nand left'], ["Bob", "plain"]]);
  });

  it("keeps going after an unclosed quote", () => {
    expect(parseCSV('a,"b\nc,d', ",")).toEqual([["a", '"b'], ["c", "d"]]);
  });

  it("reads UTF-8 with BOM and falls back to Windows-1252 (Excel)", () => {
    expect(decodeText(bytes("﻿Name;Ort\nJürgen;Köln"))).toEqual({ text: "Name;Ort\nJürgen;Köln", encoding: "UTF-8" });
    expect(decodeText(bytes("Name;Ort\nJürgen;Köln", "latin1"))).toEqual({ text: "Name;Ort\nJürgen;Köln", encoding: "Windows-1252" });
  });

  it("pads ragged rows and names empty or repeated headings", () => {
    const t = toTable([["Name", "", "City", "city"], ["A", "1"], ["B", "2", "Berlin", "x", "extra"]], true);
    expect(t.headers).toEqual(["Name", "Column 2", "City", "city (2)", "Column 5"]);
    expect(t.rows).toEqual([["A", "1", "", "", ""], ["B", "2", "Berlin", "x", "extra"]]);
    expect(toTable([["1", "2"]], false).headers).toEqual(["Column 1", "Column 2"]);
  });

  it("imports a German Excel file as a new sheet with typed columns", () => {
    const text = decodeText(bytes("Artikel;Preis;Lieferdatum;Auf Lager\nSchraube;0,15;01.11.2026;WAHR\nDübel;1.299,50;15.12.2026;FALSCH\n", "latin1")).text;
    const g = emptyGraph();
    const typeId = importTable(g, "Lager", toTable(parseCSV(text, detectDelimiter(text)), true));
    expect(g.nodes[typeId].label).toBe("Lager");
    expect(columnsOf(g, typeId).map((c) => [c.label, c.type])).toEqual([["Artikel", "text"], ["Preis", "number"], ["Lieferdatum", "date"], ["Auf Lager", "boolean"]]);
    const rows = instancesOf(g, typeId);
    expect(rows.map((n) => nodeName(g, n))).toEqual(["Schraube", "Dübel"]);
    expect(Object.values(rows[1].props)).toEqual(["Dübel", 1299.5, "2026-12-15", false]);
    expect(rows.map((n) => n.no)).toEqual([1, 2]);
  });

  it("keeps IDs from an ID column", () => {
    const g = emptyGraph();
    const typeId = importTable(g, "T", toTable(parseCSV("ID\tName\n7\tA\n3\tB", "\t"), true));
    expect(instancesOf(g, typeId).map((n) => [n.no, nodeName(g, n)])).toEqual([[7, "A"], [3, "B"]]);
    expect(g.nodes[typeId].nextNo).toBe(8);
  });
});

describe("recognising table files", () => {
  it("sends CSV text to the CSV import whatever the file is called", async () => {
    const { isTableText } = await import("./io");
    const csv = "Name, Type, Comment\nA, X1, none\nB, X0,\nC, X9, Super\n";
    for (const name of ["data.csv", "data.cvs", "data.txt", "data.dat", "data"]) expect(isTableText(name, csv)).toBe(true);
    expect(isTableText("db.json", csv)).toBe(false);
    expect(isTableText("db", '{"nodes":{}}')).toBe(false);
    expect(isTableText("db.export", "<graphml>")).toBe(false);
    const table = toTable(parseCSV(csv, detectDelimiter(csv)), true);
    expect(table).toEqual({ headers: ["Name", "Type", "Comment"], rows: [["A", "X1", "none"], ["B", "X0", ""], ["C", "X9", "Super"]], ids: undefined });
  });
});
