import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { importTable, toTable } from "./csv";
import { columnsOf, emptyGraph } from "./graph";
import { setLocale } from "./locale";
import { excelDate, readXlsx } from "./xlsx";

const file = () => {
  const b = readFileSync("src/model/fixtures/simple.xlsx");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("Excel import", () => {
  beforeEach(() => setLocale("en-US"));

  it("reads sheets, strings, numbers, booleans and dates", async () => {
    const sheets = await readXlsx(file());
    expect(sheets.map((s) => s.name)).toEqual(["Issues", "Notes"]);
    expect(sheets[0].rows).toEqual([
      ["Name", "Due", "Estimate", "Done", "Owner"],
      ["Login bug", "2026-11-01", "1.5", "TRUE", "Schmidt, Anna"],
      ["Export", "2026-11-02", "", "FALSE", "Meier, Bob (bob@example.com)"],
      ["Later", "", "12", "", ""],
    ]);
    expect(sheets[1].rows).toEqual([["", "only B"]]);
  });

  it("writes numbers in the locale's notation", async () => {
    setLocale("de-DE");
    expect((await readXlsx(file()))[0].rows[1][2]).toBe("1,5");
  });

  it("becomes a sheet with guessed column types", async () => {
    const g = emptyGraph();
    const t = importTable(g, "Issues", toTable((await readXlsx(file()))[0].rows, true));
    expect(columnsOf(g, t).map((c) => `${c.label}:${c.type}`)).toEqual(["Name:text", "Due:date", "Estimate:number", "Done:boolean", "Owner:text"]);
  });

  it("converts Excel day numbers", () => {
    expect(excelDate(1)).toBe("1899-12-31");
    expect(excelDate(45658)).toBe("2025-01-01");
    expect(excelDate(45658.5)).toBe("2025-01-01 12:00");
  });

  it("rejects files that are not workbooks", async () => {
    await expect(readXlsx(new TextEncoder().encode("Name,Age\nA,1").buffer as ArrayBuffer)).rejects.toThrow("not an Excel");
  });
});
