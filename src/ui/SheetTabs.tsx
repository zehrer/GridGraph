import { useState } from "react";
import { useStore } from "../model/store";
import { PALETTE, typesOf } from "../model/graph";
import { currentSheet, deleteSheet, newSheet, setSheetHidden } from "./actions";
import { MenuList } from "./Menu";
import { SelectionStats } from "./SelectionStats";

/** Bottom sheet tabs: one tab per type, like the sheets of a spreadsheet. */
export function SheetTabs() {
  const { graph, activeTypeId, setActiveType, edit, view } = useStore();
  const [menu, setMenu] = useState<"list" | string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const types = typesOf(graph);

  const rename = (id: string, label: string) => {
    setRenaming(null);
    if (label.trim() && label.trim() !== graph.nodes[id]?.label) edit((g) => (g.nodes[id].label = label.trim()));
  };

  return (
    <footer className="sheet-tabs">
      <button className="icon" title="Add sheet (type)" onClick={newSheet}>+</button>
      <div className="menu-anchor">
        <button className="icon" title="All sheets" onClick={() => setMenu("list")}>≡</button>
        {menu === "list" && (
          <MenuList
            up
            onClose={() => setMenu(null)}
            items={types.map((t) => ({ label: `${t.label ?? ""}${t.hiddenSheet ? " (hidden)" : ""}`, action: () => (setActiveType(t.id), useStore.getState().setView("sheet")) }))}
          />
        )}
      </div>
      {types.filter((t) => !t.hiddenSheet || t.id === activeTypeId).map((t) => {
        const active = t.id === activeTypeId && view === "sheet";
        return (
          <div
            key={t.id}
            className={`tab menu-anchor${active ? " active" : ""}${t.hiddenSheet ? " hidden-sheet" : ""}`}
            title={t.hiddenSheet ? "Hidden sheet – shown while it is open" : undefined}
            style={active ? { borderBottomColor: t.color } : undefined}
            onClick={() => {
              setActiveType(t.id);
              useStore.getState().setView("sheet");
            }}
            onDoubleClick={() => setRenaming(t.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(t.id);
            }}
          >
            {renaming === t.id ? (
              <input autoFocus defaultValue={t.label} onBlur={(e) => rename(t.id, e.target.value)} onKeyDown={(e) => {
                if (e.key === "Enter") rename(t.id, e.currentTarget.value);
                if (e.key === "Escape") setRenaming(null);
              }} />
            ) : (
              <span>{t.label}</span>
            )}
            {active && <button className="caret" onClick={(e) => (e.stopPropagation(), setMenu(t.id))}>▾</button>}
            {menu === t.id && (
              <MenuList up onClose={() => setMenu(null)} items={[
                { label: "Rename", action: () => setRenaming(t.id) },
                t.hiddenSheet
                  ? { label: "Show sheet", action: () => setSheetHidden(t.id, false) }
                  : { label: "Hide sheet", disabled: types.filter((x) => !x.hiddenSheet).length < 2, action: () => setSheetHidden(t.id, true) },
                { label: "Delete", action: () => deleteSheet(t.id) },
              ]}>
                <div className="swatches">
                  {PALETTE.map((c) => (
                    <button key={c} style={{ background: c }} className={c === t.color ? "on" : ""} title="Color" onClick={() => {
                      setMenu(null);
                      edit((g) => (g.nodes[t.id].color = c));
                    }} />
                  ))}
                </div>
              </MenuList>
            )}
          </div>
        );
      })}
      {view === "sheet" && <RowCount />}
      {view === "sheet" && <SelectionStats />}
    </footer>
  );
}

/** "3 of 10 rows" while a search or column filter hides rows. */
function RowCount() {
  useStore((s) => s.graph);
  useStore((s) => s.filter);
  useStore((s) => s.activeTypeId);
  const m = currentSheet();
  if (m.rows.length === m.total) return null;
  return (
    <div className="row-count" title="Rows shown by the current search and filters">
      {m.rows.length} of {m.total} rows
    </div>
  );
}
