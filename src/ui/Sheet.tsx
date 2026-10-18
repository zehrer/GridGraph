import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { rangeOf, useStore, type Cell } from "../model/store";
import { displayValue, nameLabel, nodeColor } from "../model/graph";
import { parseClipboard, toHTML, toTSV } from "../model/clipboard";
import type { Column, Graph, GraphNode } from "../model/types";
import { cellText, clearSelection, commitCell, pasteMatrix, selectionMatrix, sheetModel, type SheetModel } from "./actions";

const TYPE_ICON: Partial<Record<Column["type"], string>> = { number: "#", date: "◷", boolean: "☑", relation: "↗", autonumber: "№" };
const isNumeric = (c?: Column) => c?.type === "number" || c?.type === "autonumber";
const MOVES: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

interface Edit { cell: Cell; text: string; inBar?: boolean }
type CellHandler = (e: MouseEvent, cell: Cell) => void;

export function Sheet() {
  const { graph, activeTypeId, sort, filter, sel, anchor, select } = useStore();
  const m = useMemo(() => sheetModel(graph, activeTypeId, { sort, filter }), [graph, activeTypeId, sort, filter]);
  const [edit, setEditState] = useState<Edit | null>(null);
  const editRef = useRef<Edit | null>(null);
  const [extraRows, setExtraRows] = useState(0);
  const [addCount, setAddCount] = useState("1000");
  const gridRef = useRef<HTMLDivElement>(null);

  const nRows = Math.max(m.rows.length + 1, 20) + extraRows;
  const nCols = Math.max(m.columns.length + 2, 6);
  const range = rangeOf(anchor, sel);
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
    if (save) commitCell(e.cell, e.text);
    if (delta) {
      move(delta[0], delta[1], e.cell);
      gridRef.current?.focus();
    }
  };

  // Stable handler for memoized rows; reads the latest state through the ref.
  const latest = useRef({ m, graph });
  latest.current = { m, graph };
  const dragging = useRef(false);
  const onCell = useRef<CellHandler>((e, cell) => {
    const { m, graph } = latest.current;
    const { select } = useStore.getState();
    if (e.type === "dblclick") return !readOnly(m, cell) && setEdit({ cell, text: cellText(graph, m, cell) });
    if (e.type === "mouseenter") return dragging.current && select(cell, true);
    dragging.current = true;
    select(cell, e.shiftKey);
    const column = m.columns[cell.col - 1];
    if ((e.target as HTMLElement).tagName === "INPUT" && column?.type === "boolean") {
      commitCell(cell, String(m.rows[cell.row - 1]?.props[column.key] !== true));
    }
  }).current;

  useEffect(() => {
    const up = () => (dragging.current = false);
    // Clipboard events only reach the document; handle them while the grid has focus.
    const active = () => document.activeElement === gridRef.current && !editRef.current;
    const copy = (e: ClipboardEvent, cut = false) => {
      if (!active()) return;
      e.preventDefault();
      const matrix = selectionMatrix();
      e.clipboardData?.setData("text/plain", toTSV(matrix));
      e.clipboardData?.setData("text/html", toHTML(matrix));
      if (cut) clearSelection();
    };
    const cut = (e: ClipboardEvent) => copy(e, true);
    const paste = (e: ClipboardEvent) => {
      if (!active() || !e.clipboardData) return;
      e.preventDefault();
      pasteMatrix(parseClipboard(e.clipboardData.getData("text/html"), e.clipboardData.getData("text/plain")));
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
    if (delta) {
      e.preventDefault();
      move(delta[0], delta[1], sel, e.shiftKey && e.key in MOVES);
    } else if (readOnly(m, sel) && e.key.length === 1) {
      e.preventDefault();
    } else if ((e.key === "Enter" || e.key === "F2") && !readOnly(m, sel)) {
      e.preventDefault();
      select(sel);
      setEdit({ cell: sel, text: cellText(graph, m, sel) });
    } else if (e.key === "Backspace" || e.key === "Delete") {
      clearSelection();
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

  const rowProps = (row: number) => ({
    row,
    node: row > 0 ? m.rows[row - 1] : undefined,
    type: m.type,
    columns: m.columns,
    nCols,
    graph,
    selCol: sel.row === row ? sel.col : -1,
    hlCol: row === 0 ? sel.col : -1,
    rangeCols: row >= range.r0 && row <= range.r1 && (range.r0 !== range.r1 || range.c0 !== range.c1) ? `${range.c0}:${range.c1}` : "",
    editCol: edit?.cell.row === row ? edit.cell.col : -1,
    editText: edit?.cell.row === row ? edit.text : undefined,
    editor: edit?.cell.row === row ? editor : null,
    onCell,
  });

  const title = sel.col === 0 ? nameLabel(m.type) : (m.columns[sel.col - 1]?.label ?? "new column");
  const multi = range.r0 !== range.r1 || range.c0 !== range.c1;

  return (
    <div className="sheet">
      <div className="formula-bar">
        <div className="name-box" title={title}>
          {multi ? `${range.r1 - range.r0 + 1} × ${range.c1 - range.c0 + 1}` : sel.row === 0 ? `${title} (header)` : `${title} ${sel.row}`}
        </div>
        <span className="fx">fx</span>
        <input
          value={edit ? edit.text : cellText(graph, m, sel)}
          readOnly={readOnly(m, sel)}
          onChange={(e) => setEdit({ cell: edit?.cell ?? sel, text: e.target.value, inBar: true })}
          onKeyDown={onEditorKey}
          onBlur={() => editRef.current?.inBar && finish(true)}
        />
      </div>

      <div className="grid-scroll" ref={gridRef} tabIndex={0} onKeyDown={onGridKey}>
        <table className="grid">
          <thead>
            <Row {...rowProps(0)} />
          </thead>
          <tbody>
            {Array.from({ length: nRows }, (_, i) => (
              <Row key={i + 1} {...rowProps(i + 1)} />
            ))}
          </tbody>
        </table>
        <div className="add-rows">
          <button onClick={() => setExtraRows(extraRows + (parseInt(addCount) || 0))}>Add</button>
          <input value={addCount} onChange={(e) => setAddCount(e.target.value.replace(/\D/g, ""))} />
          <span>more rows at the bottom</span>
        </div>
        {target && (
          <datalist id="relation-options">
            {Object.values(graph.nodes).filter((n) => n.typeId === target).map((n) => <option key={n.id} value={n.label} />)}
          </datalist>
        )}
      </div>
    </div>
  );
}

interface RowProps {
  row: number;
  node?: GraphNode;
  type: GraphNode;
  columns: Column[];
  nCols: number;
  graph: Graph;
  selCol: number;
  /** Header row only: column of the active cell, highlighted. */
  hlCol: number;
  /** "c0:c1" when this row lies in a multi-cell selection (a string keeps memo comparisons cheap). */
  rangeCols: string;
  editCol: number;
  editText?: string;
  editor: React.ReactNode;
  onCell: CellHandler;
}

/** One sheet row; row 0 is the header with the property names. */
const Row = memo(function Row({ row, node, type, columns, nCols, graph, selCol, hlCol, rangeCols, editCol, editText, editor, onCell }: RowProps) {
  const [c0, c1] = rangeCols ? rangeCols.split(":").map(Number) : [-1, -1];
  return (
    <tr className={row === 0 ? "header-row" : ""}>
      <th className={row === 0 ? "corner" : selCol >= 0 || c0 >= 0 ? "hl" : ""}>{row || ""}</th>
      {Array.from({ length: nCols }, (_, col) => {
        const column = columns[col - 1];
        const cell = { row, col };
        const cls = [col === selCol && "sel", col >= c0 && col <= c1 && "in-range", col === hlCol && "hl", isNumeric(column) && row > 0 && "num"];
        return (
          <td
            key={col}
            data-cell={`${row}:${col}`}
            className={cls.filter(Boolean).join(" ")}
            onMouseDown={(e) => onCell(e, cell)}
            onMouseEnter={(e) => onCell(e, cell)}
            onDoubleClick={(e) => onCell(e, cell)}
          >
            {col === editCol ? (editor ?? editText) : <CellContent row={row} col={col} node={node} column={column} graph={graph} type={type} />}
          </td>
        );
      })}
    </tr>
  );
});

/** Auto numbers are assigned by the app and cannot be typed over. */
const readOnly = (m: SheetModel, cell: Cell) => cell.row > 0 && m.columns[cell.col - 1]?.type === "autonumber";

function CellContent({ row, col, node, column, graph, type }: { row: number; col: number; node?: GraphNode; column?: Column; graph: Graph; type?: GraphNode }) {
  if (row === 0) {
    if (col === 0) return <>{nameLabel(type)}</>;
    return column ? <>{TYPE_ICON[column.type] && <i className="type-icon">{TYPE_ICON[column.type]}</i>}{column.label}</> : null;
  }
  if (!node) return null;
  if (col === 0) return <>{node.label}</>;
  const v = column && node.props[column.key];
  if (!column || v === undefined) return null;
  if (column.type === "boolean") return <input type="checkbox" checked={!!v} readOnly tabIndex={-1} />;
  if (column.type === "relation" && typeof v === "string" && graph.nodes[v]) {
    return <span className="chip"><i style={{ background: nodeColor(graph, graph.nodes[v]) }} />{graph.nodes[v].label}</span>;
  }
  return <>{displayValue(graph, column, v)}</>;
}
