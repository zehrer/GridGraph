import { beforeEach, describe, expect, it, vi } from "vitest";
import { newDbInfo, useStore } from "../model/store";
import { sampleGraph } from "../model/sample";
import { setLocale } from "../model/locale";
import { nodeName } from "../model/graph";
import { viewModified } from "../model/views";
import { toHTML } from "../model/html-export";
import { applyViewById, currentSheet, hideColumn, moveColumnTo, saveViewAs, setColumnFilter, sortBy, updateView } from "./actions";

const names = () => currentSheet().rows.map((n) => nodeName(useStore.getState().graph, n));
const columns = () => currentSheet().columns.map((c) => c.label);
const modified = () => viewModified(useStore.getState().graph, useStore.getState().activeTypeId, useStore.getState().sort);

describe("filter views", () => {
  beforeEach(() => {
    setLocale("en-US");
    useStore.getState().open(sampleGraph(), newDbInfo());
    useStore.getState().setActiveType("type_person");
  });

  it("save filters, visible columns, their order and sort under a name, and bring them back", () => {
    setColumnFilter("company", { values: ["comp_acme"] });
    hideColumn(columns().indexOf("Birthday") + 1);
    moveColumnTo(columns().indexOf("Age") + 1, 1);
    sortBy(1, false);
    vi.spyOn(window, "prompt").mockReturnValue("Acme team");
    saveViewAs();
    expect(names()).toEqual(["Alice Schmidt", "Bob Meier"]);
    const saved = columns();
    expect(saved.slice(0, 2)).toEqual(["Age", "Name"]);

    applyViewById(null);
    expect(names()).toEqual(["Alice Schmidt", "Bob Meier", "Clara Weber"]);
    expect(columns()).toContain("Birthday");
    expect(useStore.getState().sort).toBeNull();

    const view = currentSheet().type.views![0];
    applyViewById(view.id);
    expect(names()).toEqual(["Alice Schmidt", "Bob Meier"]);
    expect(columns()).toEqual(saved);
    expect(useStore.getState().sort).toEqual({ key: "age", asc: false });
    expect(modified()).toBe(false);
  });

  it("notices changes after a view was applied, and updates it", () => {
    vi.spyOn(window, "prompt").mockReturnValue("All");
    saveViewAs();
    setColumnFilter("isRemote", { values: ["true"] });
    expect(modified()).toBe(true);
    updateView();
    expect(modified()).toBe(false);
    expect(currentSheet().type.views![0].filters).toEqual({ isRemote: { values: ["true"] } });
  });

  it("the HTML export can switch between precomputed views", () => {
    setColumnFilter("company", { values: ["comp_nova"] });
    hideColumn(columns().indexOf("hobbies") + 1);
    vi.spyOn(window, "prompt").mockReturnValue("Nova <only>");
    saveViewAs();
    const html = toHTML(useStore.getState().graph, "Views", "https://zehrer.github.io/GridGraph/");
    expect(html).toContain('<select class="views" aria-label="Filter view"><option value="">All rows</option><option value="');
    expect(html).toContain("Nova &lt;only&gt;</option>");
    const viewPart = html.slice(html.indexOf('data-count="1 row" hidden'));
    expect(viewPart.slice(0, viewPart.indexOf("</table>"))).toContain("Clara Weber");
    expect(viewPart.slice(0, viewPart.indexOf("</table>"))).not.toContain("Alice Schmidt");
    expect(viewPart.slice(0, viewPart.indexOf("</thead>"))).not.toContain("hobbies");
  });
});
