/**
 * FinShield AI Design Tokens
 * 
 * A refined enterprise financial security palette.
 * Plum/purple accent inspired by modern financial SaaS branding.
 * NOT a copy of any specific product's design system.
 */

export const colors = {
  // Primary brand — plum / purple family
  primary: {
    50: '#faf5ff',
    100: '#f3e8ff',
    200: '#e9d5ff',
    300: '#d8b4fe',
    400: '#c084fc',
    500: '#a855f7',
    600: '#7c3aed', // Main accent
    700: '#6d28d9',
    800: '#5b21b6',
    900: '#4c1d95',
    950: '#2e1065',
  },

  // Neutral — warm slate
  neutral: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
    950: '#020617',
  },

  // Success — teal / green
  success: {
    50: '#f0fdfa',
    100: '#ccfbf1',
    200: '#99f6e4',
    300: '#5eead4',
    400: '#2dd4bf',
    500: '#14b8a6',
    600: '#0d9488',
    700: '#0f766e',
    800: '#115e59',
    900: '#134e4a',
  },

  // Warning — amber
  warning: {
    50: '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
    900: '#78350f',
  },

  // Danger — muted red
  danger: {
    50: '#fef2f2',
    100: '#fee2e2',
    200: '#fecaca',
    300: '#fca5a5',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
    800: '#991b1b',
    900: '#7f1d1d',
  },

  // Surfaces
  surface: {
    background: '#f8fafc',
    card: '#ffffff',
    cardHover: '#f8fafc',
    sidebar: '#1e1b2e',
    sidebarHover: '#2a2640',
    sidebarActive: '#362f50',
    header: '#ffffff',
    overlay: 'rgba(15, 23, 42, 0.6)',
  },

  // Text
  text: {
    primary: '#0f172a',
    secondary: '#475569',
    muted: '#94a3b8',
    inverse: '#ffffff',
    link: '#7c3aed',
    linkHover: '#6d28d9',
  },

  // Borders
  border: {
    default: '#e2e8f0',
    hover: '#cbd5e1',
    focus: '#7c3aed',
    subtle: '#f1f5f9',
  },
} as const;

export const spacing = {
  px: '1px',
  0: '0',
  0.5: '0.125rem',
  1: '0.25rem',
  1.5: '0.375rem',
  2: '0.5rem',
  2.5: '0.625rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
} as const;

export const typography = {
  fontFamily: {
    sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", monospace',
  },
  fontSize: {
    xs: ['0.75rem', { lineHeight: '1rem' }],
    sm: ['0.875rem', { lineHeight: '1.25rem' }],
    base: ['1rem', { lineHeight: '1.5rem' }],
    lg: ['1.125rem', { lineHeight: '1.75rem' }],
    xl: ['1.25rem', { lineHeight: '1.75rem' }],
    '2xl': ['1.5rem', { lineHeight: '2rem' }],
    '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
  },
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

export const radius = {
  none: '0',
  sm: '0.25rem',
  default: '0.375rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  full: '9999px',
} as const;

export const shadows = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  default: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
} as const;

export const transitions = {
  fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
  default: '200ms cubic-bezier(0.4, 0, 0.2, 1)',
  slow: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

/** Decision-outcome color mapping */
export const decisionColors = {
  ALLOW: {
    bg: colors.success[50],
    border: colors.success[200],
    text: colors.success[700],
    icon: colors.success[600],
    badge: 'bg-teal-50 text-teal-700 border-teal-200',
  },
  BLOCK: {
    bg: colors.danger[50],
    border: colors.danger[200],
    text: colors.danger[700],
    icon: colors.danger[600],
    badge: 'bg-red-50 text-red-700 border-red-200',
  },
  VERIFY: {
    bg: colors.warning[50],
    border: colors.warning[200],
    text: colors.warning[700],
    icon: colors.warning[600],
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
  },
} as const;

/** Task state color mapping */
export const stateColors = {
  submitted: 'bg-slate-100 text-slate-600',
  queued: 'bg-slate-100 text-slate-600',
  validating: 'bg-blue-50 text-blue-600',
  extracting: 'bg-blue-50 text-blue-600',
  security_analysis: 'bg-purple-50 text-purple-600',
  risk_analysis: 'bg-purple-50 text-purple-600',
  policy_check: 'bg-purple-50 text-purple-600',
  awaiting_review: 'bg-amber-50 text-amber-600',
  allowed: 'bg-teal-50 text-teal-700',
  blocked: 'bg-red-50 text-red-700',
  executing: 'bg-blue-50 text-blue-600',
  completed: 'bg-teal-50 text-teal-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
} as const;
