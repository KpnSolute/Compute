import React from 'react';

/* ---- Icons (stroke, 24-box) ---- */
const mk = (paths: string[]) => (props: React.SVGProps<SVGSVGElement> = {}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    {paths.map((d, i) => (
      <path key={i} d={d} />
    ))}
  </svg>
);

const mkRaw = (children: React.ReactNode) => (props: React.SVGProps<SVGSVGElement> = {}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    {children}
  </svg>
);

export const I: Record<string, (props?: React.SVGProps<SVGSVGElement>) => React.ReactElement> = {
  grid: mk(['M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z']),
  box: mkRaw([
    <path key={0} d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />,
    <path key={1} d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" />,
  ]),
  calendar: mkRaw([
    <rect key={0} x={3} y={4} width={18} height={18} rx={2} />,
    <path key={1} d="M16 2v4M8 2v4M3 10h18" />,
  ]),
  branch: mkRaw([
    <line key={0} x1={6} y1={3} x2={6} y2={15} />,
    <circle key={1} cx={18} cy={6} r={3} />,
    <circle key={2} cx={6} cy={18} r={3} />,
    <path key={3} d="M18 9a9 9 0 0 1-9 9" />,
  ]),
  archive: mkRaw([
    <rect key={0} x={2} y={4} width={20} height={5} rx={1} />,
    <path key={1} d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9M10 13h4" />,
  ]),
  users: mkRaw([
    <path key={0} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />,
    <circle key={1} cx={9} cy={7} r={4} />,
    <path key={2} d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  ]),
  settings: mkRaw([
    <circle key={0} cx={12} cy={12} r={3} />,
    <path key={1} d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />,
  ]),
  qr: mk(['M3 3h7v7H3zM14 3h4v4h-4zM18 3h3M21 3v4M3 14h4v4H3zM14 14h3v3h-3zM20 14h1M14 20h7M21 17v4M3 18v3h3']),
  dollar: mk(['M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6']),
  alert: mkRaw([
    <path key={0} d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />,
    <path key={1} d="M12 9v4M12 17h.01" />,
  ]),
  up: mk(['M18 15l-6-6-6 6']),
  down: mk(['M6 9l6 6 6-6']),
  check: mk(['M20 6 9 17l-5-5']),
  checkCircle: mkRaw([
    <path key={0} d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />,
    <path key={1} d="M22 4 12 14.01l-3-3" />,
  ]),
  logout: mk(['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9']),
  user: mkRaw([
    <path key={0} d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />,
    <circle key={1} cx={12} cy={7} r={4} />,
  ]),
  lock: mkRaw([
    <rect key={0} x={3} y={11} width={18} height={11} rx={2} />,
    <path key={1} d="M7 11V7a5 5 0 0 1 10 0v4" />,
  ]),
  eye: mkRaw([
    <path key={0} d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />,
    <circle key={1} cx={12} cy={12} r={3} />,
  ]),
  eyeOff: mk([
    'M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20',
  ]),
  del: mk(['M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2']),
  plus: mk(['M12 5v14M5 12h14']),
  edit: mk(['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z']),
  search: mkRaw([
    <circle key={0} cx={11} cy={11} r={8} />,
    <path key={1} d="m21 21-4.35-4.35" />,
  ]),
  bell: mk(['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0']),
  scan: mk(['M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10']),
  download: mk(['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3']),
  clock: mkRaw([
    <circle key={0} cx={12} cy={12} r={10} />,
    <path key={1} d="M12 6v6l4 2" />,
  ]),
  trend: mk(['M23 6l-9.5 9.5-5-5L1 18M17 6h6v6']),
  shield: mk(['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z']),
  cloud: mk(['M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z']),
  x: mk(['M18 6 6 18M6 6l12 12']),
  refresh: mk(['M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15']),
  database: mkRaw([
    <ellipse key={0} cx={12} cy={5} rx={9} ry={3} />,
    <path key={1} d="M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0" />,
  ]),
  thermo: mkRaw([
    <path key={0} d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />,
  ]),
  clipboard: mkRaw([
    <path key={0} d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />,
    <rect key={1} x={8} y={2} width={8} height={4} rx={1} />,
  ]),
  inbox: mkRaw([
    <path key={0} d="M22 12h-6l-2 3h-4l-2-3H2" />,
    <path key={1} d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />,
  ]),
  flame: mkRaw([
    <path key={0} d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
  ]),
  snow: mk(['M12 2v20M17 5l-5 3-5-3M17 19l-5-3-5 3M2 12h20M5 7l3 5-3 5M19 7l-3 5 3 5']),
  droplet: mkRaw([
    <path key={0} d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />,
  ]),
  save: mkRaw([
    <path key={0} d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />,
    <path key={1} d="M17 21v-8H7v8M7 3v5h8" />,
  ]),
  printer: mkRaw([
    <path key={0} d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />,
    <rect key={1} x={6} y={14} width={12} height={8} rx={1} />,
  ]),
  chevL: mk(['M15 18l-6-6 6-6']),
  chevR: mk(['M9 18l6-6-6-6']),
  coffee: mkRaw([
    <path key={0} d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" />,
    <path key={1} d="M6 1v3M10 1v3M14 1v3" />,
  ]),
  fileText: mkRaw([
    <path key={0} d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />,
    <path key={1} d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />,
  ]),
  checkSquare: mkRaw([
    <path key={0} d="M9 11l3 3L22 4" />,
    <path key={1} d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />,
  ]),
  calCheck: mkRaw([
    <rect key={0} x={3} y={4} width={18} height={18} rx={2} />,
    <path key={1} d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4" />,
  ]),
  book: mkRaw([
    <path key={0} d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />,
    <path key={1} d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />,
  ]),
  award: mkRaw([
    <circle key={0} cx={12} cy={8} r={6} />,
    <path key={1} d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />,
  ]),
  terminal: mk(['M4 17l6-6-6-6', 'M12 19h8']),
};

export function KpnMark({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 52 60" fill="none" aria-hidden="true">
      <path d="M40 9 A24 24 0 1 0 45 30" stroke="#9DBEF0" strokeWidth="2.4" strokeLinecap="round" opacity=".55" />
      <circle cx="24" cy="30" r="18" stroke="#BFD6F7" strokeWidth="1.4" opacity=".5" />
      <ellipse cx="24" cy="30" rx="8.5" ry="18" stroke="#BFD6F7" strokeWidth="1.2" opacity=".4" />
      <line x1="6" y1="30" x2="42" y2="30" stroke="#BFD6F7" strokeWidth="1.2" opacity=".4" />
      <path d="M9 20 H39 M9 40 H39" stroke="#BFD6F7" strokeWidth="1.1" opacity=".3" />
      <path
        d="M10 47 C18 40 16 30 26 27 C35 24 33 15 41 12"
        stroke="#2E86F0"
        strokeWidth="3.4"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M35.5 11 L43 11 L42 18.5 Z" fill="#2E86F0" />
      <circle cx="11" cy="47" r="3.4" fill="#2E86F0" />
      <circle cx="11" cy="47" r="1.2" fill="#fff" />
    </svg>
  );
}
