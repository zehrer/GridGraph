import { useState } from "react";
import { useStore } from "../model/store";
import { displayNumber } from "../model/locale";
import { SELECTION_STATS, selectionStats } from "../model/summary";
import { selectionValues } from "./actions";
import { MenuList } from "./Menu";

/** Status bar figure for a multi-cell selection (like Google Sheets): Sum by default, the others on click. */
export function SelectionStats() {
  const { prefs, setPrefs } = useStore();
  // Re-render on selection and data changes.
  useStore((s) => s.sel);
  useStore((s) => s.anchor);
  useStore((s) => s.graph);
  const [open, setOpen] = useState(false);
  const { values, cells, format } = selectionValues();
  const stats = selectionStats(values);
  if (cells < 2 || !stats.count) return null;

  const text = (k: keyof typeof stats) => {
    const v = stats[k];
    return v === undefined ? "–" : k === "count" || k === "countNumbers" ? String(v) : displayNumber(v, format);
  };
  // Without numbers only the counts mean something.
  const shown = stats.countNumbers ? prefs.selectionStat : "count";
  const label = SELECTION_STATS.find(([k]) => k === shown)![1];

  return (
    <div className="menu-anchor selection-stats">
      <button title="Choose the figure shown for the selection" onClick={() => setOpen(true)}>
        {label}: <b>{text(shown)}</b> ▾
      </button>
      {open && (
        <MenuList
          up
          onClose={() => setOpen(false)}
          items={SELECTION_STATS.map(([k, l]) => ({ label: `${k === shown ? "✓ " : " "}${l}`, shortcut: text(k), action: () => setPrefs({ selectionStat: k }) }))}
        />
      )}
    </div>
  );
}
