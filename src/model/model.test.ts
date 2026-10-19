import { describe, expect, it } from "vitest";
import { addInstance, addType, columnsOf, deleteEdge, deleteNode, edgesOf, emptyGraph, parseValue, rawValue, upsertColumn } from "./graph";
import { setLocale } from "./locale";
import { fromGraphML, fromJSON, toGraphML, toJSON } from "./io";
import { sampleGraph } from "./sample";

describe("graph model", () => {
  it("derives typeOf and relation edges from the data", () => {
    const edges = edgesOf(sampleGraph());
    expect(edges.filter((e) => e.kind === "typeOf")).toHaveLength(7);
    expect(edges).toContainEqual(expect.objectContaining({ source: "person_alice", target: "comp_acme", relation: "Employer", kind: "column" }));
    expect(edges).toContainEqual(expect.objectContaining({ source: "person_alice", target: "person_bob", kind: "free" }));
  });

  it("discovers schemaless properties as extra columns", () => {
    const keys = columnsOf(sampleGraph(), "type_person").map((c) => c.key);
    expect(keys).toEqual(["name", "age", "birthday", "currentAge", "isRemote", "company", "employerCity", "hobbies", "certificates"]);
  });

  it("deleting a type removes its instances and dangling references", () => {
    const g = sampleGraph();
    deleteNode(g, "type_company");
    expect(g.nodes.comp_acme).toBeUndefined();
    expect(g.nodes.person_alice.props.company).toBeUndefined();
    expect(g.nodes.type_person.columns?.find((c) => c.key === "company")?.type).toBe("text");
  });

  it("deleting a relation edge clears the property", () => {
    const g = sampleGraph();
    deleteEdge(g, edgesOf(g).find((e) => e.id === "proj_alpha:lead:person_alice")!);
    expect(g.nodes.proj_alpha.props.lead).toBeUndefined();
  });

  it("parses cell input per column type", () => {
    const g = emptyGraph();
    const t = addType(g, "Firma");
    const acme = addInstance(g, t, "Acme");
    const num = { key: "n", label: "n", type: "number" as const };
    const date = { key: "d", label: "d", type: "date" as const };
    setLocale("de-DE");
    expect(parseValue(g, num, "1.234,5")).toBe(1234.5);
    expect(parseValue(g, date, "5.3.2024")).toBe("2024-03-05");
    expect(rawValue(g, num, 0.5)).toBe("0,5");
    setLocale("en-US");
    expect(parseValue(g, num, "1,234.5")).toBe(1234.5);
    expect(parseValue(g, num, "3.14")).toBe(3.14);
    expect(parseValue(g, date, "3/5/2024")).toBe("2024-03-05");
    expect(parseValue(g, date, "2/30/2024")).toBe("2/30/2024");
    expect(rawValue(g, date, "2024-03-05")).toBe("03/05/2024");
    expect(parseValue(g, { key: "b", label: "b", type: "boolean" }, "TRUE")).toBe(true);
    expect(parseValue(g, { key: "b", label: "b", type: "boolean" }, "no")).toBe(false);
    const rel = { key: "r", label: "r", type: "relation" as const, targetTypeId: t };
    expect(parseValue(g, rel, "acme")).toBe(acme);
    const created = parseValue(g, rel, "Neu GmbH") as string;
    expect(g.nodes[created]).toMatchObject({ props: { name: "Neu GmbH" }, typeId: t, no: 2 });
  });

  it("a link cell can hold several targets, separated by commas", () => {
    const g = sampleGraph();
    const lead = g.nodes.type_project.columns!.find((c) => c.key === "lead")!;
    g.nodes.proj_alpha.props.lead = parseValue(g, lead, "Alice Schmidt, Bob Meier, Dana New")!;
    const ids = g.nodes.proj_alpha.props.lead as string[];
    expect(ids.slice(0, 2)).toEqual(["person_alice", "person_bob"]);
    expect(g.nodes[ids[2]].props.name).toBe("Dana New");
    expect(rawValue(g, lead, ids)).toBe("Alice Schmidt, Bob Meier, Dana New");
    expect(edgesOf(g).filter((e) => e.source === "proj_alpha" && e.colKey === "lead").map((e) => e.target)).toEqual(ids);
    // Removing one edge or deleting one person keeps the other links.
    deleteEdge(g, edgesOf(g).find((e) => e.id === "proj_alpha:lead:person_bob")!);
    deleteNode(g, ids[2]);
    expect(g.nodes.proj_alpha.props.lead).toBe("person_alice");
  });

  it("a name with a comma stays one link when it exists", () => {
    const g = sampleGraph();
    g.nodes.comp_acme.props.name = "Acme, Inc.";
    const client = g.nodes.type_project.columns!.find((c) => c.key === "client")!;
    expect(parseValue(g, client, "acme, inc.")).toBe("comp_acme");
  });

  it("upsertColumn renames in place", () => {
    const g = emptyGraph();
    const t = addType(g);
    upsertColumn(g, t, { key: "a", label: "A", type: "text" });
    upsertColumn(g, t, { key: "a", label: "Alpha", type: "text" });
    expect(g.nodes[t].columns).toEqual([{ key: "name", label: "Name", type: "text" }, { key: "a", label: "Alpha", type: "text" }]);
  });
});

describe("import / export", () => {
  it("round-trips JSON", () => {
    expect(fromJSON(toJSON(sampleGraph()))).toEqual(sampleGraph());
  });

  it("round-trips GraphML", () => {
    expect(fromGraphML(toGraphML(sampleGraph()))).toEqual(sampleGraph());
  });

  it("imports the v1 JSON format", () => {
    const v1 = {
      version: "1.0",
      nodes: [
        { id: "t", label: "Person", isType: true, color: "#3b82f6", properties: {}, typeProperties: [{ key: "boss", label: "Chef", type: "relation", targetTypeId: "t", relationName: "reportsTo" }] },
        { id: "a", label: "Alice", isType: false, typeId: "t", properties: { boss: "b" } },
        { id: "b", label: "Bob", isType: false, properties: {} },
      ],
      edges: [
        { id: "e1", source: "a", target: "t", relation: "typeOf" },
        { id: "e2", source: "b", target: "t", relation: "typeOf" },
        { id: "e3", source: "a", target: "b", relation: "reportsTo" },
        { id: "e4", source: "b", target: "a", relation: "knows" },
      ],
    };
    const g = fromJSON(JSON.stringify(v1));
    expect(g.nodes.b).toMatchObject({ typeId: "t", no: 2, props: { name: "Bob" } });
    expect(g.nodes.a.label).toBeUndefined();
    expect(g.nodes.t.columns).toEqual([{ key: "name", label: "Name", type: "text" }, { key: "boss", label: "Chef", type: "relation", targetTypeId: "t" }]);
    expect(Object.values(g.edges)).toEqual([{ id: "e4", source: "b", target: "a", relation: "knows" }]);
  });

  it("imports foreign GraphML with generated key ids", () => {
    const xml = `<graphml><key id="d0" for="node" attr.name="label"/><key id="d1" for="node" attr.name="city"/>
      <graph><node id="x"><data key="d0">X</data><data key="d1">Berlin</data></node><node id="y"/>
      <edge source="x" target="y"><data key="d9">knows</data></edge></graph></graphml>`;
    const g = fromGraphML(xml);
    expect(g.nodes.x).toEqual({ id: "x", label: "X", props: { city: "Berlin" } });
    expect(Object.values(g.edges)[0]).toMatchObject({ source: "x", target: "y" });
  });
});
