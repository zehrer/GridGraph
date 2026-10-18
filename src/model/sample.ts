import type { Column, Graph, GraphNode, Value } from "./types";

const type = (id: string, label: string, color: string, columns: Column[]): GraphNode => ({ id, label, isType: true, color, columns, props: {} });
const inst = (id: string, typeId: string, label: string, props: Record<string, Value>): GraphNode => ({ id, label, typeId, props });

/** Demo data: three types, cross-type relations and a few schemaless extra properties. */
export function sampleGraph(): Graph {
  const nodes = [
    type("type_person", "Person", "#1a73e8", [
      { key: "age", label: "Age", type: "number" },
      { key: "birthday", label: "Birthday", type: "date" },
      { key: "isRemote", label: "Remote", type: "boolean" },
      { key: "company", label: "Employer", type: "relation", targetTypeId: "type_company" },
    ]),
    type("type_company", "Company", "#188038", [
      { key: "city", label: "City", type: "text" },
      { key: "employees", label: "Employees", type: "number" },
      { key: "isHiring", label: "Hiring", type: "boolean" },
    ]),
    type("type_project", "Project", "#e37400", [
      { key: "budget", label: "Budget (€)", type: "number" },
      { key: "deadline", label: "Deadline", type: "date" },
      { key: "client", label: "Client", type: "relation", targetTypeId: "type_company" },
      { key: "lead", label: "Lead", type: "relation", targetTypeId: "type_person" },
    ]),
    inst("comp_acme", "type_company", "Acme Technologies", { city: "Berlin", employees: 120, isHiring: true, industry: "Software & AI" }),
    inst("comp_nova", "type_company", "Nova Dynamics", { city: "Munich", employees: 45, isHiring: false }),
    inst("person_alice", "type_person", "Alice Schmidt", { age: 32, birthday: "1994-05-14", isRemote: true, company: "comp_acme", hobbies: "Photography & hiking" }),
    inst("person_bob", "type_person", "Bob Meier", { age: 28, birthday: "1998-11-20", isRemote: false, company: "comp_acme" }),
    inst("person_clara", "type_person", "Clara Weber", { age: 41, isRemote: true, company: "comp_nova", certificates: "Scrum Master, AWS Pro" }),
    inst("proj_alpha", "type_project", "Graph Engine V2", { budget: 150000, deadline: "2026-12-31", client: "comp_acme", lead: "person_alice" }),
    inst("proj_beta", "type_project", "Cloud Portal", { budget: 85000, deadline: "2027-04-15", client: "comp_nova", lead: "person_clara" }),
  ];
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    edges: { edge_mentor: { id: "edge_mentor", source: "person_alice", target: "person_bob", relation: "mentors" } },
  };
}
