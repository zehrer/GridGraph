import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useStore, type Cell } from "../model/store";
import { displayValue, nodeColor } from "../model/graph";
import type { Column, Graph, GraphNode } from "../model/types";
import { cellText, colName, commitCell, sheetModel } from "./actions";

const TYPE_ICON: Partial<Record<Column["type"], string>> = { number: "#", date: "◷", boolean: "☑", relation: "↗" };
const MOVES: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

interface Edit { cell: Cell; text: string; inBar?: boolean }
type CellHandler = (e: MouseEvent, cell: Cell) => void;

export function Sheet() {
  const { graph, activeTypeId, sort, filter, sel, select } = useStore();
  const m = useMemo(() => sheetModel(graph, activeTypeId, { sort, filter }), [graph, activeTypeId, sort, filter]);
  const [edit, setEditState] = useState<Edit | null>(null);
  const editRef = useRef<Edit | null>(null);
  const [extraRows, setExtraRows] = useState(0);
  const [addCount, setAddCount] = useState("1000");
  const gridRef = useRef<HTMLDivElement>(null);

  const nRows = Math.max(m.rows.length + 2, 20) + extraRows;
  const nCols = Math.max(m.columns.length + 2, 6);
  const setEdit = (e: Edit | null) => setEditState((editRef.current = e));
  const move = (dr: number, dc: number, from = sel) =>
    select({ row: Math.min(from.row + dr, nRows), col: Math.min(from.col + dc, nCols - 1) });

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
  const latest = useRef({ edit, m, graph });
  latest.current = { edit, m, graph };
  const onCell = useRef<CellHandler>((e, cell) => {
    const { m, graph } = latest.current;
    if (e.type === "dblclick") return setEdit({ cell, text: cellText(graph, m, cell) });
    useStore.getState().select(cell);
    const column = m.columns[cell.col - 1];
    if ((e.target as HTMLElement).tagName === "INPUT" && column?.type === "boolean") {
      commitCell(cell, cellText(graph, m, cell) === "Ja" ? "nein" : "ja");
    }
  }).current;

  useEffect(() => {
    gridRef.current?.querySelector(`[data-cell="${sel.row}:${sel.col}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel]);
  useEffect(() => gridRef.current?.focus(), [activeTypeId]);

  const onGridKey = (e: KeyboardEvent) => {
    if (edit || e.metaKey || e.ctrlKey || e.altKey) return;
    const delta = e.key === "Tab" ? [0, e.shiftKey ? -1 : 1] : e.key === "Enter" && e.shiftKey ? [-1, 0] : MOVES[e.key];
    if (delta) {
      e.preventDefault();
      move(delta[0], delta[1]);
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      setEdit({ cell: sel, text: cellText(graph, m, sel) });
    } else if (e.key === "Backspace" || e.key === "Delete") {
      commitCell(sel, "");
    } else if (e.key.length === 1) {
      e.preventDefault();
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
      list={edit.cell.row > 1 && editColumn?.type === "relation" ? "relation-options" : undefined}
      onChange={(e) => setEdit({ ...edit, text: e.target.value })}
      onKeyDown={onEditorKey}
      onBlur={() => finish(true)}
    />
  );
  const target = editColumn?.type === "relation" && editColumn.targetTypeId;

  return (
    <div className="sheet">
      <div className="formula-bar">
        <div className="name-box">{colName(sel.col) + sel.row}</div>
        <span className="fx">fx</span>
        <input
          value={edit ? edit.text : cellText(graph, m, sel)}
          onChange={(e) => setEdit({ cell: edit?.cell ?? sel, text: e.target.value, inBar: true })}
          onKeyDown={onEditorKey}
          onBlur={() => editRef.current?.inBar && finish(true)}
        />
      </div>

      <div className="grid-scroll" ref={gridRef} tabIndex={0} onKeyDown={onGridKey}>
        <table className="grid">
          <thead>
            <tr>
              <th className="corner" />
              {Array.from({ length: nCols }, (_, c) => (
                <th key={c} className={c === sel.col ? "hl" : ""}>{colName(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: nRows }, (_, i) => {
              const row = i + 1;
              return (
                <Row
                  key={row}
                  row={row}
                  node={row > 1 ? m.rows[row - 2] : undefined}
                  columns={m.columns}
                  nCols={nCols}
                  graph={graph}
                  selCol={sel.row === row ? sel.col : -1}
                  editCol={edit?.cell.row === row ? edit.cell.col : -1}
                  editText={edit?.cell.row === row ? edit.text : undefined}
                  editor={edit?.cell.row === row ? editor : null}
                  onCell={onCell}
                />
              );
            })}
          </tbody>
        </table>
        <div className="add-rows">
          <button onClick={() => setExtraRows(extraRows + (parseInt(addCount) || 0))}>Hinzufügen</button>
          <input value={addCount} onChange={(e) => setAddCount(e.target.value.replace(/\D/g, ""))} />
          <span>weitere Zeilen unten</span>
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
  columns: Column[];
  nCols: number;
  graph: Graph;
  selCol: number;
  editCol: number;
  editText?: string;
  editor: React.ReactNode;
  onCell: CellHandler;
}

const Row = memo(function Row({ row, node, columns, nCols, graph, selCol, editCol, editText, editor, onCell }: RowProps) {
  return (
    <tr className={row === 1 ? "header-row" : ""}>
      <th className={selCol >= 0 ? "hl" : ""}>{row}</th>
      {Array.from({ length: nCols }, (_, col) => {
        const column = columns[col - 1];
        const cell = { row, col };
        return (
          <td
            key={col}
            data-cell={`${row}:${col}`}
            className={[col === selCol && "sel", column?.type === "number" && row > 1 && "num"].filter(Boolean).join(" ")}
            onMouseDown={(e) => onCell(e, cell)}
            onDoubleClick={(e) => onCell(e, cell)}
          >
            {col === editCol ? (editor ?? editText) : <CellContent row={row} col={col} node={node} column={column} graph={graph} />}
          </td>
        );
      })}
    </tr>
  );
});

function CellContent({ row, col, node, column, graph }: { row: number; col: number; node?: GraphNode; column?: Column; graph: Graph }) {
  if (row === 1) {
    if (col === 0) return <>Name</>;
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
