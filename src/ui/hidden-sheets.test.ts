import { beforeEach, describe, expect, it, vi } from "vitest";
import { newDbInfo, useStore } from "../model/store";
import { fromJSON } from "../model/io";
import { columnsOf, instancesOf, typesOf } from "../model/graph";
import { computeFormula } from "../model/formula";
import { toHTML } from "../model/html-export";
import { setLocale } from "../model/locale";
import leMonde from "../model/samples/le-monde-100-books.json";
import { setSheetHidden } from "./actions";

const load = () => fromJSON(JSON.stringify(leMonde));

describe("hidden sheets and the Le Monde demo", () => {
  beforeEach(() => setLocale("en-US"));

  it("the demo loads with Country as a hidden sheet and opens on a visible one", () => {
    useStore.getState().open(load(), newDbInfo("Le Monde"));
    const { graph, activeTypeId } = useStore.getState();
    expect(typesOf(graph).map((t) => [t.label, !!t.hiddenSheet])).toEqual([["Book", false], ["Author", false], ["Publisher", false], ["Country", true]]);
    expect(graph.nodes[activeTypeId].label).toBe("Book");
    expect(instancesOf(graph, "type_buch")).toHaveLength(100);
  });

  it("every formula of the demo computes without errors", () => {
    const g = load();
    for (const t of typesOf(g)) {
      for (const c of columnsOf(g, t.id).filter((c) => c.type === "formula")) {
        for (const n of instancesOf(g, t.id)) expect(computeFormula(g, n, c.formula!).error, `${t.label}.${c.label} for ${n.id}`).toBeUndefined();
      }
    }
    const stranger = g.nodes.buch_001;
    expect(computeFormula(g, stranger, "[Year] - MIN([Author].[Born])").value).toBe(29);
    expect(computeFormula(g, stranger, "[Author].[Country of birth (today)].[Name]").value).toBe("Algeria");
  });

  it("hides and shows sheets, but keeps one visible", () => {
    useStore.getState().open(load(), newDbInfo("Le Monde"));
    setSheetHidden("type_verlag", true);
    setSheetHidden("type_autor", true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
    setSheetHidden("type_buch", true);
    expect(window.alert).toHaveBeenCalledOnce();
    const visible = () => typesOf(useStore.getState().graph).filter((t) => !t.hiddenSheet).map((t) => t.label);
    expect(visible()).toEqual(["Book"]);
    setSheetHidden("type_land", false);
    expect(visible()).toEqual(["Book", "Country"]);
  });

  it("the HTML export keeps hidden sheets out of the navigation but still renders them for links", () => {
    const html = toHTML(load(), "Le Monde", "https://zehrer.github.io/GridGraph/");
    const nav = html.slice(html.indexOf("<nav>"), html.indexOf("</nav>"));
    expect(nav).not.toContain("Country");
    expect(html).toContain('<section id="n-type_land">');
    expect(html.indexOf('<section id="n-type_land">')).toBeGreaterThan(html.indexOf('<section id="n-type_verlag">'));
  });
});
