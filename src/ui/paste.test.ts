import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseClipboard, parseTSV, toTSV } from "../model/clipboard";
import { displayValue, guessType, normalize } from "../model/graph";
import { selectionStats, summarize } from "../model/summary";
import { displayNumber, formatNumber, parseNumber, setLocale } from "../model/locale";
import { emptyGraph } from "../model/graph";
import { newDbInfo, useStore } from "../model/store";
import { sampleGraph } from "../model/sample";
import { addRow, followLink, goBack, selectionValues, commitCell, formatColumns, renumberIds, cellText, currentSheet, deleteColumn, deleteRows, hideColumn, moveColumnTo, nameOf, pasteMatrix, selectionMatrix, setNameColumn, unhideColumns, writeCells } from "./actions";

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
    // Renumbering closes the gaps; the next row continues after the last ID.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renumberIds();
    addRow();
    expect(currentSheet().rows.map((r) => r.no)).toEqual([1, 2, 3, 4]);
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

  it("a column whose heading was typed first becomes a number column with its first number", () => {
    commitCell({ row: 0, col: 2 }, "Amount");
    commitCell({ row: 1, col: 1 }, "A");
    commitCell({ row: 1, col: 2 }, "10");
    commitCell({ row: 2, col: 2 }, "5.5");
    const [, amount] = currentSheet().columns;
    expect(amount.type).toBe("number");
    expect(summarize(useStore.getState().graph, amount, currentSheet().rows, "sum")).toBe("Sum 15.5");
  });

  it("sums numbers that are stored as text", () => {
    writeCells({ row: 0, col: 1 }, [["Name", "Note"], ["A", "x"], ["B", "2"], ["C", "3"]]);
    const [, note] = currentSheet().columns;
    expect(note.type).toBe("text");
    expect(summarize(useStore.getState().graph, note, currentSheet().rows, "sum")).toBe("Sum 5");
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

describe("formats", () => {
  beforeEach(() => useStore.getState().open(emptyGraph(), newDbInfo()));
  const text = (row: number, col: number) => cellText(useStore.getState().graph, currentSheet(), { row, col });

  it("a DD.MM.YYYY column reads, shows and copies German dates, whatever the browser locale", () => {
    writeCells({ row: 0, col: 1 }, [["Name", "Due"], ["A", "2026-11-25"]]);
    useStore.getState().select({ row: 1, col: 2 });
    formatColumns("date", "DD.MM.YYYY");
    expect(text(1, 2)).toBe("25.11.2026");
    writeCells({ row: 2, col: 1 }, [["B", "3.4.2027"]]);
    expect(currentSheet().rows[1].props[currentSheet().columns[1].key]).toBe("2027-04-03");
    // The locale's own notation is still understood.
    writeCells({ row: 3, col: 1 }, [["C", "12/24/2026"]]);
    expect(text(3, 2)).toBe("24.12.2026");
    formatColumns("date", "D MMM YYYY");
    expect(displayValue(useStore.getState().graph, currentSheet().columns[1], "2026-11-25")).toBe("Nov 25, 2026");
  });

  it("dates with dots are day.month.year in any locale, and give the new column that format", () => {
    commitCell({ row: 0, col: 2 }, "Date");
    commitCell({ row: 1, col: 2 }, "01.11.2026");
    const [, date] = currentSheet().columns;
    expect([date.type, date.format]).toEqual(["date", "DD.MM.YYYY"]);
    expect(currentSheet().rows[0].props[date.key]).toBe("2026-11-01");
    expect(text(1, 2)).toBe("01.11.2026");
  });

  it("turning a text column into a dated column converts its values", () => {
    writeCells({ row: 0, col: 1 }, [["Name", "Due"], ["A", "soon"]]);
    writeCells({ row: 1, col: 2 }, [["25.11.2026"]]);
    expect(currentSheet().columns[1].type).toBe("text");
    useStore.getState().select({ row: 1, col: 2 });
    formatColumns("date", "DD.MM.YYYY");
    expect(currentSheet().rows[0].props[currentSheet().columns[1].key]).toBe("2026-11-25");
  });

  it("number formats change only the display; percent is edited as %", () => {
    writeCells({ row: 0, col: 1 }, [["Name", "Price", "Share"], ["A", "1234.5", "12.5%"]]);
    const g = () => useStore.getState().graph;
    useStore.getState().select({ row: 1, col: 2 });
    formatColumns("number", "EUR");
    expect(displayValue(g(), currentSheet().columns[1], 1234.5)).toBe("€1,234.50");
    expect(text(1, 2)).toBe("1234.5");
    useStore.getState().select({ row: 1, col: 3 });
    formatColumns("number", "percent");
    expect(currentSheet().rows[0].props[currentSheet().columns[2].key]).toBe(0.125);
    expect(text(1, 3)).toBe("12.5%");
    expect(displayValue(g(), currentSheet().columns[2], 0.125)).toBe("12.5%");
  });
});

describe("decimal comma", () => {
  it("is understood in an English locale; thousands grouping still works", () => {
    setLocale("en-US");
    expect(["0,5", "12,99", "1.234,56", "1,234.56", "1,234", "-0,25", "12,5 %", "€ 3,50"].map(parseNumber)).toEqual([0.5, 12.99, 1234.56, 1234.56, 1234, -0.25, 0.125, 3.5]);
  });

  it("German notation reads 1.234 as thousands and shows commas", () => {
    setLocale("de-DE");
    expect(["0,5", "1.234", "1.234,5", "1.5", "1,234.5"].map(parseNumber)).toEqual([0.5, 1234, 1234.5, 1.5, 1234.5]);
    expect(displayNumber(1234.5, "EUR")).toBe("1.234,50\u00a0€");
    expect(formatNumber(0.5)).toBe("0,5");
    setLocale("en-US");
  });
});

describe("selection statistics", () => {
  beforeEach(() => useStore.getState().open(emptyGraph(), newDbInfo()));

  it("sums the numbers of the selected cells and counts the filled ones", () => {
    writeCells({ row: 0, col: 1 }, [["Name", "Price", "Note"], ["A", "0,15", "x"], ["B", "12,99", "7"], ["C", "", ""]]);
    useStore.getState().select({ row: 1, col: 0 });
    useStore.getState().select({ row: 3, col: 3 }, true);
    const { values, cells } = selectionValues();
    expect(cells).toBe(12);
    const stats = selectionStats(values);
    expect(stats).toMatchObject({ sum: 20.14, min: 0.15, max: 12.99, count: 7, countNumbers: 3 });
    expect(stats.avg).toBeCloseTo(6.7133, 4);
  });
});

describe("following links", () => {
  it("opens the linked row and comes back", () => {
    useStore.getState().open(sampleGraph(), newDbInfo());
    useStore.getState().setActiveType("type_project");
    useStore.getState().select({ row: 1, col: 5 });
    followLink("person_alice");
    const s = useStore.getState();
    expect(s.activeTypeId).toBe("type_person");
    expect(currentSheet().rows[s.sel.row - 1].id).toBe("person_alice");
    goBack();
    expect(useStore.getState()).toMatchObject({ activeTypeId: "type_project", sel: { row: 1, col: 5 }, back: null });
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
