export const colors = {
  bg: '#0a0a0b',
  surface: '#111113',
  surface2: '#18181c',
  border: '#2a2a2f',
  borderHi: '#3d3d45',
  borderInput: '#6b6b75',
  text: '#e8e8ec',
  muted: '#8a8a94',
  accent: '#7c6dfa',
  accentDim: '#3d3480',
  accentHover: '#6b5cf0',
  accentStrong: '#5b4bdb',
  accentStrongHover: '#4f40c9',
  success: '#3dbd8a',
  successBorder: '#1d4435',
  danger: '#e05050',
  dangerMuted: '#7a1f1f',
} as const;

export type ColorToken = keyof typeof colors;
