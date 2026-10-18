import { useStore } from "../model/store";
import { columnsOf, typesOf } from "../model/graph";
import { setColumnType, sortBy } from "./actions";

const TYPES = [
  ["text", "Text"],
  ["number", "Zahl"],
  ["date", "Datum"],
  ["boolean", "Ja / Nein"],
] as const;

export function Toolbar() {
  const s = useStore();
  const column = s.sel.col >= 1 ? columnsOf(s.graph, s.activeTypeId)[s.sel.col - 1] : undefined;
  const sheet = s.view === "sheet";
  const typeValue = column ? (column.type === "relation" ? `rel:${column.targetTypeId ?? ""}` : column.type) : "";

  return (
    <div className="toolbar">
      <button title="Rückgängig" disabled={!s.past.length} onClick={s.undo}>↶</button>
      <button title="Wiederholen" disabled={!s.future.length} onClick={s.redo}>↷</button>
      <span className="sep" />
      <select
        title="Datentyp der markierten Spalte"
        disabled={!sheet || !column}
        value={typeValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith("rel:")) setColumnType(s.sel.col, "relation", v.slice(4));
          else setColumnType(s.sel.col, v as (typeof TYPES)[number][0]);
        }}
      >
        {!column && <option value="">Spaltentyp</option>}
        {TYPES.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
        <optgroup label="Verknüpfung zu …">
          {typesOf(s.graph).map((t) => (
            <option key={t.id} value={`rel:${t.id}`}>→ {t.label}</option>
          ))}
        </optgroup>
      </select>
      <span className="sep" />
      <button title="Aufsteigend sortieren" disabled={!sheet} onClick={() => sortBy(s.sel.col, true)}>A→Z</button>
      <button title="Absteigend sortieren" disabled={!sheet} onClick={() => sortBy(s.sel.col, false)}>Z→A</button>
      {s.sort && <button title="Sortierung aufheben" onClick={() => useStore.setState({ sort: null })}>✕</button>}
      <span className="sep" />
      <input className="search" placeholder="Suchen" value={s.filter} disabled={!sheet} onChange={(e) => useStore.setState({ filter: e.target.value })} />
      <div className="spacer" />
      <div className="segmented">
        <button className={sheet ? "on" : ""} onClick={() => s.setView("sheet")}>Tabelle</button>
        <button className={sheet ? "" : "on"} onClick={() => s.setView("graph", null)}>Graph</button>
      </div>
    </div>
  );
}
