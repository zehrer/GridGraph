import { useEffect, useRef, useState } from "react";
import { useStore } from "../model/store";
import { displayValue, nodeName } from "../model/graph";
import { FUNCTIONS, computeFormula } from "../model/formula";
import { currentSheet, setFormula } from "./actions";

/** Dialog for a column's formula, with column shortcuts and a live preview of the first rows. */
export function FormulaEditor() {
  const key = useStore((s) => s.formulaEditor);
  return key ? <Editor key={key} colKey={key} /> : null;
}

function Editor({ colKey }: { colKey: string }) {
  const graph = useStore((s) => s.graph);
  const m = currentSheet();
  const col = m.all.find((c) => c.key === colKey);
  const [text, setText] = useState(col?.formula ?? "");
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    input.current?.focus();
  }, []);
  if (!col) return null;

  const close = () => useStore.setState({ formulaEditor: null });
  const insert = (snippet: string) => {
    const el = input.current!;
    const [a, b] = [el.selectionStart, el.selectionEnd];
    setText(text.slice(0, a) + snippet + text.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = a + snippet.length;
    });
  };
  const preview = m.rows.slice(0, 4).map((n) => ({ n, r: computeFormula(graph, n, text) }));
  const error = text.trim() ? preview.find((p) => p.r.error)?.r.error : undefined;
  const links = m.all.filter((c) => c.type === "relation");

  return (
    <dialog ref={dialog} className="dialog formula" onClose={close}>
      <form
        method="dialog"
        onSubmit={() => {
          if (text !== col.formula) setFormula(colKey, text.trim());
        }}
      >
        <h3>Formula for “{col.label}”</h3>
        <textarea
          ref={input}
          value={text}
          rows={3}
          spellCheck={false}
          placeholder="e.g. AGE([Birthday])"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="chips">
          {m.all
            .filter((c) => c.key !== colKey)
            .map((c) => (
              <button type="button" key={c.key} onClick={() => insert(`[${c.label}]`)}>[{c.label}]</button>
            ))}
          {links.map((c) => (
            <button type="button" key={`${c.key}.`} title="Follow the link to a column of the linked rows" onClick={() => insert(`[${c.label}].[`)}>[{c.label}].[…]</button>
          ))}
        </div>
        {error ? <p className="formula-error">{error}</p> : (
          <table className="preview">
            <tbody>
              {preview.map(({ n, r }) => (
                <tr key={n.id}>
                  <td>{nodeName(graph, n) || `ID ${n.no}`}</td>
                  <td>{r.value === undefined ? "–" : displayValue(graph, { ...col, type: r.type }, r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">
          Refer to columns as [Name]; follow links with [Link].[Column]. Functions: {FUNCTIONS}. Separate arguments with , or ;
          (with ; numbers may use a decimal comma).
        </p>
        <footer>
          <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
          <button className="primary">Save</button>
        </footer>
      </form>
    </dialog>
  );
}
