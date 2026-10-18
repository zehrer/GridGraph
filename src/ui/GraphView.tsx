import { useEffect, useRef, useState } from "react";
import { useStore } from "../model/store";
import { addEdge, columnsOf, deleteEdge, deleteNode, displayValue, edgesOf, nodeColor } from "../model/graph";
import { showInSheet } from "./actions";
import { GraphCanvas } from "./graph-canvas";

export function GraphView() {
  const ref = useRef<HTMLCanvasElement>(null);
  const canvas = useRef<GraphCanvas | null>(null);
  const { graph, focusNodeId, edit } = useStore();
  const [selected, setSelected] = useState<string | null>(focusNodeId);

  useEffect(() => {
    const c = new GraphCanvas(ref.current!, {
      select: setSelected,
      open: showInSheet,
      connect: (source, target) => {
        const relation = prompt("Name der Beziehung:", "relatesTo")?.trim();
        if (relation) useStore.getState().edit((g) => addEdge(g, source, target, relation));
      },
    });
    canvas.current = c;
    c.setGraph(useStore.getState().graph);
    // Let the layout settle a little, then frame the graph (or the focused node).
    const t = setTimeout(() => (focusNodeId ? c.focus(focusNodeId) : c.fit()), 400);
    return () => (clearTimeout(t), c.dispose());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => canvas.current?.setGraph(graph), [graph]);

  const node = selected ? graph.nodes[selected] : undefined;
  const select = (id: string) => {
    setSelected(id);
    canvas.current?.focus(id);
  };

  return (
    <div className="graph-view">
      <canvas ref={ref} />
      <div className="graph-tools">
        <button title="Vergrößern" onClick={() => canvas.current?.zoomBy(1.25)}>+</button>
        <button title="Verkleinern" onClick={() => canvas.current?.zoomBy(0.8)}>−</button>
        <button title="Alles anzeigen" onClick={() => canvas.current?.fit()}>⤢</button>
      </div>
      <div className="graph-hint">Ziehen: verschieben · Shift + Ziehen: Kante anlegen · Doppelklick: in Tabelle öffnen</div>

      {node && (
        <aside className="inspector">
          <header>
            <i style={{ background: nodeColor(graph, node) }} />
            <b>{node.label || "—"}</b>
            <span>{node.isType ? "Typ" : graph.nodes[node.typeId!]?.label}</span>
            <button title="Schließen" onClick={() => (setSelected(null), canvas.current && (canvas.current.selected = null))}>×</button>
          </header>
          {!node.isType && node.typeId && (
            <dl>
              {columnsOf(graph, node.typeId).filter((c) => node.props[c.key] !== undefined).map((c) => (
                <div key={c.key}><dt>{c.label}</dt><dd>{displayValue(graph, c, node.props[c.key])}</dd></div>
              ))}
            </dl>
          )}
          <h4>Kanten</h4>
          <ul>
            {edgesOf(graph).filter((e) => e.source === node.id || e.target === node.id).map((e) => {
              const out = e.source === node.id;
              const other = graph.nodes[out ? e.target : e.source];
              return (
                <li key={e.id}>
                  <span className="rel">{out ? `${e.relation} →` : `← ${e.relation}`}</span>
                  <a onClick={() => select(other.id)}>{other.label || "—"}</a>
                  {e.kind !== "typeOf" && <button title="Kante löschen" onClick={() => edit((g) => deleteEdge(g, e))}>×</button>}
                </li>
              );
            })}
          </ul>
          <footer>
            <button onClick={() => showInSheet(node.id)}>In Tabelle öffnen</button>
            <button className="danger" onClick={() => {
              if (confirm(`„${node.label}“ löschen?`)) {
                edit((g) => deleteNode(g, node.id));
                setSelected(null);
              }
            }}>Löschen</button>
          </footer>
        </aside>
      )}
    </div>
  );
}
