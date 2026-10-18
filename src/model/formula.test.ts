import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeFormula, renameReference } from "./formula";
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

  it("renames column references", () => {
    expect(renameReference("AGE([Geburtstag]) + [geburtstag ]", "Geburtstag", "Birthday")).toBe("AGE([Birthday]) + [Birthday]");
  });
});
