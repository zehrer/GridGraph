import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseClipboard, parseTSV, toTSV } from "../model/clipboard";
import { guessType, normalize } from "../model/graph";
import { summarize } from "../model/summary";
import { setLocale } from "../model/locale";
import { emptyGraph } from "../model/graph";
import { newDbInfo, useStore } from "../model/store";
import { addRow, cellText, currentSheet, deleteColumn, deleteRows, hideColumn, moveColumnTo, nameOf, pasteMatrix, selectionMatrix, setNameColumn, unhideColumns, writeCells } from "./actions";

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
  const text = (row: number, col: number) => cellText(useStore.getState().graph, currentSheet(), { row, col });

  it("pasting a table into an empty sheet uses the first line as header", () => {
    useStore.getState().select({ row: 1, col: 0 });
    pasteMatrix(parseTSV("Name\tAge\tBirthday\tActive\nAlice\t32.5\t05/14/1994\tTRUE\nBob\t28\t\tFALSE"));
    const m = currentSheet();
    expect(m.columns.map((c) => [c.label, c.type])).toEqual([["Name", "text"], ["Age", "number"], ["Birthday", "date"], ["Active", "boolean"]]);
    expect(m.rows.map((r) => [r.no, ...Object.values(r.props)])).toEqual([[1, "Alice", 32.5, "1994-05-14", true], [2, "Bob", 28, false]]);
    // The pasted block is selected (it moved right of the read-only ID column) and copies back the same table.
    expect(selectionMatrix()).toEqual([["Name", "Age", "Birthday", "Active"], ["Alice", "32.5", "05/14/1994", "TRUE"], ["Bob", "28", "", "FALSE"]]);
  });

  it("drops a pasted ID column and never writes IDs", () => {
    useStore.getState().select({ row: 0, col: 0 });
    pasteMatrix(parseTSV("ID\tName\n7\tAlice\n8\tBob"));
    expect(currentSheet().rows.map((r) => [r.no, r.props.name])).toEqual([[1, "Alice"], [2, "Bob"]]);
    writeCells({ row: 1, col: 0 }, [["99"]]);
    expect(text(1, 0)).toBe("1");
  });

  it("pasting into existing rows overwrites values and appends new rows", () => {
    writeCells({ row: 0, col: 1 }, [["Name", "City"], ["Acme", "Berlin"]]);
    writeCells({ row: 1, col: 2 }, [["Munich"], ["Hamburg"]]);
    expect([text(1, 2), text(2, 2), text(2, 1), text(2, 0)]).toEqual(["Munich", "Hamburg", "", "2"]);
  });

  it("renames the name column through its header cell, also when pasting", () => {
    writeCells({ row: 0, col: 1 }, [["Product"]]);
    expect(text(0, 1)).toBe("Product");
    pasteMatrix(parseTSV("Item\tPrice\nScrew\t0.15"));
    expect(text(0, 1)).toBe("Item");
    expect(nameOf(currentSheet().rows[0].id)).toBe("Screw");
  });

  it("IDs are never reused after a delete", () => {
    writeCells({ row: 1, col: 1 }, [["A"], ["B"], ["C"]]);
    useStore.getState().select({ row: 2, col: 1 });
    deleteRows();
    addRow();
    expect(currentSheet().rows.map((r) => [r.no, nameOf(r.id)])).toEqual([[1, "A"], [3, "C"], [4, ""]]);
  });

  it("moves, hides and renames columns; the name column can move and be reassigned", () => {
    writeCells({ row: 0, col: 1 }, [["Name", "City", "Zip"], ["Acme", "Berlin", "10115"]]);
    moveColumnTo(1, 3);
    expect(currentSheet().columns.map((c) => c.label)).toEqual(["City", "Zip", "Name"]);
    hideColumn(1);
    expect(currentSheet().columns.map((c) => c.label)).toEqual(["Zip", "Name"]);
    expect(text(1, 1)).toBe("10115");
    unhideColumns();
    setNameColumn(1);
    expect(nameOf(currentSheet().rows[0].id)).toBe("Berlin");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
    deleteColumn(1);
    expect(window.alert).toHaveBeenCalledOnce();
    expect(currentSheet().columns).toHaveLength(3);
  });

  it("summarizes columns for the footer", () => {
    writeCells({ row: 0, col: 1 }, [["Name", "Budget", "Due"], ["A", "10", "01/02/2027"], ["B", "32.5", "03/04/2026"], ["C", "", ""]]);
    const [, budget, due] = currentSheet().columns;
    const { graph } = useStore.getState();
    const rows = currentSheet().rows;
    expect(summarize(graph, budget, rows, "sum")).toBe("Sum 42.5");
    expect(summarize(graph, budget, rows, "avg")).toBe("Average 21.25");
    expect(summarize(graph, budget, rows, "empty")).toBe("Empty 1");
    expect(summarize(graph, due, rows, "min")).toBe("Min 03/04/2026");
  });
});

describe("migration", () => {
  it("moves instance labels into a name column and assigns IDs", () => {
    const g = normalize({
      nodes: {
        t: { id: "t", label: "Person", isType: true, columns: [{ key: "age", label: "Age", type: "number" }], props: {} },
        a: { id: "a", label: "Alice", typeId: "t", props: { age: 3 } },
        b: { id: "b", label: "Bob", typeId: "t", props: {} },
      },
      edges: {},
    });
    expect(g.nodes.t).toMatchObject({ nameKey: "name", nextNo: 3 });
    expect(g.nodes.t.columns?.[0]).toEqual({ key: "name", label: "Name", type: "text" });
    expect([g.nodes.a, g.nodes.b].map((n) => [n.no, n.props.name, n.label])).toEqual([[1, "Alice", undefined], [2, "Bob", undefined]]);
    expect(normalize(structuredClone(g))).toEqual(g);
  });
});
