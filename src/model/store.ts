import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { addType, emptyGraph, typesOf } from "./graph";
import type { Graph } from "./types";

export type View = "sheet" | "graph";
/** Sheet cell address: row 0 is the header row, rows ≥ 1 are instances; col 0 is the name column. */
export interface Cell { row: number; col: number }

/** Normalized rectangle spanned by two cells. */
export const rangeOf = (a: Cell, b: Cell) => ({
  r0: Math.min(a.row, b.row), r1: Math.max(a.row, b.row),
  c0: Math.min(a.col, b.col), c1: Math.max(a.col, b.col),
});

interface State {
  graph: Graph;
  past: Graph[];
  future: Graph[];
  view: View;
  activeTypeId: string;
  /** Active cell; together with `anchor` it spans the selected range. */
  sel: Cell;
  anchor: Cell;
  focusNodeId: string | null;
  /** Sheet view options; key "" sorts by name. */
  sort: { key: string; asc: boolean } | null;
  filter: string;
  savedAt: Date | null;
  saveError: string | null;

  /** Applies a mutation to a copy of the graph as one undoable step. */
  edit: (fn: (g: Graph) => void) => void;
  undo: () => void;
  redo: () => void;
  load: (g: Graph) => void;
  setView: (view: View, focusNodeId?: string | null) => void;
  setActiveType: (id: string) => void;
  /** Moves the active cell; `extend` keeps the anchor to grow a range. */
  select: (sel: Cell, extend?: boolean) => void;
}

const HISTORY = 100;

/** A sheet needs at least one type to show; also keeps activeTypeId valid. */
function settle(g: Graph, activeTypeId: string) {
  if (!typesOf(g).length) addType(g);
  return g.nodes[activeTypeId]?.isType ? activeTypeId : typesOf(g)[0].id;
}

export const useStore = create<State>()((set, get) => {
  const initial = emptyGraph();
  return {
    graph: initial,
    past: [],
    future: [],
    view: "sheet",
    activeTypeId: settle(initial, ""),
    sel: { row: 1, col: 0 },
    anchor: { row: 1, col: 0 },
    focusNodeId: null,
    sort: null,
    filter: "",
    savedAt: null,
    saveError: null,

    edit: (fn) => {
      const { graph, past, activeTypeId } = get();
      const next = structuredClone(graph);
      fn(next);
      set({ graph: next, past: [...past.slice(-HISTORY), graph], future: [], activeTypeId: settle(next, activeTypeId) });
    },
    undo: () => {
      const { graph, past, future, activeTypeId } = get();
      const prev = past.at(-1);
      if (prev) set({ graph: prev, past: past.slice(0, -1), future: [graph, ...future], activeTypeId: settle(prev, activeTypeId) });
    },
    redo: () => {
      const { graph, past, future, activeTypeId } = get();
      const [next, ...rest] = future;
      if (next) set({ graph: next, past: [...past, graph], future: rest, activeTypeId: settle(next, activeTypeId) });
    },
    load: (g) => {
      const { graph, past, activeTypeId } = get();
      set({ graph: g, past: [...past, graph], future: [], activeTypeId: settle(g, activeTypeId), sel: { row: 1, col: 0 }, anchor: { row: 1, col: 0 } });
    },
    setView: (view, focusNodeId = null) => set({ view, focusNodeId }),
    setActiveType: (activeTypeId) => set({ activeTypeId, sel: { row: 1, col: 0 }, anchor: { row: 1, col: 0 }, sort: null, filter: "" }),
    select: (cell, extend = false) => {
      const sel = { row: Math.max(0, cell.row), col: Math.max(0, cell.col) };
      set(extend ? { sel } : { sel, anchor: sel });
    },
  };
});

/** Loads the saved workspace from IndexedDB and autosaves every change (debounced). */
export async function initPersistence() {
  try {
    const saved = await idbGet<Graph>("graph");
    if (saved?.nodes) {
      const s = useStore.getState();
      useStore.setState({ graph: saved, activeTypeId: settle(saved, s.activeTypeId), savedAt: new Date() });
    }
  } catch (e) {
    useStore.setState({ saveError: String(e) });
  }
  let timer: ReturnType<typeof setTimeout>;
  useStore.subscribe((s, prev) => {
    if (s.graph === prev.graph) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      idbSet("graph", s.graph).then(
        () => useStore.setState({ savedAt: new Date(), saveError: null }),
        (e) => useStore.setState({ saveError: String(e) }),
      );
    }, 400);
  });
}
