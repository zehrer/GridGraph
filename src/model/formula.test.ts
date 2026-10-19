import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeFormula, formulaFormat, renameReference, shownColumn } from "./formula";
import { setLocale } from "./locale";
import { sampleGraph } from "./sample";

const g = sampleGraph();
const f = (nodeId: string, formula: string) => computeFormula(g, g.nodes[nodeId], formula);

describe("formulas", () => {
  beforeEach(() => {
    setLocale("en-US");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 18, 12));
  });
  afterEach(() => vi.useRealTimers());

  it("computes the age from a birthday", () => {
    expect(f("person_alice", "AGE([Birthday])")).toEqual({ value: 32, type: "number" });
    expect(f("person_alice", '=DATEDIF([Birthday]; TODAY(); "Y")').value).toBe(32);
    expect(f("person_clara", "AGE([Birthday])")).toEqual({ type: "text" });
  });

  it("does date arithmetic", () => {
    expect(f("proj_alpha", "[Deadline] - TODAY()")).toEqual({ value: 74, type: "number" });
    expect(f("proj_alpha", "[Deadline] + 1")).toEqual({ value: "2027-01-01", type: "date" });
    expect(f("proj_alpha", "YEAR([Deadline])").value).toBe(2026);
  });

  it("joins text and decides with IF", () => {
    expect(f("comp_acme", '[Name] & " (" & [City] & ")"').value).toBe("Acme Technologies (Berlin)");
    expect(f("person_clara", 'IF([Age] >= 40, "senior", "junior")').value).toBe("senior");
    expect(f("person_bob", 'IF([Age] >= 40; "senior"; "junior")').value).toBe("junior");
  });

  it("calculates with numbers, also with a decimal comma when ; separates arguments", () => {
    expect(f("proj_alpha", "ROUND([Budget (€)] * 1.19, 2)").value).toBe(178500);
    expect(f("proj_beta", "ROUND([Budget (€)] * 1,19; 0)").value).toBe(101150);
    expect(f("proj_beta", "-[Budget (€)] / 1000").value).toBe(-85);
  });

  it("follows links", () => {
    expect(f("person_alice", "[Employer].[City]").value).toBe("Berlin");
    expect(f("proj_alpha", "SUM([Client].[Employees])").value).toBe(120);
    expect(f("proj_alpha", "COUNT([Lead])").value).toBe(1);
    expect(f("proj_alpha", "[Lead].[Employer]")).toEqual({ value: "comp_acme", type: "relation" });
    expect(f("proj_alpha", "[Lead].[Employer].[City]").value).toBe("Berlin");
  });

  it("reports errors instead of throwing", () => {
    expect(f("person_alice", "AGE([Geburtstag])").error).toBe("Unknown column [Geburtstag]");
    expect(f("person_alice", "[Name] * 2").error).toBe('"Alice Schmidt" is not a number');
    expect(f("person_alice", "FOO(1)").error).toBe("Unknown function FOO");
    expect(f("person_alice", "(1 + 2").error).toBe("Missing )");
    expect(f("person_alice", "[City].[Name]").error).toBe("Unknown column [City]");
  });

  it("detects formulas that refer to themselves", () => {
    const h = sampleGraph();
    h.nodes.type_person.columns!.push({ key: "x", label: "X", type: "formula", formula: "[X] + 1" });
    expect(computeFormula(h, h.nodes.person_alice, "[X]").error).toBe("[X] refers to itself");
  });

  it("the sample's formula columns compute", () => {
    const col = (typeId: string, key: string) => g.nodes[typeId].columns!.find((c) => c.key === key)!;
    const v = (id: string, typeId: string, key: string) => computeFormula(g, g.nodes[id], col(typeId, key).formula!).value;
    expect(v("person_bob", "type_person", "employerCity")).toBe("Berlin");
    expect(v("comp_nova", "type_company", "label")).toBe("Nova Dynamics (Munich)");
    expect([v("proj_alpha", "type_project", "clientStaff"), v("proj_beta", "type_project", "perLead")]).toEqual([120, 85000]);
    expect([v("proj_alpha", "type_project", "status"), v("proj_beta", "type_project", "status")]).toEqual(["due soon", "on track"]);
  });

  it("renames column references", () => {
    expect(renameReference("AGE([Geburtstag]) + [geburtstag ]", "Geburtstag", "Birthday")).toBe("AGE([Birthday]) + [Birthday]");
  });

  it("formula results inherit the number format of the columns they calculate with", () => {
    const h = sampleGraph();
    h.nodes.type_company.columns!.push({ key: "rev", label: "Revenue", type: "number", format: "EUR" }, { key: "usd", label: "Revenue $", type: "number", format: "USD" });
    const fmt = (typeId: string, formula: string) => formulaFormat(h, typeId, { key: `f${formula}`, label: "F", type: "formula", formula });
    expect(fmt("type_project", "[Budget (€)] / COUNT([Lead])")).toBe("EUR");
    expect(fmt("type_project", "ROUND([Budget (€)] * 1.19; 2)")).toBe("EUR");
    expect(fmt("type_project", "[Budget (€)] + 500")).toBe("EUR");
    expect(fmt("type_project", 'IF([Days left] < 0; 0; [Budget (€)])')).toBe("EUR");
    expect(fmt("type_project", "SUM([Client].[Revenue])")).toBe("EUR");
    expect(fmt("type_project", "[Budget (€)] / [Budget (€)]")).toBeUndefined();
    expect(fmt("type_project", "COUNT([Lead])")).toBeUndefined();
    expect(fmt("type_company", "[Revenue] + [Revenue $]")).toBeUndefined();
    expect(fmt("type_project", "[Deadline] - TODAY()")).toBeUndefined();
    // An explicit format wins; formula columns pass their inferred format on.
    expect(formulaFormat(h, "type_project", { key: "x", label: "X", type: "formula", formula: "[Budget (€)]", format: "percent" })).toBe("percent");
    expect(fmt("type_project", "[Budget per lead] * 2")).toBe("EUR");
    // The sample's "Budget per lead" shows in euros without a format of its own.
    const perLead = h.nodes.type_project.columns!.find((c) => c.key === "perLead")!;
    expect(shownColumn(h, h.nodes.proj_alpha, perLead).col.format).toBe("EUR");
  });
});
