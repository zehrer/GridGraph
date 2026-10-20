import { useStore } from "../model/store";
import { columnsOf, typesOf } from "../model/graph";
import { numberFormat } from "../model/formula";
import { NUMBER_FORMATS } from "../model/locale";
import { TYPE_NAMES, metaRelations, typeStats } from "../model/meta";
import type { Column } from "../model/types";
import { showInSheet } from "./actions";

/** Inspector of the model view: a type's properties in detail and its relations to other types. */
export function ModelInspector({ typeId, onClose, onSelect }: { typeId: string; onClose: () => void; onSelect: (id: string) => void }) {
  const graph = useStore((s) => s.graph);
  const t = graph.nodes[typeId];
  if (!t?.isType) return null;
  const stats = typeStats(graph, typeId);
  const relations = metaRelations(graph);
  const outgoing = relations.filter((r) => r.from === typeId);
  const incoming = relations.filter((r) => r.to === typeId && r.from !== typeId);

  const detail = (c: Column) => {
    if (c.type === "relation") return `→ ${graph.nodes[c.targetTypeId ?? ""]?.label ?? "?"}`;
    if (c.type === "formula") return c.formula ?? "";
    const format = numberFormat(graph, typeId, c) ?? (c.type === "date" ? c.format : undefined);
    return format ? (NUMBER_FORMATS.find(([f]) => f === format)?.[1] ?? format) : "";
  };

  return (
    <aside className="inspector model-inspector">
      <header>
        <i style={{ background: t.color }} />
        <b>{t.label}</b>
        <span>{stats.rows} rows{t.hiddenSheet ? " · hidden sheet" : ""}</span>
        <button title="Close" onClick={onClose}>×</button>
      </header>

      <h4>Properties ({columnsOf(graph, typeId).length})</h4>
      <table className="props">
        <tbody>
          {columnsOf(graph, typeId).map((c) => (
            <tr key={c.key} title={c.key === t.nameKey ? "Name column" : undefined}>
              <td className={c.key === t.nameKey ? "name" : ""}>{c.key === t.nameKey ? "◆ " : ""}{c.label}{c.hidden ? " (hidden)" : ""}</td>
              <td>
                {TYPE_NAMES[c.type]}
                {detail(c) && <small>{detail(c)}</small>}
              </td>
              <td className="fill" title="Rows with a value">{stats.filled[c.key] ?? 0}/{stats.rows}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Relations</h4>
      <ul>
        {outgoing.map((r) => (
          <li key={r.id}>
            <span className="rel">{r.column.label}{r.many ? " (many)" : ""} →</span>
            <a onClick={() => onSelect(r.to)}>{graph.nodes[r.to].label}</a>
          </li>
        ))}
        {incoming.map((r) => (
          <li key={r.id}>
            <a onClick={() => onSelect(r.from)}>{graph.nodes[r.from].label}</a>
            <span className="rel">→ {r.column.label}{r.many ? " (many)" : ""}</span>
          </li>
        ))}
        {!outgoing.length && !incoming.length && <li className="none">No links to other types</li>}
      </ul>
      <p className="hint">{typesOf(graph).length} types · Shift + drag from one type to another adds a link column.</p>

      <footer>
        <button onClick={() => showInSheet(typeId)}>Open sheet</button>
      </footer>
    </aside>
  );
}
