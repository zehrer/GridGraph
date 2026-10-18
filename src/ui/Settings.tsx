import { useEffect, useRef } from "react";
import { useStore } from "../model/store";
import { NOTATIONS, browserLocale } from "../model/locale";

/** Personal settings of this browser. */
export function Settings({ onClose }: { onClose: () => void }) {
  const { prefs, setPrefs } = useStore();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, parseInt(v) || min));

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current.close()}>
      <form method="dialog">
        <h3>Settings</h3>
        <label>
          <span>Rows shown at least</span>
          <input type="number" min={0} max={500} value={prefs.minRows} onChange={(e) => setPrefs({ minRows: num(e.target.value, 0, 500) })} />
        </label>
        <label>
          <span>Columns shown at least</span>
          <input type="number" min={0} max={50} value={prefs.minCols} onChange={(e) => setPrefs({ minCols: num(e.target.value, 0, 50) })} />
        </label>
        <label>
          <span>Number and date notation</span>
          <select value={prefs.notation} onChange={(e) => setPrefs({ notation: e.target.value })}>
            {NOTATIONS.map(([tag, label]) => (
              <option key={tag} value={tag}>{tag ? label : `${label} (${browserLocale})`}</option>
            ))}
          </select>
        </label>
        <p className="hint">A decimal comma is understood in every notation (0,5 · 12,99). The sheet always shows your data plus one empty row and column to type into. These settings are stored in this browser only.</p>
        <footer>
          <button type="button" onClick={() => setPrefs({ minRows: 20, minCols: 5, notation: "" })}>Reset</button>
          <button className="primary">Done</button>
        </footer>
      </form>
    </dialog>
  );
}
