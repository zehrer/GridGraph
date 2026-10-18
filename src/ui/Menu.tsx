import { useEffect, type ReactNode } from "react";

export type MenuItem = { label: string; shortcut?: string; disabled?: boolean; action: () => void } | { heading: string } | "-";

/** Dropdown list with a transparent backdrop that closes it on any outside click. */
export function MenuList({ items, onClose, children, up }: { items: MenuItem[]; onClose: () => void; children?: ReactNode; up?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Keep clicks from reaching the element the menu is anchored in (e.g. a sheet tab).
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="menu-layer" onClick={stop} onDoubleClick={stop} onMouseDown={stop}>
      <div className="backdrop" onMouseDown={onClose} />
      <div className={`menu${up ? " up" : ""}`}>
        {items.map((it, i) =>
          it === "-" ? (
            <hr key={i} />
          ) : "heading" in it ? (
            <div key={i} className="menu-heading">{it.heading}</div>
          ) : (
            <button
              key={i}
              disabled={it.disabled}
              onClick={() => {
                onClose();
                it.action();
              }}
            >
              <span>{it.label}</span>
              {it.shortcut && <kbd>{it.shortcut}</kbd>}
            </button>
          ),
        )}
        {children}
      </div>
    </div>
  );
}
