import { beforeEach, describe, expect, it } from "vitest";
import { parseClipboard, parseTSV, toTSV } from "../model/clipboard";
import { guessType } from "../model/graph";
import { setLocale } from "../model/locale";
import { emptyGraph } from "../model/graph";
import { newDbInfo, useStore } from "../model/store";
import { cellText, currentSheet, pasteMatrix, selectionMatrix, writeCells } from "./actions";

beforeEach(() => setLocale("en-US"));

describe("clipboard formats", () => {
  it("parses quoted TSV cells with tabs, quotes and newlines", () => {
    const text = 'Name\tNotiz\r\nAlice\t"zwei\nZeilen"\r\nBob\t"sagt ""hi"""\r\n';
    expect(parseTSV(text)).toEqual([["Name", "Notiz"], ["Alice", "zwei\nZeilen"], ["Bob", 'sagt "hi"']]);
    expect(parseTSV(toTSV(parseTSV(text)))).toEqual(parseTSV(text));
  });

  it("prefers an HTML table and expands colspans", () => {
    const html = '<meta charset="utf-8"><table><tr><th>A</th><th colspan="2">B</th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>';
    expect(parseClipboard(html, "ignored")).toEqual([["A", "B", ""], ["1", "2", "3"]]);
  });

  it("guesses column types", () => {
    expect(guessType(["1,234.5", "42", ""])).toBe("number");
    expect(guessType(["01/02/2024", "2024-03-05"])).toBe("date");
    expect(guessType(["TRUE", "no"])).toBe("boolean");
    expect(guessType(["12", "abc"])).toBe("text");
  });
});

describe("writing cells", () => {
  beforeEach(() => useStore.getState().open(emptyGraph(), newDbInfo()));

  it("pasting a table into an empty sheet uses the first line as header", () => {
    useStore.getState().select({ row: 1, col: 0 });
    pasteMatrix(parseTSV("Name\tAge\tBirthday\tActive\nAlice\t32.5\t05/14/1994\tTRUE\nBob\t28\t\tFALSE"));
    const m = currentSheet();
    expect(m.columns.map((c) => [c.label, c.type])).toEqual([["Age", "number"], ["Birthday", "date"], ["Active", "boolean"]]);
    expect(m.rows.map((r) => [r.label, ...Object.values(r.props)])).toEqual([["Alice", 32.5, "1994-05-14", true], ["Bob", 28, false]]);
    // The pasted block is selected and copies back the same table.
    expect(selectionMatrix()).toEqual([["Name", "Age", "Birthday", "Active"], ["Alice", "32.5", "05/14/1994", "TRUE"], ["Bob", "28", "", "FALSE"]]);
  });

  it("pasting into existing rows overwrites values and appends new rows", () => {
    writeCells({ row: 0, col: 0 }, [["Name", "City"], ["Acme", "Berlin"]]);
    writeCells({ row: 1, col: 1 }, [["Munich"], ["Hamburg"]]);
    const m = currentSheet();
    expect(m.rows.map((r) => cellText(useStore.getState().graph, m, { row: m.rows.indexOf(r) + 1, col: 1 }))).toEqual(["Munich", "Hamburg"]);
    expect(m.rows[1].label).toBe("");
  });
});
