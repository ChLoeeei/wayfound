# Wayfound — Design Tokens

Configure these in `tailwind.config.ts` under `theme.extend`.

---

## Colors

```typescript
colors: {
  // Primary — warm coral orange
  primary: {
    50:  '#fff5f0',
    100: '#ffe6d9',
    300: '#ffb38a',
    500: '#ff7043',   // main CTA color
    700: '#e64a19',
    900: '#bf360c',
  },
  // Accent — sky blue (map, links, highlights)
  accent: {
    300: '#81d4fa',
    500: '#29b6f6',
    700: '#0288d1',
  },
  // Neutral — warm off-white base
  neutral: {
    50:  '#fafaf8',   // page background
    100: '#f5f5f0',
    200: '#e8e8e0',
    400: '#a8a89a',
    600: '#6b6b5f',
    800: '#2d2d24',
    900: '#1a1a14',
  },
  // Semantic
  success: '#66bb6a',
  warning: '#ffa726',
  danger:  '#ef5350',
}
```

---

## Typography

```typescript
fontFamily: {
  sans: ['Inter', 'PingFang SC', 'Helvetica Neue', 'sans-serif'],
  display: ['Playfair Display', 'serif'],  // landing page headings only
}
fontSize: {
  xs:   ['11px', '16px'],
  sm:   ['13px', '20px'],
  base: ['15px', '24px'],
  lg:   ['17px', '26px'],
  xl:   ['20px', '30px'],
  '2xl':['24px', '32px'],
  '3xl':['30px', '38px'],
}
```

---

## Spacing & Radius

```typescript
borderRadius: {
  card: '16px',     // place cards
  sheet: '24px',    // bottom sheets
  tag: '100px',     // vibe tags (pill shape)
  btn: '12px',      // buttons
}
spacing: {
  // Use standard Tailwind scale; key custom values:
  // card padding: p-4 (16px)
  // section gap: gap-3 (12px)
  // screen horizontal: px-4 (16px)
}
```

---

## Shadows

```typescript
boxShadow: {
  card: '0 2px 12px rgba(0,0,0,0.08)',
  sheet: '0 -4px 24px rgba(0,0,0,0.12)',
  pin: '0 2px 8px rgba(255,112,67,0.4)',  // map pin glow
}
```

---

## Motion

All animations via Tailwind `transition` utilities.  
Key durations:
- Card expand/collapse: `duration-150`
- Sheet slide up: `duration-200`
- Map pan: handled by map library (do not override)
- Toast appear: `duration-150`

---

## Component Conventions

| Component | Key classes |
|-----------|-------------|
| Place card | `bg-white rounded-card shadow-card p-4` |
| Vibe tag (selected) | `bg-primary-500 text-white rounded-tag px-3 py-1 text-sm` |
| Vibe tag (unselected) | `bg-neutral-100 text-neutral-600 rounded-tag px-3 py-1 text-sm` |
| Primary button | `bg-primary-500 text-white rounded-btn px-6 py-3 font-semibold` |
| Bottom sheet | `bg-white rounded-t-sheet shadow-sheet` |
| Warning badge | `bg-warning/10 text-warning text-xs rounded-full px-2 py-0.5` |

---

## Landing Page Style Guide

- Hero section: full-bleed destination photo with dark gradient overlay
- Heading: `font-display text-3xl text-white` over hero image
- Form card: `bg-white/95 backdrop-blur rounded-2xl shadow-xl` floating over hero
- CTA button: `bg-primary-500 w-full` with subtle pulse animation while AI generates
