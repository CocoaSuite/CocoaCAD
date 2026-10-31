// Inline stroke icons, 24×24, matching CocoaCanvas's Lucide-like style.
import type { JSX } from "react";

const P: Record<string, JSX.Element> = {
  sketch: (
    <>
      <path d="M3 21h18" />
      <path d="M5 17 15.5 6.5a2.1 2.1 0 0 1 3 3L8 20H5z" />
    </>
  ),
  extrude: (
    <>
      <path d="M4 15l8 4 8-4" />
      <path d="M4 15V9l8-4 8 4v6" />
      <path d="M12 19v-6l8-4M12 13 4 9" />
    </>
  ),
  revolve: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" />
      <path d="M12 3v18" strokeDasharray="2 2" />
    </>
  ),
  boolean: (
    <>
      <circle cx="9" cy="12" r="6" />
      <circle cx="15" cy="12" r="6" />
    </>
  ),
  fillet: (
    <>
      <path d="M4 20V10a6 6 0 0 1 6-6h10" />
      <path d="M4 20h16V4" strokeOpacity=".45" />
    </>
  ),
  chamfer: (
    <>
      <path d="M4 20V10l6-6h10" />
      <path d="M4 20h16V4" strokeOpacity=".45" />
    </>
  ),
  select: <path d="M5 3l14 7-6 2-2 6z" />,
  line: (
    <>
      <path d="M5 19 19 5" />
      <circle cx="5" cy="19" r="1.6" />
      <circle cx="19" cy="5" r="1.6" />
    </>
  ),
  rect: <rect x="4" y="6" width="16" height="12" rx="1" />,
  circle: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r=".6" />
    </>
  ),
  arc: (
    <>
      <path d="M4 18a10 10 0 0 1 16 0" />
      <circle cx="4" cy="18" r="1.6" />
      <circle cx="20" cy="18" r="1.6" />
    </>
  ),
  dimension: (
    <>
      <path d="M4 8v8M20 8v8M4 12h16" />
      <path d="M7 9l-3 3 3 3M17 9l3 3-3 3" />
    </>
  ),
  horizontal: <path d="M4 12h16M4 9v6M20 9v6" />,
  vertical: <path d="M12 4v16M9 4h6M9 20h6" />,
  coincident: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M3 12h6M15 12h6" />
    </>
  ),
  parallel: <path d="M7 20 13 4M11 20l6-16" />,
  perpendicular: <path d="M4 20h16M12 20V4" />,
  equal: <path d="M5 9h14M5 15h14" />,
  tangent: (
    <>
      <circle cx="12" cy="14" r="5" />
      <path d="M3 9h18" />
    </>
  ),
  midpoint: (
    <>
      <path d="M3 12h18" />
      <path d="M12 8v8" />
    </>
  ),
  fix: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  construction: <path d="M4 20 20 4" strokeDasharray="3 3" />,
  check: <path d="M5 12l5 5 9-10" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeoff: (
    <>
      <path d="M10.7 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6" />
      <path d="M3 3l18 18" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  warn: (
    <>
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  plane: <path d="M3 15 9 5h12l-6 10z" />,
  body: (
    <>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12 20 7.5M12 12v9M12 12 4 7.5" />
    </>
  ),
  origin: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M12 3v5M12 16v5M3 12h5M16 12h5" />
    </>
  ),
  undo: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
  redo: <path d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  panels: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  panelsR: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  cube: (
    <>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12 20 7.5M12 12v9M12 12 4 7.5" />
    </>
  ),
};

export function Icon({ name, title }: { name: keyof typeof P | string; title?: string }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title ? <title>{title}</title> : null}
      {P[name] ?? null}
    </svg>
  );
}

/** CocoaSuite "C" mark with a CAD cube in place of CocoaCanvas's pencil. */
export function BrandMark() {
  return (
    <svg viewBox="0 0 56 56" aria-hidden="true">
      <path d="M44 6C39.5 1.9 34.5 0 28 0C12.5 0 0 12.5 0 28C0 43.5 12.5 56 28 56C34.5 56 39.5 54.1 44 50L36 40C33.8 42 31.3 43 28 43C19.7 43 13 36.3 13 28C13 19.7 19.7 13 28 13C31.3 13 33.8 14 36 16L44 6Z" fill="#D15A2C" />
      <path d="M32 18.5 42 24v11l-10 5.5L22 35V24z" fill="#D15A2C" />
      <path d="M22 24l10 5.5L42 24M32 29.5v11" stroke="#1a1a1a" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
    </svg>
  );
}
