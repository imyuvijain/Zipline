export interface DockItem { id: string; label: string; glyph: string; hue: number; sim?: boolean }

/** macOS-style dock: icons magnify on hover, click selects a team. */
export function Dock({ items, selected, onSelect }: { items: DockItem[]; selected: string; onSelect: (id: string) => void }) {
  return (
    <nav className="dock-wrap" aria-label="Teams">
      <div className="dock" role="tablist">
        {items.map((it) => (
          <button
            key={it.id}
            role="tab"
            aria-selected={selected === it.id}
            className={`dock-item ${selected === it.id ? "sel" : ""} ${it.sim ? "sim" : ""}`}
            onClick={() => onSelect(it.id)}
            aria-label={it.label}
          >
            <span className="dock-tip">{it.label}</span>
            <span className="dock-icon" style={{ ["--hue" as string]: it.hue }}>{it.glyph}</span>
            <span className="dock-dot" />
          </button>
        ))}
      </div>
    </nav>
  );
}
