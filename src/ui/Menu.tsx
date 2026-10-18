import { useEffect, type ReactNode } from "react";

export type MenuItem = { label: string; shortcut?: string; disabled?: boolean; action: () => void } | { heading: string } | "-";

/**
 * Dropdown list with a transparent backdrop that closes it on any outside click.
 * Without `at` it opens below (or with `up` above) its positioned parent; with `at` it opens at a
 * viewport point, e.g. for context menus.
 */
export function MenuList({ items, onClose, children, up, at }: { items: MenuItem[]; onClose: () => void; children?: ReactNode; up?: boolean; at?: { x: number; y: number } }) {
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
      <div
        className={`menu${up ? " up" : ""}`}
        style={at && { position: "fixed", left: Math.min(at.x, innerWidth - 240), ...(up ? { top: "auto", bottom: innerHeight - at.y } : { top: at.y }) }}
      >
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
