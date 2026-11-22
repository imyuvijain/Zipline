/** Small 6-spoke mark, replaces the ✳ glyph. */
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg className={`mark ${className}`} viewBox="0 0 16 16" width="1em" height="1em" aria-hidden>
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <line x1="8" y1="1.5" x2="8" y2="14.5" />
        <line x1="2.4" y1="4.75" x2="13.6" y2="11.25" />
        <line x1="2.4" y1="11.25" x2="13.6" y2="4.75" />
      </g>
    </svg>
  );
}
