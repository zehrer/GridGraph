import { beforeEach, describe, expect, it, vi } from "vitest";
import { newDbInfo, useStore } from "../model/store";
import { sampleGraph } from "../model/sample";
import { fromJSON } from "../model/io";
import { nodeName } from "../model/graph";
import { filteredOut, periodLabel, stepPeriod } from "../model/filter";
import { setLocale } from "../model/locale";
import leMonde from "../model/samples/le-monde-100-books.json";
import { applyViewById, clearQuickFilter, currentSheet, saveViewAs, startQuickFilter, stepQuickFilter, toggleQuickUnit } from "./actions";

const names = () => currentSheet().rows.map((n) => nodeName(useStore.getState().graph, n));
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
    expect(currentSheet().type.quickFilter).toEqual({ key: "deadline", unit: "year", value: "2027" });
    expect(names()).toEqual(["Cloud Portal"]);
    stepQuickFilter(-1);
    expect(names()).toEqual(["Graph Engine V2"]);
    toggleQuickUnit();
    expect(currentSheet().type.quickFilter?.value).toBe("2026-12");
    stepQuickFilter(1);
    expect(names()).toEqual([]);
    clearQuickFilter();
    expect(names()).toHaveLength(2);
  });

  it("starts at the selected cell and works on number columns (Le Monde: Year)", () => {
    useStore.getState().open(fromJSON(JSON.stringify(leMonde)), newDbInfo());
    const year = col("Year");
    const row = currentSheet().rows.findIndex((n) => n.id === "buch_001") + 1;
    useStore.getState().select({ row, col: year });
    startQuickFilter(year, "number");
    expect(currentSheet().type.quickFilter?.value).toBe("1942");
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
    expect(currentSheet().type.quickFilter).toBeUndefined();
    applyViewById(id);
    expect(currentSheet().type.quickFilter).toEqual({ key: "birthday", unit: "year", value: "1998" });
    expect(names()).toEqual(["Bob Meier"]);
  });
});
