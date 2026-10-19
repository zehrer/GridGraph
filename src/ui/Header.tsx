import { useState } from "react";
import { useStore } from "../model/store";
import { typesOf } from "../model/graph";
import * as A from "./actions";
import { MenuList, type MenuItem } from "./Menu";
import { openDatabase } from "../model/persist";
import { Settings } from "./Settings";
import { viewItems } from "./ViewSelector";
import { About } from "./About";
import { DATE_FORMATS, NUMBER_FORMATS, displayDate, displayNumber } from "../model/locale";
import type { Column } from "../model/types";

const SAMPLE_DATE = "2026-11-25";

/** Format menu for the selected column(s); checks reflect the first selected column. */
function formatItems(): MenuItem[] {
  const cols = A.selectedColumns();
  const c = cols[0];
  const off = !c || useStore.getState().view !== "sheet";
  const check = (on: boolean, label: string) => `${on ? "✓ " : "\u2003"}${label}`;
  // format "" is the automatic (locale) notation.
  const item = (type: Column["type"], format: string, label: string, example?: string): MenuItem => ({
    // Formula columns keep their formula; for them number and date items only set the format.
    label: check((c?.type === type || (c?.type === "formula" && (type === "number" || type === "date"))) && (c.format ?? "") === format, label),
    shortcut: example,
    disabled: off || (c.type === "formula" && type !== "number" && type !== "date"),
    action: () => A.formatColumns(type, format),
  });
  return [
    { heading: off ? "Select a column to format" : cols.length > 1 ? `${cols.length} columns` : `Column "${c.label}"` },
    item("text", "", "Text"),
    item("boolean", "", "Yes / No"),
    { label: check(c?.type === "formula", c?.type === "formula" ? "Formula… (edit)" : "Formula…"), shortcut: "ƒ", disabled: off || c.key === A.currentSheet().type.nameKey, action: () => A.openFormula(c.key) },
    "-",
    { heading: "Number" },
    item("number", "", "Automatic", displayNumber(1234.5)),
    ...NUMBER_FORMATS.map(([f, label]) => item("number", f, label, displayNumber(f === "percent" ? 0.125 : 1234.5, f))),
    "-",
    { heading: "Date" },
    item("date", "", "Automatic", displayDate(SAMPLE_DATE)),
    ...DATE_FORMATS.map((f) => item("date", f, f, displayDate(SAMPLE_DATE, f))),
    "-",
    { label: check(!!c?.wrap, "Wrap text"), disabled: off, action: () => A.wrapColumns(!c.wrap) },
  ];
}

const MOD = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+";

export function Header() {
  const [open, setOpen] = useState<number | null>(null);
  const [settings, setSettings] = useState(false);
  const [about, setAbout] = useState(false);
  const s = useStore();
  const { sel } = s;
  const m = A.currentSheet();
  const hasRow = Math.max(sel.row, s.anchor.row) >= 1 && Math.min(sel.row, s.anchor.row) - 1 < m.rows.length;
  const hasCol = sel.col >= 1 && sel.col <= m.columns.length && m.columns[sel.col - 1].key !== m.type.nameKey;
  const hiddenCount = m.all.filter((c) => c.hidden).length;
  const sheet = s.view === "sheet";
  const hiddenSheets = typesOf(s.graph).filter((t) => t.hiddenSheet);
  const colSelected = sel.col === 0 || !!m.columns[sel.col - 1];

  const menus: { label: string; items: MenuItem[] }[] = [
    {
      label: "File",
      items: [
        { label: "New database", action: A.newDatabase },
        { label: "Import (JSON, GraphML, HTML, CSV)…", shortcut: `${MOD}O`, action: () => A.importFile() },
        { label: "Import CSV / TSV as sheet…", action: A.importCSV },
        { label: "Open sample: Projects & people", action: A.loadSample },
        { label: "Open sample: Le Monde's 100 books", action: A.loadLeMondeSample },
        "-",
        { label: "Export as JSON", action: A.exportJSON },
        { label: "Export as GraphML", action: A.exportGraphML },
        { label: "Export as HTML (view in any browser)", action: A.exportHTML },
        "-",
        ...(s.dbs.length ? [{ heading: "Saved in this browser" }] : []),
        ...s.dbs.map((d) => ({
          label: `${d.id === s.db.id ? "✓ " : "\u2003"}${d.name}`,
          shortcut: new Date(d.updatedAt).toLocaleDateString(),
          action: () => openDatabase(d.id),
        })),
        ...(s.dbs.length ? ["-" as const] : []),
        { label: "Delete database…", disabled: !s.dbs.some((d) => d.id === s.db.id), action: A.deleteCurrentDatabase },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: `${MOD}Z`, disabled: !s.past.length, action: s.undo },
        { label: "Redo", shortcut: `⇧${MOD}Z`, disabled: !s.future.length, action: s.redo },
        "-",
        { label: "Cut", shortcut: `${MOD}X`, action: () => A.copySelection(true) },
        { label: "Copy", shortcut: `${MOD}C`, action: () => A.copySelection() },
        { label: "Paste", shortcut: `${MOD}V`, action: A.pasteFromClipboard },
        "-",
        { label: "Delete row(s)", disabled: !hasRow, action: A.deleteRows },
        { label: "Delete column", disabled: !hasCol, action: () => A.deleteColumn(sel.col) },
      ],
    },
    {
      label: "View",
      items: [
        { label: `${sheet ? "✓ " : "\u2003"}Table`, action: () => s.setView("sheet") },
        { label: `${sheet ? "\u2003" : "✓ "}Graph`, action: () => s.setView("graph", m.rows[sel.row - 1]?.id ?? null) },
        "-",
        { label: `${s.prefs.summaryRow ? "✓ " : "\u2003"}Summary row`, action: () => s.setPrefs({ summaryRow: !s.prefs.summaryRow }) },
        { label: hiddenCount ? `Show ${hiddenCount} hidden column${hiddenCount > 1 ? "s" : ""}` : "No hidden columns", disabled: !hiddenCount, action: () => A.unhideColumns() },
        ...(hiddenSheets.length ? (["-", { heading: "Hidden sheets" }] as MenuItem[]) : []),
        ...hiddenSheets.map((t): MenuItem => ({ label: `Show “${t.label}”`, action: () => A.setSheetHidden(t.id, false) })),
        "-",
        { label: "Settings…", action: () => setSettings(true) },
      ],
    },
    {
      label: "Insert",
      items: [
        { label: "Row", action: A.addRow },
        { label: "Column", action: () => s.select({ row: 0, col: m.columns.length + 1 }) },
        { label: "Formula column…", disabled: !sheet, action: A.addFormulaColumn },
        { label: "Sheet (type)", action: A.newSheet },
      ],
    },
    {
      label: "Format",
      items: formatItems(),
    },
    {
      label: "Data",
      items: [
        { heading: sel.col >= 1 && m.columns[sel.col - 1] ? `Column "${m.columns[sel.col - 1].label}"` : sel.col === 0 ? "Column ID" : "Select a column" },
        { label: "Sort A → Z", disabled: !sheet || !colSelected, action: () => A.sortBy(sel.col, true) },
        { label: "Sort Z → A", disabled: !sheet || !colSelected, action: () => A.sortBy(sel.col, false) },
        { label: "Sort by ID", disabled: !sheet, action: () => useStore.setState({ sort: null }) },
        "-",
        { label: m.type.filterOn ? "Remove filter" : "Create a filter", shortcut: `⇧${MOD}F`, disabled: !sheet, action: A.toggleFilters },
        { label: "Filter by selected value", disabled: !sheet || sel.row < 1 || sel.col < 1 || !m.rows[sel.row - 1], action: A.filterBySelectedValue },
        { label: "Clear all filters", disabled: !Object.keys(m.type.filters ?? {}).length, action: A.clearFilters },
        "-",
        { heading: "Filter views" },
        ...(sheet ? viewItems() : []),
        "-",
        { label: "Search rows…", shortcut: `${MOD}F`, disabled: !sheet, action: A.focusFilter },
        { label: "Clear search", disabled: !s.filter, action: () => useStore.setState({ filter: "" }) },
        "-",
        { label: "Renumber IDs…", disabled: !m.rows.length, action: A.renumberIds },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "About GridGraph", action: () => setAbout(true) },
        { label: "Where is my data stored?", action: () => setAbout(true) },
        "-",
        { label: "Documentation on GitHub", action: () => window.open("https://github.com/zehrer/GridGraph#readme", "_blank", "noopener") },
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
        <input
          key={s.db.id}
          className="title"
          defaultValue={s.db.name}
          title="Rename database"
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (!name) e.target.value = s.db.name;
            else if (name !== s.db.name) s.rename(name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              if (e.key === "Escape") e.currentTarget.value = s.db.name;
              e.currentTarget.blur();
            }
          }}
        />
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
      <div className="save-status">{s.saveError ? "⚠︎ Not saved" : s.savedAt ? `Saved ${s.savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</div>
      {settings && <Settings onClose={() => setSettings(false)} />}
      {about && <About onClose={() => setAbout(false)} />}
    </header>
  );
}
