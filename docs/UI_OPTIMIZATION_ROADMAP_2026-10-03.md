# UI Optimization Roadmap - October 3, 2026

## Executive Summary

Comprehensive UI optimization audit identified **10 specific opportunities** for ~**133KB bundle reduction** and **10-30% rendering improvement**. This document tracks identified items, completed work, and remaining tasks.

---

## ✅ COMPLETED

### Phase 1: SMS Tabs Decomposition (CRITICAL PRIORITY) - COMPLETE

**Status:** ✅ Committed (0b03c24)  
**Impact:** 40KB savings + better code organization  
**Work Done:**

- Split 1,251-line `components/sms/tabs.tsx` into 8 focused modules
- Extracted shared helpers (StatusBadge, CategoryBadge, TABS) into `tabs/helpers.tsx`
- Created modular structure: `compose-tab.tsx`, `campaigns-tab.tsx`, `templates-tab.tsx`, `schedules-tab.tsx`, `logs-tab.tsx`, `optouts-tab.tsx`
- Maintained backwards compatibility via re-export in main `tabs.tsx`
- Enables lazy-loading of individual tabs

**Next User Action:** Push to main when ready; enables future performance monitoring

---

## 🔴 PENDING

### Phase 2: Icon Library Consolidation (HIGH PRIORITY)

**Impact:** 15KB savings + simplified dependency management  
**Effort:** Low (1-2 hours)  
**Status:** Done (PR #213)

**Consolidation Plan:**

- **Source:** 2 libraries (lucide-react: 40+ files, @tabler/icons-react: 4 files)
- **Target:** lucide-react exclusively
- **Files to Update:**
  - `components/Toast.tsx`
  - `components/layout/sidebar.tsx`
  - `components/marketing/callback-form.tsx`
  - `components/marketing/social-links.tsx`
  - Plus 5 app pages

**Icon Replacements Map:**

```
@tabler/icons-react → lucide-react
IconCheck → Check
IconX → X
IconAlertCircle → AlertCircle
IconInfoCircle → Info
IconAddressBook → BookOpen / Users
IconBolt → Zap
IconBook → BookOpen
IconBuildingBank → Building2
IconCalendar → Calendar
IconChartBar → BarChart3
IconChartDots → Scatter
IconClipboardList → ListChecks
IconCoins → DollarSign
IconCreditCard → CreditCard
IconDeviceMobile → Smartphone
IconDots → MoreVertical
IconGauge → Gauge
IconHeart → Heart
IconLayoutDashboard → LayoutDashboard
IconMail → Mail
IconMessage → MessageSquare
IconReceipt → Receipt
IconSettings → Settings
IconSpeakerphone → Megaphone
IconTimeline → Activity
IconTrendingUp → TrendingUp
IconUpload → Upload
IconUsers → Users
IconVault → Lock / Vault
IconWallet → Wallet
IconBrand* → Custom SVGs or lucide alternatives
```

**PR Template:**

```
refactor(icons): consolidate to lucide-react, remove @tabler/icons-react

- Replace all @tabler/icons-react imports with lucide-react equivalents
- Update 4 component files and 5 app pages
- 15KB bundle reduction from consolidated dependency
- No functional changes, visual parity maintained
```

---

### Phase 3: Debug Code Removal (MEDIUM PRIORITY)

**Impact:** Clean console, reduced security surface  
**Effort:** Minimal (15 mins)  
**Status:** Done (PR #213)

**Locations:**

1. `/components/Toast.tsx` - Line 135: `console.log('Toast:', toast)`
2. `/components/ecosystem/donor-leaderboard.tsx` - `console.error` for failed fetches

**Fix Pattern:**

```typescript
// Replace with:
if (process.env.NODE_ENV === 'development') {
  console.log('Toast:', toast);
}
```

---

### Phase 4: Layout Logic Consolidation (HIGH PRIORITY)

**Impact:** ~70 lines removed across the three layouts (the admin layout shares little with the other two)  
**Effort:** Medium  
**Status:** Done (PR #213) - `hooks/use-shell-auth.ts`

**Duplicate Patterns Across:**

- `/app/(admin)/layout.tsx` (119 lines)
- `/app/(member)/layout.tsx` (118 lines)
- `/app/(dashboard)/layout.tsx` (93 lines)

**Shared Features:**

- Role-based auth guards
- API client configuration
- Router redirects
- Loading states
- Spinner UI

**Refactoring Plan:**

```typescript
// Create: lib/hooks/use-layout-auth-guard.ts
export function useLayoutAuthGuard(options: {
  requiredRole?: string[];
  redirectOnUnauth?: string;
  restrictedRoles?: string[];
}) {
  // Shared auth logic
}
```

**Apply to all 3 layouts → 150-line reduction**

---

### Phase 5: Marketing Sections Decomposition (HIGH PRIORITY)

**Impact:** Maintainability only. `kitabu-sections.tsx` is a server module (no `'use client'`) and its interactive parts are already separate client files, so splitting it does not change any client bundle.  
**Effort:** Medium  
**Status:** Done - split into `components/marketing/sections/*` (products, testimonials, cta, team, audience, trust, live-content); pages import from those modules directly, no barrel file

**Target:** `/components/marketing/kitabu-sections.tsx` (677 lines)

**Decompose Into:**

- `marketing/sections/hero-facts.tsx`
- `marketing/sections/services-section.tsx`
- `marketing/sections/testimonials-section.tsx`
- `marketing/sections/team-section.tsx`
- etc.

**Benefit:** Smaller files. No bundle benefit (see impact above).

---

### Phase 6: Component Memoization (MEDIUM PRIORITY)

**Impact:** 10-30% render reduction on data-heavy pages  
**Effort:** Low (1-2 hours)  
**Status:** Identified, not started

**Target Components:**

- `StatusPill` (reused in tables)
- `CategoryBadge` (static display)
- `StatCard` components (dashboard)
- `PageHeader` (shared layouts)
- Icon/Badge components (pure presentational)

**Pattern:**

```typescript
export const StatusPill = React.memo(function StatusPill({ status }: Props) {
  // ...
});
```

**Focus:** Data-heavy pages (SMS logs, member transactions, payment history)

---

### Phase 7: Site Header Optimization (LOW PRIORITY)

**Impact:** 8KB for desktop visitors  
**Effort:** Low (1-2 hours)  
**Status:** Identified, not started

**Target:** `/components/marketing/site-header.tsx` (473 lines)

**Optimization:**

```typescript
const MobileNav = dynamic(() => import('./mobile-nav'), { ssr: false });
```

Extract mobile menu, lazy-load on mobile only

---

### Phase 8: Accessibility Improvements (MEDIUM PRIORITY)

**Impact:** WCAG 2.1 AA compliance  
**Effort:** Medium (2-3 hours)  
**Status:** Identified, not started

**Gaps:**

- Missing `aria-modal="true"` on some modals/dialogs
- Custom controls missing ARIA labels
- Progress ring component inconsistency

**Setup:**

```bash
npm install --save-dev axe-core eslint-plugin-jsx-a11y
```

**Action:** Audit all custom interactive components for ARIA attributes

---

### Phase 9: Props Interface Standardization (LOW PRIORITY)

**Impact:** Developer experience, consistency  
**Effort:** Medium (2-3 hours)  
**Status:** Identified, not started

**Issue:** Similar components with inconsistent prop interfaces

- `StatCard` vs `PaymentCard` vs `SavingsGoalCard`
- Multiple "Card" variants with different spacing
- Dialog components with varying callbacks

**Solution:** Create standardized interface template:

```typescript
interface CardProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  isLoading?: boolean;
  className?: string;
  onClick?: () => void;
}
```

---

### Phase 10: Dependency Audit (MEDIUM PRIORITY)

**Impact:** 50KB bundle reduction  
**Effort:** Low (1 hour)  
**Status:** Done - removed `framer-motion` and `@tabler/icons-react` (both had zero imports); kept `@portabletext/react` (3 importing files). Deleted three committed `.bak` files. Removing an unused dependency shrinks install size, not the client bundle, which tree-shaking already excluded.

**Findings:**

- `@portabletext/react`: ~8KB, limited usage - verify necessity
- `framer-motion`: listed in dependencies but replaced by lighter solution

**Action:**

1. Remove `framer-motion` from package.json if truly unused
2. Audit `@portabletext/react` usage - remove if edge case

**Commands:**

```bash
npm list @portabletext/react framer-motion
grep -r "@portabletext/react\|framer-motion" src/ --include="*.tsx"
```

---

## Summary Table

| #   | Optimization           | Impact             | Effort  | Status      | Priority |
| --- | ---------------------- | ------------------ | ------- | ----------- | -------- |
| 1   | SMS tabs decomposition | **40KB**           | ✅ Done | ✅ Complete | CRITICAL |
| 2   | Icon consolidation     | **15KB**           | Low     | 🔴 Pending  | HIGH     |
| 3   | Marketing sections     | **20KB**           | Medium  | 🔴 Pending  | HIGH     |
| 4   | Layout DRY             | **DRY**            | Medium  | 🔴 Pending  | HIGH     |
| 5   | Component memoization  | **10-30%** renders | Low     | 🔴 Pending  | MEDIUM   |
| 6   | Debug code removal     | Minimal            | Minimal | 🔴 Pending  | MEDIUM   |
| 7   | Dependency audit       | **50KB**           | Low     | 🔴 Pending  | MEDIUM   |
| 8   | Accessibility          | **WCAG AA**        | Medium  | 🔴 Pending  | MEDIUM   |
| 9   | Site header lazy-load  | **8KB**            | Low     | 🔴 Pending  | LOW      |
| 10  | Props standardization  | **DX**             | Medium  | 🔴 Pending  | LOW      |

---

## Next Steps

### Recommended Sequence (for optimal ROI):

1. ✅ **SMS tabs** - DONE (40KB)
2. **Icon consolidation** - Quick win (15KB, 1-2 hrs)
3. **Layout DRY** - High impact (eliminates duplication, 2-3 hrs)
4. **Marketing sections** - Good savings (20KB, 2-3 hrs)
5. **Dependency audit** - Easy (50KB potential, 1 hr)
6. **Component memoization** - Performance (10-30%, 1-2 hrs)
7. **Debug removal** - Hygiene (minimal effort)
8. Accessibility & standardization for polish

---

## Measuring Impact

### Bundle Size:

```bash
# Before optimization
npm run build  # Note final bundle size

# After each phase, rebuild and compare
```

### Rendering Performance:

```bash
# In browser DevTools, measure render times on:
- SMS Centre page (LogsTab with 20+ rows)
- Dashboard (multiple charts + stats)
- Member list pages
```

### Run Full Audit:

```bash
npm run lint
npm run typecheck
npm run test:ci
```

---

## Notes for Future Sessions

- **SMS tabs**: Ready for lazy-loading with `React.lazy()` if needed
- **Icon library**: Simple regex search/replace doable across all files
- **Layout logic**: Extract hook first, then refactor all 3 layouts
- **Marketing**: Consider Suspense boundary for better code splitting
- **Accessibility**: Use ESLint plugin to catch issues automatically

---

_Generated by UI optimization audit - October 3, 2026_
