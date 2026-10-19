import { useEffect } from "react";
import { useStore } from "../model/store";
import { focusFilter, goBack, importFile } from "./actions";
import { GraphView } from "./GraphView";
import { Header } from "./Header";
import { Sheet } from "./Sheet";
import { SheetTabs } from "./SheetTabs";
import { FormulaEditor } from "./FormulaEditor";
import { CsvImport } from "./CsvImport";
import { Toolbar } from "./Toolbar";

export function App() {
  const view = useStore((s) => s.view);
  // Remount the sheet when the notation changes: its memoized rows cache formatted values.
  const notation = useStore((s) => s.prefs.notation);
  const name = useStore((s) => s.db.name);
  useEffect(() => void (document.title = `${name} – GridGraph`), [name]);

  // App-wide shortcuts; text fields keep their own native undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.target as HTMLElement).tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      const s = useStore.getState();
      if (k === "z") e.shiftKey ? s.redo() : s.undo();
      else if (k === "y") s.redo();
      else if (k === "o") importFile();
      else if (k === "f") focusFilter();
      else if (k === "[") goBack();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <Header />
      <Toolbar />
      <main>{view === "sheet" ? <Sheet key={notation} /> : <GraphView />}</main>
      <SheetTabs />
      <FormulaEditor />
      <CsvImport />
    </div>
  );
}
