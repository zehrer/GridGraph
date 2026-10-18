import { useEffect } from "react";
import { useStore } from "../model/store";
import { importFile } from "./actions";
import { GraphView } from "./GraphView";
import { Header } from "./Header";
import { Sheet } from "./Sheet";
import { SheetTabs } from "./SheetTabs";
import { Toolbar } from "./Toolbar";

export function App() {
  const view = useStore((s) => s.view);

  // App-wide shortcuts; text fields keep their own native undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.target as HTMLElement).tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      const s = useStore.getState();
      if (k === "z") e.shiftKey ? s.redo() : s.undo();
      else if (k === "y") s.redo();
      else if (k === "o") importFile();
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
      <main>{view === "sheet" ? <Sheet /> : <GraphView />}</main>
      <SheetTabs />
    </div>
  );
}
