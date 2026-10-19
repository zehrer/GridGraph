import { describe, expect, it } from "vitest";
import { toHTML } from "./html-export";
import { importText } from "./io";
import { setLocale } from "./locale";
import { sampleGraph } from "./sample";

describe("HTML export", () => {
  setLocale("en-US");
  const g = sampleGraph();
  g.nodes.comp_acme.props.industry = "Software </script><b>AI</b>";
  const html = toHTML(g, "Demo & Co", "https://zehrer.github.io/GridGraph/");

  it("shows every sheet as a table with formatted values, formulas and links between rows", () => {
    expect(html).toContain("<title>Demo &amp; Co</title>");
    for (const label of ["Person", "Company", "Project"]) expect(html).toContain(`>${label} <small>`);
    expect(html).toContain("€150,000.00");
    expect(html).toContain("Acme Technologies (Berlin)");
    expect(html).toContain('<a class="chip" href="#n-person_alice">');
    expect(html).toContain('<tr id="n-person_alice">');
    expect(html).toContain("Sum €235,000.00");
    expect(html).toContain("Software &lt;/script&gt;&lt;b&gt;AI&lt;/b&gt;");
  });

  it("links back to GridGraph and can be imported again unchanged", () => {
    expect(html).toContain('href="https://zehrer.github.io/GridGraph/"');
    expect(importText("Demo.html", html)).toEqual(g);
  });

  it("rejects HTML that was not exported from GridGraph", () => {
    expect(() => importText("page.html", "<!doctype html><p>hi</p>")).toThrow("not exported from GridGraph");
  });

  it("carries what the live summary row needs, and leaves it out when the summary row is off", () => {
    expect(html).toContain('data-sum="sum" data-fmt="EUR">Sum €235,000.00</td>');
    expect(html).toMatch(/<td class="r" data-v data-n="150000">€150,000.00<\/td>/);
    const off = toHTML(g, "Demo", "https://zehrer.github.io/GridGraph/", { summaryRow: false });
    expect(off).not.toContain("<tfoot>");
    expect(off).not.toContain("data-sum=");
  });
});
