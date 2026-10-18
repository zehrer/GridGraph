import { useState } from "react";
import { useStore } from "../model/store";
import { columnsOf, instancesOf } from "../model/graph";
import * as A from "./actions";
import { MenuList, type MenuItem } from "./Menu";

const MOD = navigator.platform.startsWith("Mac") ? "⌘" : "Strg+";

export function Header() {
  const [open, setOpen] = useState<number | null>(null);
  const s = useStore();
  const { sel } = s;
  const hasRow = sel.row >= 2 && sel.row - 2 < instancesOf(s.graph, s.activeTypeId).length;
  const hasCol = sel.col >= 1 && sel.col <= columnsOf(s.graph, s.activeTypeId).length;

  const menus: { label: string; items: MenuItem[] }[] = [
    {
      label: "Datei",
      items: [
        { label: "Neue Datenbank", action: A.newDatabase },
        { label: "Importieren (JSON, GraphML) …", shortcut: `${MOD}O`, action: A.importFile },
        "-",
        { label: "Exportieren als JSON", action: A.exportJSON },
        { label: "Exportieren als GraphML", action: A.exportGraphML },
        "-",
        { label: "Beispieldaten laden", action: A.loadSample },
      ],
    },
    {
      label: "Bearbeiten",
      items: [
        { label: "Rückgängig", shortcut: `${MOD}Z`, disabled: !s.past.length, action: s.undo },
        { label: "Wiederholen", shortcut: `⇧${MOD}Z`, disabled: !s.future.length, action: s.redo },
        "-",
        { label: "Zeile löschen", disabled: !hasRow, action: () => A.deleteRow(sel.row) },
        { label: "Spalte löschen", disabled: !hasCol, action: () => A.deleteColumn(sel.col) },
      ],
    },
    {
      label: "Einfügen",
      items: [
        { label: "Zeile (Instanz)", action: () => s.select({ row: instancesOf(s.graph, s.activeTypeId).length + 2, col: 0 }) },
        { label: "Spalte (Eigenschaft)", action: () => s.select({ row: 1, col: columnsOf(s.graph, s.activeTypeId).length + 1 }) },
        { label: "Blatt (Typ)", action: A.newSheet },
      ],
    },
    {
      label: "Ansicht",
      items: [
        { label: "Tabelle", action: () => s.setView("sheet") },
        { label: "Graph", action: () => s.setView("graph", A.currentSheet().rows[sel.row - 2]?.id ?? null) },
      ],
    },
  ];

  return (
    <header className="header">
      <svg className="logo" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="6" fill="#188038" />
        <path d="M7 11h18M7 18h18M13 6v20" stroke="#fff" strokeWidth="2" opacity=".55" />
        <circle cx="20" cy="22" r="3.2" fill="#fff" />
        <circle cx="24" cy="12" r="2.4" fill="#fff" />
        <path d="M20 22l4-10" stroke="#fff" strokeWidth="1.6" />
      </svg>
      <div className="title-block">
        <div className="title">GridGraph</div>
        <nav className="menubar">
          {menus.map((m, i) => (
            <div key={m.label} className="menu-anchor">
              <button className={open === i ? "open" : ""} onMouseDown={() => setOpen(open === i ? null : i)} onMouseEnter={() => open !== null && setOpen(i)}>
                {m.label}
              </button>
              {open === i && <MenuList items={m.items} onClose={() => setOpen(null)} />}
            </div>
          ))}
        </nav>
      </div>
      <div className="save-status">{s.saveError ? "⚠︎ Nicht gespeichert" : s.savedAt ? `Gespeichert ${s.savedAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : ""}</div>
    </header>
  );
}
