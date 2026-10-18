import { useStore } from "../model/store";
import { typesOf } from "../model/graph";
import { addRow, currentSheet, deleteRows, setColumnType, sortBy } from "./actions";

const TYPES = [
  ["text", "Text"],
  ["number", "Number"],
  ["date", "Date"],
  ["boolean", "Yes / No"],
] as const;

export function Toolbar() {
  const s = useStore();
  const column = s.sel.col >= 1 ? currentSheet().columns[s.sel.col - 1] : undefined;
  const sheet = s.view === "sheet";
  const typeValue = column ? (column.type === "relation" ? `rel:${column.targetTypeId ?? ""}` : column.type) : "";

  return (
    <div className="toolbar">
      <button title="Undo" disabled={!s.past.length} onClick={s.undo}>↶</button>
      <button title="Redo" disabled={!s.future.length} onClick={s.redo}>↷</button>
      <span className="sep" />
      <button title="Add row" disabled={!sheet} onClick={addRow}>＋ Row</button>
      <button title="Delete selected rows" disabled={!sheet || s.sel.row < 1} onClick={deleteRows}>− Row</button>
      <span className="sep" />
      <select
        title="Data type of the selected column"
        disabled={!sheet || !column}
        value={typeValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith("rel:")) setColumnType(s.sel.col, "relation", v.slice(4));
          else setColumnType(s.sel.col, v as (typeof TYPES)[number][0]);
        }}
      >
        {!column && <option value="">Column type</option>}
        {TYPES.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
        <optgroup label="Link to …">
          {typesOf(s.graph).map((t) => (
            <option key={t.id} value={`rel:${t.id}`}>→ {t.label}</option>
          ))}
        </optgroup>
      </select>
      <span className="sep" />
      <button title="Sort ascending" disabled={!sheet} onClick={() => sortBy(s.sel.col, true)}>A→Z</button>
      <button title="Sort descending" disabled={!sheet} onClick={() => sortBy(s.sel.col, false)}>Z→A</button>
      {s.sort && <button title="Clear sorting" onClick={() => useStore.setState({ sort: null })}>✕</button>}
      <span className="sep" />
      <input className="search" placeholder="Search" value={s.filter} disabled={!sheet} onChange={(e) => useStore.setState({ filter: e.target.value })} />
      <div className="spacer" />
      <div className="segmented">
        <button className={sheet ? "on" : ""} onClick={() => s.setView("sheet")}>Table</button>
        <button className={sheet ? "" : "on"} onClick={() => s.setView("graph", null)}>Graph</button>
      </div>
    </div>
  );
}
