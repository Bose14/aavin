export const CHART_COLORS = {
  primary: '#4f46e5',
  amber: '#f59e0b',
  profit: '#10b981',
  loss: '#ef4444',
  grid: '#e2e8f0',
  zeroLine: '#64748b',
  axis: '#64748b',
  slate: '#334155',
  cursor: 'rgba(79, 70, 229, 0.06)',
} as const;

export const ZERO_INCLUSIVE_DOMAIN: [
  (min: number) => number,
  (max: number) => number,
] = [
  (min) => (min < 0 ? Math.floor(min * 1.15) : 0),
  (max) => (max > 0 ? Math.ceil(max * 1.1) : 0),
];

