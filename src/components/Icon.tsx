import type { CSSProperties } from 'react';

/** Small stroke icon set (24×24 viewBox, currentColor). Hand-written paths: no icon font, no CDN, no dependency. */
const PATHS = {
  shield: 'M12 3 4.5 6v5.6c0 4.6 3.1 8.2 7.5 9.9 4.4-1.7 7.5-5.3 7.5-9.9V6L12 3Z',
  shieldCheck: 'M12 3 4.5 6v5.6c0 4.6 3.1 8.2 7.5 9.9 4.4-1.7 7.5-5.3 7.5-9.9V6L12 3Z M8.8 12.2l2.2 2.2 4.4-4.6',
  upload: 'M7 18.5h-.5a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 16.6 8.6 4.5 4.5 0 0 1 17.5 18.5H17 M12 20v-8 M8.8 14.8 12 11.6l3.2 3.2',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z M14 3v5h5',
  table: 'M4 5h16v14H4z M4 10h16 M4 15h16 M10 10v9',
  braces: 'M8 4H7a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h1 M16 4h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-1',
  alert: 'M12 4 2.8 19.5h18.4L12 4Z M12 10v4.2 M12 17.2v.1',
  check: 'M5 12.5l4.2 4.2L19 7',
  checkCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M8.3 12.3l2.5 2.5 4.9-5',
  chevronRight: 'M9.5 6l6 6-6 6',
  arrowRight: 'M5 12h14 M13 6l6 6-6 6',
  arrowLeft: 'M19 12H5 M11 6l-6 6 6 6',
  x: 'M6 6l12 12 M18 6 6 18',
  download: 'M12 4v11 M7.5 10.5 12 15l4.5-4.5 M5 19.5h14',
  save: 'M6 4h9.5L19 7.5V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z M8 4v5h7V4 M8 20v-6h8v6',
  search: 'M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4Z M16 16l4.5 4.5',
  play: 'M8 5.5v13l10.5-6.5L8 5.5Z',
  sparkles: 'M12 3.5l1.6 4.4 4.4 1.6-4.4 1.6L12 15.5l-1.6-4.4L6 9.5l4.4-1.6L12 3.5Z M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z',
  sliders: 'M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 5v4 M9 15v4',
  lock: 'M6 10.5h12V20H6z M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
  mail: 'M4 6h16v12H4z M4.5 6.5 12 12.5l7.5-6',
  key: 'M8.5 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M12 12h8.5 M17.5 12v3 M20.5 12v2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4.5 20a7.5 7.5 0 0 1 15 0',
  logIn: 'M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4 M3.5 12h11 M10.5 8l4 4-4 4',
  userPlus: 'M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M2.5 20a7.5 7.5 0 0 1 12.2-5.8 M19 13v6 M16 16h6',
  history: 'M4 12a8 8 0 1 0 2.4-5.7 M4 4.5v3.8h3.8 M12 8v4.2l2.8 1.8',
  barChart: 'M5 20V11 M10 20V5 M15 20v-6 M20 20V9',
  gauge: 'M4.2 16.5a8.5 8.5 0 1 1 15.6 0 M12 13l3.5-4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 11v5 M12 8v.1',
  trash: 'M4.5 7h15 M9.5 7V4.5h5V7 M6.5 7l1 13h9l1-13 M10 11v5.5 M14 11v5.5',
  list: 'M9 6.5h11 M9 12h11 M9 17.5h11 M4.5 6.5h.1 M4.5 12h.1 M4.5 17.5h.1',
  layers: 'M12 4 3 8.5l9 4.5 9-4.5L12 4Z M3 12.5l9 4.5 9-4.5 M3 16.5l9 4.5 9-4.5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className, style, strokeWidth = 1.8, title }: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
  /** When given the icon is announced; otherwise it is decorative (aria-hidden). */
  title?: string;
}) {
  const filled = name === 'play';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `icon ${className}` : 'icon'}
      style={style}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
