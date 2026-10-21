import { describe, expect, it } from "vitest";
import { addInstance, columnsOf, convertColumn, deleteNode, patchColumn, setProp, upsertColumn } from "./graph";
import { checkIn, describe as describeChange, diff, marks, revert, startHistory, summarize } from "./history";
import { sampleGraph } from "./sample";

describe("version history", () => {
  it("starts with everything checked in", () => {
    const g = sampleGraph();
    const h = startHistory(g);
    expect(h.commits).toHaveLength(1);
    expect(diff(h.head, g)).toEqual([]);
  });

  it("finds changed cells, new and removed rows, and column changes", () => {
    const g = sampleGraph();
    const h = startHistory(g);
    setProp(g, "person_alice", "age", 33);
    const id = addInstance(g, "type_person", "Dora");
    deleteNode(g, "person_bob");
    upsertColumn(g, "type_person", { key: "x", label: "Phone", type: "text" });
    const changes = diff(h.head, g);
    expect(changes.find((c) => c.k === "cell" && c.id === "person_alice")).toMatchObject({ key: "age", before: 32, after: 33 });
    expect(changes.some((c) => c.k === "add" && c.id === id)).toBe(true);
    expect(changes.some((c) => c.k === "remove" && c.id === "person_bob")).toBe(true);
    expect(changes.some((c) => c.k === "column" && c.key === "x" && !c.before)).toBe(true);
    const m = marks(changes);
    expect(m.added.has(id)).toBe(true);
    expect(m.cells.get("person_alice")!.get("age")).toBe(32);
    expect(describeChange(changes.find((c) => c.k === "cell" && c.id === "person_alice")!, g, h.head)).toBe('Person "Alice Schmidt" · Age: 32 → 33');
  });

  it("ignores display settings: widths, formats, column order, filters", () => {
    const g = sampleGraph();
    const h = startHistory(g);
    patchColumn(g, "type_person", "age", { width: 300, format: "EUR", hidden: true, wrap: true });
    g.nodes.type_person.columns!.reverse();
    g.nodes.type_person.filterOn = true;
    expect(diff(h.head, g)).toEqual([]);
  });

  it("checks in the open changes as the next version", () => {
    const g = sampleGraph();
    let h = startHistory(g);
    expect(checkIn(h, g, "nothing")).toBe(h);
    setProp(g, "person_alice", "age", 40);
    h = checkIn(h, g, "  Birthday  ");
    expect(h.commits.at(-1)).toMatchObject({ no: 2, kind: "manual", message: "Birthday" });
    expect(summarize(h.commits.at(-1)!.changes)).toBe("1 cell");
    expect(diff(h.head, g)).toEqual([]);
  });

  it("discards all changes, keeping display settings", () => {
    const g = sampleGraph();
    const h = startHistory(g);
    setProp(g, "person_alice", "age", 99);
    addInstance(g, "type_person", "Dora");
    deleteNode(g, "comp_acme"); // also removes the links to it
    const age = columnsOf(g, "type_person").find((c) => c.key === "age")!;
    convertColumn(g, "type_person", age, "text");
    patchColumn(g, "type_person", "age", { width: 222 });
    revert(g, h.head);
    expect(diff(h.head, g)).toEqual([]);
    expect(columnsOf(g, "type_person").find((c) => c.key === "age")).toMatchObject({ type: "number", width: 222 });
    expect(g.nodes.person_alice.props.company).toBe("comp_acme");
  });

  it("reverts a single cell or row", () => {
    const g = sampleGraph();
    const h = startHistory(g);
    setProp(g, "person_alice", "age", 50);
    setProp(g, "person_alice", "isRemote", false);
    revert(g, h.head, { id: "person_alice", key: "age" });
    expect(diff(h.head, g).map((c) => c.k === "cell" && c.key)).toEqual(["isRemote"]);
    revert(g, h.head, { id: "person_alice" });
    const id = addInstance(g, "type_person", "Dora");
    revert(g, h.head, { id });
    expect(diff(h.head, g)).toEqual([]);
  });
});
