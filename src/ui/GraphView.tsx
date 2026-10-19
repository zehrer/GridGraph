import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../model/store";
import { addEdge, columnsOf, deleteEdge, deleteNode, displayValue, edgesOf, instancesOf, nodeColor, nodeName, typesOf } from "../model/graph";
import { showInSheet } from "./actions";
import { GraphCanvas } from "./graph-canvas";
import { shownColumn } from "../model/formula";
import { filteredOut } from "../model/filter";

export function GraphView() {
  const ref = useRef<HTMLCanvasElement>(null);
  const canvas = useRef<GraphCanvas | null>(null);
  const { graph, focusNodeId, edit, prefs, setPrefs, hiddenTypes: legendOff, shownTypes } = useStore();
  // Hidden sheets (lookup tables) stay out of the graph unless shown from the legend.
  const hiddenTypes = useMemo(
    () => [...legendOff, ...typesOf(graph).filter((t) => t.hiddenSheet && !shownTypes.includes(t.id)).map((t) => t.id)],
    [legendOff, shownTypes, graph],
  );
  const hasHiddenSheets = typesOf(graph).some((t) => t.hiddenSheet);
  const showTypes = prefs.graphTypes;
  const [selected, setSelected] = useState<string | null>(focusNodeId);

  useEffect(() => {
    const c = new GraphCanvas(ref.current!, {
      select: setSelected,
      open: showInSheet,
      connect: (source, target) => {
        const relation = prompt("Relation name:", "relatesTo")?.trim();
        if (relation) useStore.getState().edit((g) => addEdge(g, source, target, relation));
      },
    });
    canvas.current = c;
    c.setShowTypes(useStore.getState().prefs.graphTypes);
    c.setHiddenTypes(hiddenTypes);
    if (useStore.getState().prefs.graphFilters) c.setHiddenNodes(filteredOut(useStore.getState().graph));
    c.setGraph(useStore.getState().graph);
    // Let the layout settle a little, then frame the graph (or the focused node).
    c.fitOnSettle = !focusNodeId;
    const t = setTimeout(() => (focusNodeId ? c.focus(focusNodeId) : c.fit()), 400);
    return () => (clearTimeout(t), c.dispose());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => canvas.current?.setGraph(graph), [graph]);
  useEffect(() => canvas.current?.setShowTypes(showTypes), [showTypes]);
  useEffect(() => canvas.current?.setHiddenTypes(hiddenTypes), [hiddenTypes]);
  // The sheets' column filters (and so their filter views) also apply to the graph.
  const filtered = useMemo(() => filteredOut(graph), [graph]);
  const useFilters = prefs.graphFilters;
  useEffect(() => canvas.current?.setHiddenNodes(useFilters ? filtered : new Set()), [filtered, useFilters]);
  const count = (typeId: string) => {
    const all = instancesOf(graph, typeId);
    const shown = useFilters ? all.filter((n) => !filtered.has(n.id)).length : all.length;
    return shown === all.length ? String(all.length) : `${shown}/${all.length}`;
  };
  const toggleType = (id: string) =>
    graph.nodes[id]?.hiddenSheet
      ? useStore.setState({ shownTypes: shownTypes.includes(id) ? shownTypes.filter((t) => t !== id) : [...shownTypes, id] })
      : useStore.setState({ hiddenTypes: legendOff.includes(id) ? legendOff.filter((t) => t !== id) : [...legendOff, id] });

  const node = selected ? graph.nodes[selected] : undefined;
  const select = (id: string) => {
    setSelected(id);
    canvas.current?.focus(id);
  };

  return (
    <div className="graph-view">
      <canvas ref={ref} />
      <div className="graph-tools">
        <button title="Zoom in" onClick={() => canvas.current?.zoomBy(1.25)}>+</button>
        <button title="Zoom out" onClick={() => canvas.current?.zoomBy(0.8)}>−</button>
        <button title="Fit to screen" onClick={() => canvas.current?.fit()}>⤢</button>
        <button className={showTypes ? "on" : ""} title={showTypes ? "Hide type nodes (show a legend)" : "Show type nodes"} onClick={() => setPrefs({ graphTypes: !showTypes })}>
          ◆
        </button>
        <button
          className={useFilters && filtered.size ? "on filtered" : ""}
          title={useFilters ? `Sheet filters apply (${filtered.size} ${filtered.size === 1 ? "row" : "rows"} hidden) – click to show all rows` : "Apply the sheets' filters to the graph"}
          onClick={() => setPrefs({ graphFilters: !useFilters })}
        >
          <svg className="funnel" viewBox="0 0 12 12" aria-hidden><path d="M1 2h10L7 6.5V10L5 11V6.5Z" /></svg>
        </button>
      </div>
      {(!showTypes || hasHiddenSheets) && (
        <div className="graph-legend">
          {typesOf(graph).map((t) => (
            <button
              key={t.id}
              className={hiddenTypes.includes(t.id) ? "off" : ""}
              title={`${hiddenTypes.includes(t.id) ? "Show" : "Hide"} ${t.label} in the graph`}
              onClick={() => toggleType(t.id)}
            >
              <i style={{ background: t.color }} />
              {t.label}
              <span>{count(t.id)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="graph-hint">Drag: move · Shift + drag: create edge · Double-click: open in table</div>

      {node && (
        <aside className="inspector">
          <header>
            <i style={{ background: nodeColor(graph, node) }} />
            <b>{nodeName(graph, node) || "—"}</b>
            <span>{node.isType ? "Type" : `${graph.nodes[node.typeId!]?.label ?? ""}${node.no ? ` #${node.no}` : ""}`}</span>
            <button title="Close" onClick={() => (setSelected(null), canvas.current && (canvas.current.selected = null))}>×</button>
          </header>
          {!node.isType && node.typeId && (
            <dl>
              {columnsOf(graph, node.typeId)
                .filter((c) => c.key !== graph.nodes[node.typeId!].nameKey)
                .map((c) => ({ c, ...shownColumn(graph, node, c) }))
                .filter(({ value }) => value !== undefined)
                .map(({ c, col, value }) => (
                  <div key={c.key}><dt>{c.label}</dt><dd>{displayValue(graph, col, value)}</dd></div>
                ))}
            </dl>
          )}
          <h4>Edges</h4>
          <ul>
            {edgesOf(graph).filter((e) => e.source === node.id || e.target === node.id).map((e) => {
              const out = e.source === node.id;
              const other = graph.nodes[out ? e.target : e.source];
              return (
                <li key={e.id}>
                  <span className="rel">{out ? `${e.relation} →` : `← ${e.relation}`}</span>
                  <a onClick={() => select(other.id)}>{nodeName(graph, other) || "—"}</a>
                  {e.kind !== "typeOf" && <button title="Delete edge" onClick={() => edit((g) => deleteEdge(g, e))}>×</button>}
                </li>
              );
            })}
          </ul>
          <footer>
            <button onClick={() => showInSheet(node.id)}>Open in table</button>
            <button className="danger" onClick={() => {
              if (confirm(`Delete "${nodeName(graph, node)}"?`)) {
                edit((g) => deleteNode(g, node.id));
                setSelected(null);
              }
            }}>Delete</button>
          </footer>
        </aside>
      )}
    </div>
  );
}
