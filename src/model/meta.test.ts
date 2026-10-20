import { describe, expect, it } from "vitest";
import { metaRelations, typeStats } from "./meta";
import { sampleGraph } from "./sample";

describe("meta model", () => {
  it("derives one relation per link column", () => {
    const g = sampleGraph();
    const rels = metaRelations(g);
    expect(rels.length).toBeGreaterThan(0);
    for (const r of rels) {
      expect(r.column.type).toBe("relation");
      expect(g.nodes[r.from].isType && g.nodes[r.to].isType).toBe(true);
    }
    expect(rels.some((r) => r.from === "type_person" && r.to === "type_company")).toBe(true);
  });

  it("marks relations whose rows hold several links", () => {
    const g = sampleGraph();
    const r = metaRelations(g).find((r) => r.from === "type_person" && r.to === "type_company")!;
    expect(r.many).toBe(false);
    const p = Object.values(g.nodes).find((n) => n.typeId === "type_person")!;
    p.props[r.column.key] = ["comp_acme", "comp_nova"];
    expect(metaRelations(g).find((x) => x.id === r.id)!.many).toBe(true);
  });

  it("ignores link columns without an existing target type", () => {
    const g = sampleGraph();
    g.nodes.type_person.columns!.push({ key: "x", label: "X", type: "relation", targetTypeId: "nope" });
    expect(metaRelations(g).some((r) => r.column.key === "x")).toBe(false);
  });

  it("counts rows and filled cells per column", () => {
    const g = sampleGraph();
    const s = typeStats(g, "type_person");
    expect(s.rows).toBeGreaterThan(0);
    for (const v of Object.values(s.filled)) expect(v).toBeLessThanOrEqual(s.rows);
    expect(s.filled.birthday ?? Object.values(s.filled)[0]).toBeGreaterThan(0);
  });
});
