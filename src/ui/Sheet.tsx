import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { rangeOf, useStore, type Cell } from "../model/store";
import { displayValue, linkIds, nodeColor, nodeName } from "../model/graph";
import { parseClipboard, toHTML, toTSV } from "../model/clipboard";
import { SUMMARIES, summarize } from "../model/summary";
import { shownColumn } from "../model/formula";
import type { Column, Graph, GraphNode } from "../model/types";
import * as A from "./actions";
import { MenuList, type MenuItem } from "./Menu";
import { FilterPanel } from "./FilterPanel";
import { isActive } from "../model/filter";

const TYPE_ICON: Partial<Record<Column["type"], string>> = { number: "#", date: "◷", boolean: "☑", relation: "↗", formula: "ƒ" };
const MOVES: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
const ID_WIDTH = 56;
const DEFAULT_WIDTH = 120;

interface Edit { cell: Cell; text: string; inBar?: boolean }
type CellHandler = (e: MouseEvent, cell: Cell) => void;
type Popup = { x: number; y: number; up?: boolean; items: MenuItem[] };

export function Sheet() {
  const { graph, activeTypeId, sort, filter, sel, anchor, select, prefs } = useStore();
  const m = useMemo(() => A.sheetModel(graph, activeTypeId, { sort, filter }), [graph, activeTypeId, sort, filter]);
  const [edit, setEditState] = useState<Edit | null>(null);
  const editRef = useRef<Edit | null>(null);
  const [extraRows, setExtraRows] = useState(0);
  const [addCount, setAddCount] = useState("1000");
  const [popup, setPopup] = useState<Popup | null>(null);
  const [filterFor, setFilterFor] = useState<{ key: string; x: number; y: number } | null>(null);
  const [resize, setResize] = useState<{ key: string; width: number } | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Data plus one empty row/column to type into, at least as many as the user's settings ask for.
  const nRows = Math.max(m.rows.length + 1, prefs.minRows) + extraRows;
  const nCols = Math.max(m.columns.length + 2, prefs.minCols + 1);
  const range = rangeOf(anchor, sel);
  const multi = range.r0 !== range.r1 || range.c0 !== range.c1;
  const widthOf = (c?: Column) => (c && resize?.key === c.key ? resize.width : (c?.width ?? DEFAULT_WIDTH));
  const widths = [ID_WIDTH, ...Array.from({ length: nCols - 1 }, (_, i) => widthOf(m.columns[i]))];
  const setEdit = (e: Edit | null) => setEditState((editRef.current = e));
  const move = (dr: number, dc: number, from = useStore.getState().sel, extend = false) =>
    select({ row: Math.min(from.row + dr, nRows), col: Math.min(from.col + dc, nCols - 1) }, extend);

  /**
   * Ends editing; the ref guard makes Enter + the following blur commit only once.
   * Keyboard endings pass a move and return focus to the grid; a blur leaves focus where the user clicked.
   */
  const finish = (save: boolean, delta?: [number, number]) => {
    const e = editRef.current;
    if (!e) return;
    setEdit(null);
    if (save) A.commitCell(e.cell, e.text);
    if (delta) {
      move(delta[0], delta[1], e.cell);
      gridRef.current?.focus();
    }
  };

  // Stable handlers for memoized rows; they read the latest state through the ref.
  const latest = useRef({ m, graph });
  latest.current = { m, graph };
  const dragging = useRef(false);
  const onCell = useRef<CellHandler>((e, cell) => {
    const { m, graph } = latest.current;
    const { select } = useStore.getState();
    if (e.type === "dblclick") {
      // Double-clicking a link opens its target (the clicked one, if there are several); Enter, F2 or typing still edit the cell.
      const column = m.columns[cell.col - 1];
      const node = cell.row > 0 ? m.rows[cell.row - 1] : undefined;
      const shown = column && node ? shownColumn(graph, node, column) : undefined;
      const targets = shown?.col.type === "relation" ? linkIds(shown.value).filter((id) => graph.nodes[id]) : [];
      const clicked = (e.target as HTMLElement).closest<HTMLElement>("[data-node]")?.dataset.node;
      const target = clicked ?? (targets.length === 1 ? targets[0] : undefined);
      if (target) return A.followLink(target);
      return !A.readOnly(m, cell) && setEdit({ cell, text: A.cellText(graph, m, cell) });
    }
    if (e.type === "mouseenter") return dragging.current && select(cell, true);
    if (e.button !== 0) return;
    dragging.current = true;
    select(cell, e.shiftKey);
    const column = m.columns[cell.col - 1];
    if ((e.target as HTMLElement).tagName === "INPUT" && column?.type === "boolean") {
      A.commitCell(cell, String(m.rows[cell.row - 1]?.props[column.key] !== true));
    }
  }).current;

  useEffect(() => {
    const up = () => (dragging.current = false);
    // Clipboard events only reach the document; handle them while the grid has focus.
    const active = () => document.activeElement === gridRef.current && !editRef.current;
    const copy = (e: ClipboardEvent, cut = false) => {
      if (!active()) return;
      e.preventDefault();
      const matrix = A.selectionMatrix();
      e.clipboardData?.setData("text/plain", toTSV(matrix));
      e.clipboardData?.setData("text/html", toHTML(matrix));
      if (cut) A.clearSelection();
    };
    const cut = (e: ClipboardEvent) => copy(e, true);
    const paste = (e: ClipboardEvent) => {
      if (!active() || !e.clipboardData) return;
      e.preventDefault();
      A.pasteMatrix(parseClipboard(e.clipboardData.getData("text/html"), e.clipboardData.getData("text/plain")));
    };
    window.addEventListener("mouseup", up);
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("mouseup", up);
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
      document.removeEventListener("paste", paste);
    };
  }, []);

  useEffect(() => {
    gridRef.current?.querySelector(`[data-cell="${sel.row}:${sel.col}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel]);
  useEffect(() => gridRef.current?.focus(), [activeTypeId]);

  const onGridKey = (e: KeyboardEvent) => {
    if (edit || e.metaKey || e.ctrlKey || e.altKey) return;
    // Read the selection from the store: a click right before the key may not have re-rendered yet.
    const { sel } = useStore.getState();
    const delta = e.key === "Tab" ? [0, e.shiftKey ? -1 : 1] : e.key === "Enter" && e.shiftKey ? [-1, 0] : MOVES[e.key];
    if (e.key === " " && e.shiftKey) {
      // Shift+Space selects the whole rows of the selection, as in Google Sheets.
      e.preventDefault();
      const { anchor } = useStore.getState();
      select({ row: anchor.row, col: 0 });
      select({ row: sel.row, col: nCols - 1 }, true);
    } else if (delta) {
      e.preventDefault();
      move(delta[0], delta[1], sel, e.shiftKey && e.key in MOVES);
    } else if (A.readOnly(m, sel) && e.key.length === 1) {
      e.preventDefault();
    } else if ((e.key === "Enter" || e.key === "F2") && !A.readOnly(m, sel)) {
      e.preventDefault();
      select(sel);
      setEdit({ cell: sel, text: A.cellText(graph, m, sel) });
    } else if (e.key === "Backspace" || e.key === "Delete") {
      A.clearSelection();
    } else if (e.key.length === 1) {
      e.preventDefault();
      select(sel);
      setEdit({ cell: sel, text: e.key });
    }
  };

  const onEditorKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") finish(true, [e.shiftKey ? -1 : 1, 0]);
    else if (e.key === "Tab") finish(true, [0, e.shiftKey ? -1 : 1]);
    else if (e.key === "Escape") finish(false, [0, 0]);
    else return;
    e.preventDefault();
  };

  // --- Menus ---

  /** Quick filter entries for date columns (year / month) and number columns. */
  const quickItems = (col: number): MenuItem[] => {
    const c = m.columns[col - 1];
    const kinds = new Set(m.base.map((n) => shownColumn(graph, n, c).col.type));
    const qf = m.type.quickFilter?.key === c.key ? m.type.quickFilter : undefined;
    const item = (unit: "year" | "month" | "number", label: string): MenuItem => ({ label: `${qf?.unit === unit ? "✓ " : ""}${label}`, action: () => A.startQuickFilter(col, unit) });
    if (kinds.has("date") || c.type === "date") return [item("year", "Quick filter by year"), item("month", "Quick filter by month")];
    if (kinds.has("number") || c.type === "number") return [item("number", "Quick filter by value")];
    return [];
  };
  const columnMenu = (col: number): MenuItem[] => {
    if (col === 0) return [{ label: "Sort by ID", action: () => A.sortBy(0, true) }, { label: "Renumber IDs…", action: A.renumberIds }];
    const c = m.columns[col - 1];
    if (!c) return [];
    const isName = c.key === m.type.nameKey;
    return [
      { label: "Sort A → Z", action: () => A.sortBy(col, true) },
      { label: "Sort Z → A", action: () => A.sortBy(col, false) },
      "-",
      { label: "Move left", disabled: col <= 1, action: () => A.moveColumnTo(col, col - 1) },
      { label: "Move right", disabled: col >= m.columns.length, action: () => A.moveColumnTo(col, col + 1) },
      { label: `${c.wrap ? "✓ " : ""}Wrap text`, action: () => A.toggleWrap(col) },
      ...quickItems(col),
      { label: isName ? "✓ Name column" : "Use as name column", disabled: isName || c.type === "relation" || c.type === "formula", action: () => A.setNameColumn(col) },
      ...(c.type === "formula"
        ? [{ label: "Edit formula…", action: () => A.openFormula(c.key) }, { label: "Convert to values", action: () => A.convertToValues(col) }]
        : [{ label: "Formula…", disabled: isName, action: () => A.openFormula(c.key) }]),
      "-",
      { label: "Hide column", action: () => A.hideColumn(col) },
      { label: "Delete column", disabled: isName, action: () => A.deleteColumn(col) },
    ];
  };
  const rowMenu = (): MenuItem[] => {
    const { anchor, sel } = useStore.getState();
    const r = rangeOf(anchor, sel);
    const n = m.rows.slice(Math.max(r.r0, 1) - 1, r.r1).length;
    return [
      { label: "Add row", action: A.addRow },
      { label: n > 1 ? `Delete ${n} rows` : "Delete row", disabled: !n, action: A.deleteRows },
      "-",
      { label: "Cut", action: () => A.copySelection(true) },
      { label: "Copy", action: () => A.copySelection() },
      { label: "Paste", action: A.pasteFromClipboard },
    ];
  };
  const openAt = (el: Element, items: MenuItem[], up = false) => {
    const r = el.getBoundingClientRect();
    setPopup({ x: r.left, y: up ? r.top : r.bottom, up, items });
  };
  const onContextMenu = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
    if (!el) return;
    e.preventDefault();
    const [row, col] = el.dataset.cell!.split(":").map(Number);
    if (!(row >= range.r0 && row <= range.r1 && col >= range.c0 && col <= range.c1)) select({ row, col });
    const items = row === 0 ? columnMenu(col) : rowMenu();
    if (items.length) setPopup({ x: e.clientX, y: e.clientY, items });
  };

  // --- Column resize ---

  const startResize = (e: PointerEvent, c: Column) => {
    e.preventDefault();
    e.stopPropagation();
    const [startX, startW, el] = [e.clientX, widthOf(c), e.currentTarget as HTMLElement];
    const w = (x: number) => Math.max(40, startW + x - startX);
    const onMove = (ev: globalThis.PointerEvent) => setResize({ key: c.key, width: w(ev.clientX) });
    const onUp = (ev: globalThis.PointerEvent) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      setResize(null);
      if (w(ev.clientX) !== startW) A.setColumnWidth(c.key, w(ev.clientX));
    };
    el.setPointerCapture(e.pointerId);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  /** Hidden columns that sit in front of each grid column, for the "show" markers. */
  const hiddenBefore = new Map<number, Column[]>();
  let pending: Column[] = [];
  let visible = 0;
  for (const c of m.all) {
    if (c.hidden) pending.push(c);
    else {
      visible++;
      if (pending.length) hiddenBefore.set(visible, pending);
      pending = [];
    }
  }
  if (pending.length) hiddenBefore.set(visible + 1, pending);

  // --- Rendering ---

  const editColumn = edit ? m.columns[edit.cell.col - 1] : undefined;
  const editor = edit && !edit.inBar && (
    <input
      className="cell-editor"
      autoFocus
      value={edit.text}
      list={edit.cell.row > 0 && editColumn?.type === "relation" ? "relation-options" : undefined}
      onChange={(e) => setEdit({ ...edit, text: e.target.value })}
      onKeyDown={onEditorKey}
      onBlur={() => finish(true)}
    />
  );
  const target = editColumn?.type === "relation" && editColumn.targetTypeId;
  const inRange = (row: number, col: number) => multi && row >= range.r0 && row <= range.r1 && col >= range.c0 && col <= range.c1;

  const headerCell = (col: number) => {
    const c = m.columns[col - 1];
    const hidden = hiddenBefore.get(col);
    const isName = !!c && c.key === m.type.nameKey;
    const drop = drag && c && drag.over === col && drag.from !== col ? (drag.from < col ? "drop-after" : "drop-before") : "";
    const filtered = !!c && isActive(m.type.filters?.[c.key]);
    const cls = [sel.row === 0 && sel.col === col && "sel", inRange(0, col) && "in-range", col === sel.col && "hl", isName && "name-col", c?.wrap && "wrap", m.type.filterOn && c && "has-filter", drop];
    return (
      <td
        key={col}
        data-cell={`0:${col}`}
        className={cls.filter(Boolean).join(" ")}
        draggable={!!c && !edit}
        onMouseDown={(e) => onCell(e, { row: 0, col })}
        onMouseEnter={(e) => onCell(e, { row: 0, col })}
        onDoubleClick={(e) => onCell(e, { row: 0, col })}
        onDragStart={(e) => {
          dragging.current = false;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", c?.label ?? "");
          setDrag({ from: col, over: col });
        }}
        onDragOver={(e) => {
          if (!drag || !c) return;
          e.preventDefault();
          if (drag.over !== col) setDrag({ ...drag, over: col });
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (drag) A.moveColumnTo(drag.from, col);
          setDrag(null);
        }}
        onDragEnd={() => setDrag(null)}
      >
        {hidden && (
          <button className="unhide" title={`Show hidden: ${hidden.map((h) => h.label).join(", ")}`} onMouseDown={(e) => e.stopPropagation()} onClick={() => A.unhideColumns(hidden.map((h) => h.key))}>
            ⋮
          </button>
        )}
        {edit?.cell.row === 0 && edit.cell.col === col ? (editor || edit.text) : col === 0 ? "ID" : c && (
          <>
            {isName ? <i className="type-icon name-mark" title="Name column – names the rows in links and in the graph">◆</i> : TYPE_ICON[c.type] && <i className="type-icon">{TYPE_ICON[c.type]}</i>}
            {c.label}
          </>
        )}
        {c && (
          <>
            <button className="col-menu" title="Column menu" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => openAt(e.currentTarget, columnMenu(col))}>▾</button>
            {m.type.filterOn && (
              <button
                className={`filter-btn${filtered ? " on" : ""}`}
                title={filtered ? "Filtered – change filter" : "Filter this column"}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setFilterFor({ key: c.key, x: r.right - 280, y: r.bottom + 2 });
                }}
              >
                <svg viewBox="0 0 12 12" aria-hidden><path d="M1 2h10L7 6.5V10L5 11V6.5Z" /></svg>
              </button>
            )}
            <span className="resizer" title="Drag to resize" onPointerDown={(e) => startResize(e, c)} onMouseDown={(e) => e.stopPropagation()} />
          </>
        )}
      </td>
    );
  };

  const footerCell = (col: number) => {
    const c = m.columns[col - 1];
    if (!c) return <td key={col} />;
    const items: MenuItem[] = [
      { label: `${c.summary ? "" : "✓ "}None`, action: () => A.setSummary(col, undefined) },
      ...SUMMARIES.map(([k, l]): MenuItem => ({ label: `${c.summary === k ? "✓ " : ""}${l}`, action: () => A.setSummary(col, k) })),
    ];
    return (
      <td key={col} className="summary" title="Choose what to show for this column" onClick={(e) => openAt(e.currentTarget, items, true)}>
        {c.summary ? summarize(graph, c, m.rows, c.summary) : <span className="summary-hint">▾</span>}
      </td>
    );
  };

  const rowProps = (row: number) => ({
    row,
    node: m.rows[row - 1],
    columns: m.columns,
    nCols,
    graph,
    selCol: sel.row === row ? sel.col : -1,
    rangeCols: multi && row >= range.r0 && row <= range.r1 ? `${range.c0}:${range.c1}` : "",
    editCol: edit?.cell.row === row ? edit.cell.col : -1,
    editText: edit?.cell.row === row ? edit.text : undefined,
    editor: edit?.cell.row === row ? editor : null,
    onCell,
  });

  const title = sel.col === 0 ? "ID" : (m.columns[sel.col - 1]?.label ?? "new column");

  return (
    <div className="sheet">
      <div className="formula-bar">
        <div className="name-box" title={title}>
          {multi ? `${range.r1 - range.r0 + 1} × ${range.c1 - range.c0 + 1}` : sel.row === 0 ? `${title} (header)` : `${title} · ${m.rows[sel.row - 1] ? `ID ${m.rows[sel.row - 1].no}` : "new row"}`}
        </div>
        <span className="fx">fx</span>
        <input
          value={edit ? edit.text : A.cellText(graph, m, sel)}
          readOnly={A.readOnly(m, sel)}
          onChange={(e) => setEdit({ cell: edit?.cell ?? sel, text: e.target.value, inBar: true })}
          onKeyDown={onEditorKey}
          onBlur={() => editRef.current?.inBar && finish(true)}
        />
      </div>

      <div className="grid-scroll" ref={gridRef} tabIndex={0} onKeyDown={onGridKey} onContextMenu={onContextMenu}>
        <table className="grid" style={{ width: widths.reduce((a, b) => a + b, 0) }}>
          <colgroup>
            {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr>
              {Array.from({ length: nCols }, (_, col) => headerCell(col))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: nRows }, (_, i) => (
              <Row key={i + 1} {...rowProps(i + 1)} />
            ))}
          </tbody>
          {prefs.summaryRow && (
          <tfoot>
            <tr>
              <td className="id" title="Rows">{m.rows.length}</td>
              {Array.from({ length: nCols - 1 }, (_, i) => footerCell(i + 1))}
            </tr>
          </tfoot>
          )}
        </table>
        <div className="add-rows">
          <button onClick={() => setExtraRows(extraRows + (parseInt(addCount) || 0))}>Add</button>
          <input value={addCount} onChange={(e) => setAddCount(e.target.value.replace(/\D/g, ""))} />
          <span>more rows at the bottom</span>
        </div>
        {target && (
          <datalist id="relation-options">
            {Object.values(graph.nodes).filter((n) => n.typeId === target).map((n) => <option key={n.id} value={nodeName(graph, n)} />)}
          </datalist>
        )}
      </div>
      {popup && <MenuList items={popup.items} at={popup} up={popup.up} onClose={() => setPopup(null)} />}
      {filterFor && <FilterPanel key={filterFor.key} colKey={filterFor.key} at={filterFor} onClose={() => setFilterFor(null)} />}
    </div>
  );
}

interface RowProps {
  row: number;
  node?: GraphNode;
  columns: Column[];
  nCols: number;
  graph: Graph;
  selCol: number;
  /** "c0:c1" when this row lies in a multi-cell selection (a string keeps memo comparisons cheap). */
  rangeCols: string;
  editCol: number;
  editText?: string;
  editor: React.ReactNode;
  onCell: CellHandler;
}

/** One instance row; column 0 is its ID, which also marks the selected rows (but selects like any cell). */
const Row = memo(function Row({ row, node, columns, nCols, graph, selCol, rangeCols, editCol, editText, editor, onCell }: RowProps) {
  const [c0, c1] = rangeCols ? rangeCols.split(":").map(Number) : [-1, -1];
  return (
    <tr>
      {Array.from({ length: nCols }, (_, col) => {
        const column = columns[col - 1];
        const cell = { row, col };
        const cls = [
          col === 0 && "id",
          col === 0 && (selCol >= 0 || c0 >= 0) && "hl",
          col === selCol && "sel",
          col >= c0 && col <= c1 && "in-range",
          column?.type === "number" && "num",
          column?.wrap && "wrap",
        ];
        return (
          <td
            key={col}
            data-cell={`${row}:${col}`}
            className={cls.filter(Boolean).join(" ")}
            onMouseDown={(e) => onCell(e, cell)}
            onMouseEnter={(e) => onCell(e, cell)}
            onDoubleClick={(e) => onCell(e, cell)}
          >
            {col === editCol ? (editor || editText) : <CellContent col={col} node={node} column={column} graph={graph} />}
          </td>
        );
      })}
    </tr>
  );
});

function CellContent({ col, node, column: stored, graph }: { col: number; node?: GraphNode; column?: Column; graph: Graph }) {
  if (!node) return null;
  if (col === 0) return <>{node.no}</>;
  if (!stored) return null;
  // Formula columns show their result like a column of the result's type.
  const { col: column, value: v, error } = shownColumn(graph, node, stored);
  if (error) return <span className="formula-error" title={error}>#ERROR</span>;
  if (v === undefined) return null;
  if (stored.type === "formula" && column.type === "number") return <span className="num-value">{displayValue(graph, column, v)}</span>;
  if (column.type === "boolean") return <input type="checkbox" checked={!!v} readOnly tabIndex={-1} />;
  if (column.type === "relation") {
    return (
      <>
        {linkIds(v).filter((id) => graph.nodes[id]).map((id) => (
          <span key={id} className="chip" data-node={id} title="Double-click to open">
            <i style={{ background: nodeColor(graph, graph.nodes[id]) }} />
            {nodeName(graph, graph.nodes[id])}
          </span>
        ))}
      </>
    );
  }
  return <>{displayValue(graph, column, v)}</>;
}
