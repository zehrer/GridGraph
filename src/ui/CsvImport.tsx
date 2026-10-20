import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../model/store";
import { deleteNode, instancesOf, typesOf } from "../model/graph";
import { DELIMITERS, detectDelimiter, importTable, looksNumeric, matchSheet, parseCSV, toTable, updateKeys, updateTable, type Delimiter } from "../model/csv";

/** Preview and options for a CSV/TSV file before it becomes a new sheet or updates an existing one. */
export function CsvImport() {
  const file = useStore((s) => s.csvImport);
  return file ? <Dialog key={file.fileName + file.text.length} {...file} /> : null;
}

function Dialog({ fileName, text, encoding }: { fileName: string; text: string; encoding: string }) {
  const detected = useMemo(() => detectDelimiter(text), [text]);
  const [delimiter, setDelimiter] = useState<Delimiter>(detected);
  const [header, setHeader] = useState(true);
  const base = fileName.replace(/\.[^.]+$/, "") || "Imported";
  const table = useMemo(() => toTable(parseCSV(text, delimiter), header), [text, delimiter, header]);
  const graph = useStore((s) => s.graph);
  const types = typesOf(graph);
  // A file that looks like a new state of an existing sheet updates it by default.
  const [match] = useState(() => matchSheet(graph, table, fileName));
  const [target, setTarget] = useState(match ?? "");
  const [template, setTemplate] = useState(match ?? "");
  const [name, setName] = useState(() => (types.some((t) => t.label?.toLowerCase() === base.toLowerCase()) ? `${base} ${new Date().toISOString().slice(0, 10)}` : base));
  const keys = useMemo(() => (target ? updateKeys(graph, target, table) : []), [graph, target, table]);
  const [keyChoice, setKey] = useState<string>();
  const key = keys.some((k) => k.key === keyChoice) ? keyChoice! : keys[0]?.key;
  const [removeMissing, setRemoveMissing] = useState(false);
  // The update runs on a copy for the preview, so its numbers are exactly what Import does.
  const plan = useMemo(() => (target && key !== undefined ? updateTable(structuredClone(graph), target, table, key, false) : undefined), [graph, target, table, key]);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);

  const close = () => useStore.setState({ csvImport: null });
  const label = (d: Delimiter) => DELIMITERS.find(([x]) => x === d)![1];
  const run = () => {
    if (target) {
      if (key === undefined) return;
      useStore.getState().edit((g) => void updateTable(g, target, table, key, removeMissing));
      useStore.getState().setActiveType(target);
      useStore.getState().setView("sheet");
      return;
    }
    let typeId = "";
    useStore.getState().edit((g) => {
      // A brand-new database's untouched "Type 1" sheet is replaced rather than kept next to the import.
      const types = typesOf(g);
      const blank = types.length === 1 && !instancesOf(g, types[0].id).length && (types[0].columns ?? []).length <= 1 ? types[0].id : undefined;
      typeId = importTable(g, name.trim() || "Imported", table, template || undefined);
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
          <span>Import into</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">New sheet</option>
            <optgroup label="Update the rows of">
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.label}{t.id === match ? " (matches)" : ""}</option>
              ))}
            </optgroup>
          </select>
        </label>
        {target ? (
          <>
            <label>
              <span>Match rows by</span>
              <select value={key ?? ""} disabled={!keys.length} onChange={(e) => setKey(e.target.value)}>
                {!keys.length && <option value="">No common column</option>}
                {keys.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </label>
            <label>
              <span>Rows not in the file</span>
              <select value={removeMissing ? "delete" : "keep"} onChange={(e) => setRemoveMissing(e.target.value === "delete")}>
                <option value="keep">Keep</option>
                <option value="delete">Delete</option>
              </select>
            </label>
            {plan && (
              <p className="hint update-plan">
                {plan.matched} found{plan.matched ? ` (${plan.changed} changed)` : ""} · {plan.added} new · {plan.missing} not in the file{plan.missing ? (removeMissing ? " – deleted" : " – kept") : ""}
                {plan.newColumns.length ? ` · new columns: ${plan.newColumns.join(", ")}` : ""}
                <br />Views, filters, formats and formulas of the sheet stay; links to its rows are kept.
              </p>
            )}
          </>
        ) : (
          <>
            <label>
              <span>Sheet name</span>
              <input className="wide" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              <span>Take views from</span>
              <select value={template} onChange={(e) => setTemplate(e.target.value)}>
                <option value="">– none –</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            {template && <p className="hint">Columns with the same heading take over type, format and links; formula columns, filters and filter views are copied.</p>}
          </>
        )}
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
          <button className="primary" disabled={!table.headers.length || (!!target && key === undefined)}>{target ? "Update" : "Import"}</button>
        </footer>
      </form>
    </dialog>
  );
}
