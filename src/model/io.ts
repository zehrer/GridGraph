import { edgesOf } from "./graph";
import type { Column, Edge, Graph, GraphNode, Value } from "./types";

/** Node shape accepted on import: current format plus the v1 names (properties, typeProperties). */
type NodeInput = Partial<GraphNode> & { id: string; properties?: Record<string, Value>; typeProperties?: Column[] };
type EdgeInput = Partial<Edge> & { source: string; target: string; kind?: string };

/**
 * Builds a graph from flat node/edge lists. typeOf edges become `typeId`, and edges that
 * merely mirror a relation property are dropped because they are derived again on demand.
 */
function fromParts(nodeList: NodeInput[], edgeList: EdgeInput[]): Graph {
  const g: Graph = { nodes: {}, edges: {} };
  for (const n of nodeList) {
    g.nodes[n.id] = {
      id: n.id,
      label: n.label ?? n.id,
      ...(n.isType && { isType: true, columns: (n.columns ?? n.typeProperties ?? []).map(({ key, label, type, targetTypeId, next }) => ({ key, label: label ?? key, type: type ?? "text", ...(targetTypeId && { targetTypeId }), ...(next && { next }) })), ...(n.nameLabel && { nameLabel: n.nameLabel }) }),
      ...(n.typeId && { typeId: n.typeId }),
      ...(n.color && { color: n.color }),
      props: { ...(n.props ?? n.properties) },
    };
  }
  edgeList.forEach((e, i) => {
    const src = g.nodes[e.source];
    if (!src || !g.nodes[e.target] || e.kind === "column") return;
    const relation = e.relation ?? "relatesTo";
    if (relation === "typeOf" || e.kind === "typeOf") src.typeId ??= e.target;
    else if (!Object.values(src.props).includes(e.target)) {
      const id = e.id ?? `edge_${i}`;
      g.edges[id] = { id, source: e.source, target: e.target, relation };
    }
  });
  return g;
}

export const toJSON = (g: Graph) => JSON.stringify({ format: "gridgraph", version: 2, ...g }, null, 2);

export function fromJSON(text: string): Graph {
  const data = JSON.parse(text);
  const list = <T,>(x: unknown): T[] => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []);
  const nodes = list<NodeInput>(data?.nodes);
  if (!nodes.length) throw new Error('No nodes found ("nodes" is missing).');
  return fromParts(nodes, list<EdgeInput>(data.edges));
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "apos" }[c]};`);

const NODE_KEYS = ["label", "isType", "typeId", "color", "nameLabel", "columns", "props"] as const;
const EDGE_KEYS = ["relation", "kind"] as const;

/** GraphML for Gephi, yEd, Cytoscape. All edges (including derived ones) are written out. */
export function toGraphML(g: Graph): string {
  const data = (k: string, v: unknown) => (v === undefined ? "" : `\n      <data key="${k}">${esc(typeof v === "object" ? JSON.stringify(v) : v)}</data>`);
  const keys = [
    ...NODE_KEYS.map((k) => `  <key id="${k}" for="node" attr.name="${k}" attr.type="${k === "isType" ? "boolean" : "string"}"/>`),
    ...EDGE_KEYS.map((k) => `  <key id="${k}" for="edge" attr.name="${k}" attr.type="string"/>`),
  ];
  const nodes = Object.values(g.nodes).map(
    (n) => `    <node id="${esc(n.id)}">${NODE_KEYS.map((k) => data(k, k === "isType" ? !!n.isType : n[k])).join("")}\n    </node>`,
  );
  const edges = edgesOf(g).map(
    (e) => `    <edge id="${esc(e.id)}" source="${esc(e.source)}" target="${esc(e.target)}">${data("relation", e.relation)}${data("kind", e.kind)}\n    </edge>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
${keys.join("\n")}
  <graph id="GridGraph" edgedefault="directed">
${[...nodes, ...edges].join("\n")}
  </graph>
</graphml>
`;
}

export function fromGraphML(text: string): Graph {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid XML.");
  // Foreign files use generated key ids (d0, d1 …); map them to attribute names.
  const names = new Map([...doc.querySelectorAll("key")].map((k) => [k.id, k.getAttribute("attr.name") ?? k.id]));
  const readData = (el: Element) =>
    Object.fromEntries([...el.querySelectorAll(":scope > data")].map((d) => [names.get(d.getAttribute("key")!) ?? d.getAttribute("key")!, d.textContent?.trim() ?? ""]));
  const json = (s: string | undefined) => {
    try {
      return s ? JSON.parse(s) : undefined;
    } catch {
      return undefined;
    }
  };

  const nodes = [...doc.querySelectorAll("node")].map((el): NodeInput => {
    const { label, isType, typeId, color, nameLabel, columns, props, ...rest } = readData(el);
    return { id: el.id, label, isType: isType === "true", typeId, color, nameLabel, columns: json(columns), props: json(props) ?? rest };
  });
  const edges = [...doc.querySelectorAll("edge")].map((el): EdgeInput => {
    const d = readData(el);
    return { id: el.id || undefined, source: el.getAttribute("source")!, target: el.getAttribute("target")!, relation: d.relation ?? d.label, kind: d.kind };
  });
  return fromParts(nodes, edges);
}

export function importText(fileName: string, text: string): Graph {
  return /\.(xml|graphml)$/i.test(fileName) || text.trimStart().startsWith("<") ? fromGraphML(text) : fromJSON(text);
}

export function download(text: string, fileName: string, mime: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
