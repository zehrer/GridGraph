import { useEffect, useRef } from "react";
import { useStore } from "../model/store";

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
        <p className="hint">The sheet always shows your data plus one empty row and column to type into. These settings are stored in this browser only.</p>
        <footer>
          <button type="button" onClick={() => setPrefs({ minRows: 20, minCols: 5 })}>Reset</button>
          <button className="primary">Done</button>
        </footer>
      </form>
    </dialog>
  );
}
