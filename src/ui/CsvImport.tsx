import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../model/store";
import { deleteNode, instancesOf, typesOf } from "../model/graph";
import { DELIMITERS, detectDelimiter, importTable, looksNumeric, parseCSV, toTable, type Delimiter } from "../model/csv";

/** Preview and options for a CSV/TSV file before it becomes a new sheet. */
export function CsvImport() {
  const file = useStore((s) => s.csvImport);
  return file ? <Dialog key={file.fileName + file.text.length} {...file} /> : null;
}

function Dialog({ fileName, text, encoding }: { fileName: string; text: string; encoding: string }) {
  const detected = useMemo(() => detectDelimiter(text), [text]);
  const [delimiter, setDelimiter] = useState<Delimiter>(detected);
  const [header, setHeader] = useState(true);
  const [name, setName] = useState(fileName.replace(/\.[^.]+$/, "") || "Imported");
  const table = useMemo(() => toTable(parseCSV(text, delimiter), header), [text, delimiter, header]);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);

  const close = () => useStore.setState({ csvImport: null });
  const label = (d: Delimiter) => DELIMITERS.find(([x]) => x === d)![1];
  const run = () => {
    let typeId = "";
    useStore.getState().edit((g) => {
      // A brand-new database's untouched "Type 1" sheet is replaced rather than kept next to the import.
      const types = typesOf(g);
      const blank = types.length === 1 && !instancesOf(g, types[0].id).length && (types[0].columns ?? []).length <= 1 ? types[0].id : undefined;
      typeId = importTable(g, name.trim() || "Imported", table);
      if (blank) deleteNode(g, blank);
    });
    useStore.getState().setActiveType(typeId);
    useStore.getState().setView("sheet");
  };

  return (
    <dialog ref={ref} className="dialog csv" onClose={close}>
      <form method="dialog" onSubmit={run}>
        <h3>Import “{fileName}”</h3>
        <label>
          <span>New sheet</span>
          <input className="wide" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>Separator</span>
          <select value={delimiter} onChange={(e) => setDelimiter(e.target.value as Delimiter)}>
            {DELIMITERS.map(([d, l]) => (
              <option key={l} value={d}>{l}{d === detected ? " (detected)" : ""}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />
          <span>First row contains the column names</span>
        </label>
        <p className="hint">
          {table.rows.length} rows · {table.headers.length} columns · {label(delimiter)} · {encoding}
          {table.ids ? " · the ID column is kept as row IDs" : ""}
        </p>
        <div className="preview-scroll">
          <table className="preview">
            <thead>
              <tr>{table.headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.slice(0, 8).map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j} className={looksNumeric(c) ? "r" : ""}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        {table.rows.length > 8 && <p className="hint">… and {table.rows.length - 8} more rows</p>}
        <footer>
          <button type="button" onClick={() => ref.current?.close()}>Cancel</button>
          <button className="primary" disabled={!table.headers.length}>Import</button>
        </footer>
      </form>
    </dialog>
  );
}
