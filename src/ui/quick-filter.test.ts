import { beforeEach, describe, expect, it, vi } from "vitest";
import { newDbInfo, useStore } from "../model/store";
import { sampleGraph } from "../model/sample";
import { fromJSON } from "../model/io";
import { nodeName } from "../model/graph";
import { filteredOut, periodLabel, stepPeriod } from "../model/filter";
import { setLocale } from "../model/locale";
import leMonde from "../model/samples/le-monde-100-books.json";
import { toHTML } from "../model/html-export";
import { applyViewById, toggleQuickFilter, quickChoices, setQuickValue, clearQuickFilter, currentSheet, saveViewAs, startQuickFilter, stepQuickFilter, toggleQuickUnit } from "./actions";

const names = () => currentSheet().rows.map((n) => nodeName(useStore.getState().graph, n));
const qk = () => currentSheet().type.quickFilters![0].key;
const col = (label: string) => currentSheet().columns.findIndex((c) => c.label === label) + 1;

describe("quick filter", () => {
  beforeEach(() => setLocale("en-US"));

  it("steps periods like a calendar", () => {
    expect(stepPeriod("year", "2026", -1)).toBe("2025");
    expect(stepPeriod("month", "2026-12", 1)).toBe("2027-01");
    expect(stepPeriod("month", "2026-01", -1)).toBe("2025-12");
    expect(stepPeriod("number", "1942", 1)).toBe("1943");
    expect(periodLabel("month", "2026-05")).toBe("May 2026");
  });

  it("filters a date column by year or month and browses with ‹ ›", () => {
    useStore.getState().open(sampleGraph(), newDbInfo());
    useStore.getState().setActiveType("type_project");
    startQuickFilter(col("Deadline"), "year");
    expect(currentSheet().type.quickFilters?.[0]).toEqual({ key: "deadline", unit: "year", value: "2027" });
    expect(names()).toEqual(["Cloud Portal"]);
    stepQuickFilter(qk(), -1);
    expect(names()).toEqual(["Graph Engine V2"]);
    toggleQuickUnit(qk());
    expect(currentSheet().type.quickFilters?.[0]?.value).toBe("2026-12");
    stepQuickFilter(qk(), 1);
    expect(names()).toEqual([]);
    clearQuickFilter(qk());
    expect(names()).toHaveLength(2);
  });

  it("starts at the selected cell and works on number columns (Le Monde: Year)", () => {
    useStore.getState().open(fromJSON(JSON.stringify(leMonde)), newDbInfo());
    const year = col("Year");
    const row = currentSheet().rows.findIndex((n) => n.id === "buch_001") + 1;
    useStore.getState().select({ row, col: year });
    startQuickFilter(year, "number");
    expect(currentSheet().type.quickFilters?.[0]?.value).toBe("1942");
    expect(names()).toContain("The Stranger");
    expect(currentSheet().rows.every((n) => n.props.jahr === 1942)).toBe(true);
    // The graph leaves out the other books too.
    expect(filteredOut(useStore.getState().graph).has("buch_002")).toBe(true);
  });

  it("is saved in filter views", () => {
    useStore.getState().open(sampleGraph(), newDbInfo());
    useStore.getState().setActiveType("type_person");
    startQuickFilter(col("Birthday"), "year");
    vi.spyOn(window, "prompt").mockReturnValue("Born 1998");
    saveViewAs();
    const id = currentSheet().type.activeView!;
    applyViewById(null);
    expect(currentSheet().type.quickFilters?.[0]).toBeUndefined();
    applyViewById(id);
    expect(currentSheet().type.quickFilters?.[0]).toEqual({ key: "birthday", unit: "year", value: "1998" });
    expect(names()).toEqual(["Bob Meier"]);
  });

  it("filters link columns by a linked row and steps through the existing values", () => {
    useStore.getState().open(fromJSON(JSON.stringify(leMonde)), newDbInfo());
    const publisher = col("First publisher");
    const row = currentSheet().rows.findIndex((n) => n.id === "buch_001") + 1;
    useStore.getState().select({ row, col: publisher });
    startQuickFilter(publisher, "link");
    expect(currentSheet().type.quickFilters?.[0]).toEqual({ key: "verlag", unit: "link", value: "verlag_gallimard" });
    // Proust (Grasset and Gallimard) counts for Gallimard too.
    expect(names()).toContain("In Search of Lost Time");
    const choices = quickChoices(qk());
    const at = choices.findIndex((c) => c.value === "verlag_gallimard");
    stepQuickFilter(qk(), 1);
    expect(currentSheet().type.quickFilters?.[0]?.value).toBe(choices[at + 1].value);
    setQuickValue(qk(), choices[0].value);
    stepQuickFilter(qk(), -1);
    expect(currentSheet().type.quickFilters?.[0]?.value).toBe(choices[0].value);
  });

  it("filters text columns by value", () => {
    useStore.getState().open(fromJSON(JSON.stringify(leMonde)), newDbInfo());
    startQuickFilter(col("Genre"), "text");
    const first = quickChoices(qk())[0];
    expect(currentSheet().type.quickFilters?.[0]?.value).toBe(first.label);
    expect(currentSheet().rows).toHaveLength(first.count);
  });

  it("switches off and on without losing column and value", () => {
    useStore.getState().open(sampleGraph(), newDbInfo());
    useStore.getState().setActiveType("type_project");
    startQuickFilter(col("Deadline"), "year");
    toggleQuickFilter(qk());
    expect(currentSheet().type.quickFilters?.[0]).toMatchObject({ value: "2027", off: true });
    expect(names()).toHaveLength(2);
    toggleQuickFilter(qk());
    expect(currentSheet().type.quickFilters?.[0]?.off).toBeUndefined();
    expect(names()).toEqual(["Cloud Portal"]);
  });

  it("the HTML export gets a quick filter control and row values", () => {
    useStore.getState().open(fromJSON(JSON.stringify(leMonde)), newDbInfo());
    startQuickFilter(col("Genre"), "text");
    const html = toHTML(useStore.getState().graph, "Le Monde", "https://zehrer.github.io/GridGraph/");
    const control = html.slice(html.indexOf('<span class="qf'), html.indexOf("</select>"));
    expect(control).toContain('<input type="checkbox" checked>');
    expect(control).toContain(">Genre</span>");
    expect(control).toMatch(/<option value="Novel"[^>]*>Novel \(\d+\)<\/option>/);
    expect(html).toContain('data-q="{&quot;gattung&quot;:[&quot;Novel&quot;]}"');
  });

  it("several quick filters combine, each with its own value list", () => {
    useStore.getState().open(fromJSON(JSON.stringify(leMonde)), newDbInfo());
    startQuickFilter(col("Genre"), "text");
    setQuickValue("gattung", "Novel");
    startQuickFilter(col("Language"), "text");
    setQuickValue("sprache", "English");
    expect(currentSheet().type.quickFilters?.map((q) => [q.key, q.value])).toEqual([["gattung", "Novel"], ["sprache", "English"]]);
    const rows = currentSheet().rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((n) => n.props.gattung === "Novel" && n.props.sprache === "English")).toBe(true);
    // Language choices only list languages that occur among novels.
    expect(quickChoices("sprache").every((c) => currentSheet().base.some((n) => n.props.gattung === "Novel" && n.props.sprache === c.value))).toBe(true);
    toggleQuickFilter("gattung");
    expect(currentSheet().rows.every((n) => n.props.sprache === "English")).toBe(true);
    expect(currentSheet().rows.length).toBeGreaterThan(rows.length);
    clearQuickFilter("sprache");
    expect(currentSheet().type.quickFilters?.map((q) => q.key)).toEqual(["gattung"]);
    const html = toHTML(useStore.getState().graph, "x", "https://zehrer.github.io/GridGraph/");
    expect(html).toContain('<span class="qf off" data-key="gattung">');
  });

  it("migrates a single quick filter from older data", () => {
    const g = sampleGraph() as ReturnType<typeof sampleGraph>;
    (g.nodes.type_person as { quickFilter?: unknown }).quickFilter = { key: "age", unit: "number", value: "32" };
    useStore.getState().open(g, newDbInfo());
    expect(useStore.getState().graph.nodes.type_person.quickFilters).toEqual([{ key: "age", unit: "number", value: "32" }]);
  });
});
