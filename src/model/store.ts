import { create } from "zustand";
import { addType, emptyGraph, newId, typesOf } from "./graph";
import type { Graph } from "./types";

/** A database saved in this browser. */
export interface DbInfo { id: string; name: string; updatedAt: number }
export const UNTITLED = "Untitled database";
export const newDbInfo = (name = UNTITLED): DbInfo => ({ id: newId("db"), name, updatedAt: Date.now() });

export type View = "sheet" | "graph";
/** Sheet cell address: row 0 is the header row, rows ≥ 1 are instances; col 0 is the name column. */
export interface Cell { row: number; col: number }

/** Normalized rectangle spanned by two cells. */
export const rangeOf = (a: Cell, b: Cell) => ({
  r0: Math.min(a.row, b.row), r1: Math.max(a.row, b.row),
  c0: Math.min(a.col, b.col), c1: Math.max(a.col, b.col),
});

interface State {
  db: DbInfo;
  /** All databases saved in this browser, most recently saved first. */
  dbs: DbInfo[];
  /** Bumped by every change that should be saved. */
  revision: number;
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
  /** Switches to another database (clears undo history); `dirty` saves it right away. */
  open: (g: Graph, db: DbInfo, dirty?: boolean) => void;
  rename: (name: string) => void;
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
    db: newDbInfo(),
    dbs: [],
    revision: 0,
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
      set({ graph: next, past: [...past.slice(-HISTORY), graph], future: [], activeTypeId: settle(next, activeTypeId), revision: get().revision + 1 });
    },
    undo: () => {
      const { graph, past, future, activeTypeId } = get();
      const prev = past.at(-1);
      if (prev) set({ graph: prev, past: past.slice(0, -1), future: [graph, ...future], activeTypeId: settle(prev, activeTypeId), revision: get().revision + 1 });
    },
    redo: () => {
      const { graph, past, future, activeTypeId } = get();
      const [next, ...rest] = future;
      if (next) set({ graph: next, past: [...past, graph], future: rest, activeTypeId: settle(next, activeTypeId), revision: get().revision + 1 });
    },
    open: (g, db, dirty = false) =>
      set({
        graph: g, db, past: [], future: [], view: "sheet", activeTypeId: settle(g, ""),
        sel: { row: 1, col: 0 }, anchor: { row: 1, col: 0 }, sort: null, filter: "",
        savedAt: dirty ? null : new Date(db.updatedAt), revision: get().revision + (dirty ? 1 : 0),
      }),
    rename: (name) => set({ db: { ...get().db, name }, revision: get().revision + 1 }),
    setView: (view, focusNodeId = null) => set({ view, focusNodeId }),
    setActiveType: (activeTypeId) => set({ activeTypeId, sel: { row: 1, col: 0 }, anchor: { row: 1, col: 0 }, sort: null, filter: "" }),
    select: (cell, extend = false) => {
      const sel = { row: Math.max(0, cell.row), col: Math.max(0, cell.col) };
      set(extend ? { sel } : { sel, anchor: sel });
    },
  };
});

