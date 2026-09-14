# PHASE 1 QUICK START — How to Use New Components & Design Tokens

**Date:** 2026-09-06  
**Status:** ✅ READY TO USE  
**All dependencies installed:** @tabler/icons-react, recharts, next-themes

---

## 🚀 GET STARTED

### 1. View Component Showcase
```bash
npm run dev
# Then visit: http://localhost:3000/components
```

You'll see all UI components in action with light and dark mode support.

---

## 📦 USE NEW COMPONENTS

### Example: Import and use Button
```tsx
import { Button } from "@/components/ui";

export default function MyPage() {
  return (
    <div>
      <Button>Click me</Button>
      <Button variant="secondary">Secondary</Button>
      <Button loading>Loading...</Button>
      <Button disabled>Disabled</Button>
      <Button variant="destructive">Delete</Button>
    </div>
  );
}
```

### Example: Use Input with Error
```tsx
import { Input } from "@/components/ui";

export default function FormPage() {
  return (
    <Input
      label="Email Address"
      type="email"
      placeholder="user@example.com"
      helperText="We'll never share your email"
    />
  );
}
```

### Example: Card with Header/Content/Footer
```tsx
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui";
import { Button } from "@/components/ui";

export default function Dashboard() {
  return (
    <Card>
      <CardHeader title="Account Settings" subtitle="Manage your profile" />
      <CardContent>
        <p>Your account information goes here</p>
      </CardContent>
      <CardFooter>
        <Button>Save Changes</Button>
      </CardFooter>
    </Card>
  );
}
```

### Example: Badge for Status
```tsx
import { Badge } from "@/components/ui";

export default function StatusPage() {
  return (
    <div>
      <Badge variant="success">Active</Badge>
      <Badge variant="warning">Pending</Badge>
      <Badge variant="error">Failed</Badge>
    </div>
  );
}
```

### Example: Spinner for Loading
```tsx
import { Spinner } from "@/components/ui";

export default function LoadingPage() {
  return (
    <div>
      <Spinner size="md" variant="primary" />
      <p>Loading data...</p>
    </div>
  );
}
```

---

## 🎨 USE DESIGN TOKENS

### Tailwind Color Classes
```html
<!-- Primary colors (blue) -->
<div class="bg-primary-50">Light background</div>
<div class="bg-primary-500">Main brand color</div>
<div class="text-primary-700">Dark text</div>

<!-- Semantic colors -->
<div class="bg-success-100 text-success-700">Success state</div>
<div class="bg-warning-100 text-warning-700">Warning state</div>
<div class="bg-error-100 text-error-700">Error state</div>

<!-- Neutral grays -->
<div class="bg-slate-100 text-slate-900">Default state</div>
```

### Tailwind Spacing
```html
<!-- All tokens: xs, sm, md, base, lg, xl, 2xl, 3xl, 4xl, 5xl -->
<div class="px-base py-md">16px horizontal, 12px vertical</div>
<div class="gap-lg">20px gap</div>
<div class="mt-2xl">32px top margin</div>
```

### Tailwind Typography
```html
<!-- Sizes with built-in line-height and letter-spacing -->
<p class="text-sm">14px small text</p>
<p class="text-base">16px body text (default)</p>
<p class="text-lg">18px large text</p>
<h2 class="text-2xl font-semibold">24px heading</h2>
<h1 class="text-4xl font-bold">32px main heading</h1>
```

### Tailwind Shadows
```html
<div class="shadow-sm">Subtle shadow</div>
<div class="shadow-md">Medium shadow (cards)</div>
<div class="shadow-lg">Large shadow (modals)</div>
```

---

## 🌙 DARK MODE

### Dark mode is built-in!

**How it works:**
1. Tailwind class mode is enabled
2. Add `dark:` prefix to override colors in dark mode
3. All components automatically support dark mode

**Example:**
```tsx
<div className="bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-50">
  This text works in both light and dark modes
</div>
```

**Toggle dark mode:**
```tsx
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Header() {
  return (
    <header>
      <h1>My App</h1>
      <ThemeToggle /> {/* Click to switch light/dark */}
    </header>
  );
}
```

---

## 📱 RESPONSIVE BREAKPOINTS

Tailwind breakpoints remain standard:
- `sm:` — 640px (tablets)
- `md:` — 768px (large tablets)
- `lg:` — 1024px (desktops)
- `xl:` — 1280px (large desktops)
- `2xl:` — 1536px (extra large)

**Example:**
```html
<div class="text-base md:text-lg lg:text-xl">
  Responsive text that grows on larger screens
</div>

<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-base">
  <!-- 1 column on mobile, 2 on tablet, 4 on desktop -->
</div>
```

---

## ✅ ACCESSIBILITY FEATURES

All new components include:
- ✅ Proper focus rings (visible on keyboard nav)
- ✅ Semantic HTML (labels with form fields)
- ✅ Error messages (near fields, not at top)
- ✅ Disabled states (clear visual feedback)
- ✅ Color + meaning (badges have both color and text)
- ✅ WCAG 4.5:1 contrast in light and dark modes
- ✅ Minimum touch targets (40–48px)

**Test accessibility:**
```bash
# In browser, install axe DevTools extension
# Run audit on any page to check compliance
```

---

## 🔄 MIGRATE EXISTING CODE

### Replace Heroicons with Tabler icons
**Old:**
```tsx
import { ChevronRightIcon } from "@heroicons/react/24/outline";

<ChevronRightIcon className="w-5 h-5" />
```

**New:**
```tsx
import { IconChevronRight } from "@tabler/icons-react";

<IconChevronRight size={20} />
```

**Common Tabler icon names:**
- `IconChevronRight`, `IconChevronLeft`, `IconChevronDown`, `IconChevronUp`
- `IconMenu`, `IconSearch`, `IconBell`, `IconMail`, `IconSettings`
- `IconUser`, `IconLogout`, `IconEdit`, `IconDelete`, `IconSave`
- `IconCheck`, `IconX`, `IconAlertCircle`, `IconInfo`
- `IconHome`, `IconDashboard`, `IconFileText`, `IconBarChart`

**Find Tabler icons:** https://tabler.io/icons

### Replace inline button styles with Button component
**Old:**
```tsx
<button className="px-4 py-2 bg-indigo-500 text-white rounded-md hover:bg-indigo-600">
  Click me
</button>
```

**New:**
```tsx
import { Button } from "@/components/ui";

<Button>Click me</Button>
```

---

## 📊 COLOR PALETTE QUICK REFERENCE

```
PRIMARY (Blue - Financial Operations)
  50:  #EFF6FF
  500: #2563EB ← Use this for buttons, links
  700: #1B5E9B ← Dark variant for hover/active

ACCENT (Green - Positive Actions)
  500: #22C55E ← Success, confirmations
  700: #15803D ← Darker variant

SUCCESS
  500: #22C55E ← Green (positive)

WARNING
  500: #F59E0B ← Amber (attention needed)

ERROR
  600: #DC2626 ← Red (problems)

SLATE (Neutral/Gray)
  50:  #F8FAFC ← Very light bg
  100: #F1F5F9 ← Light bg
  500: #64748B ← Medium text
  700: #334155 ← Dark text
  900: #0F172A ← Very dark text
```

---

## 🎯 COMPONENT VARIANTS QUICK REFERENCE

### Button
```tsx
<Button variant="primary">Primary (default)</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost (subtle)</Button>
<Button variant="destructive">Destructive (red)</Button>

<Button size="sm">Small</Button>
<Button size="md">Medium (default)</Button>
<Button size="lg">Large</Button>

<Button disabled>Disabled</Button>
<Button loading>Loading</Button>
```

### Card
```tsx
<Card variant="default">Default (subtle border)</Card>
<Card variant="elevated">Elevated (with shadow)</Card>
<Card variant="outlined">Outlined (emphasis on border)</Card>
```

### Badge
```tsx
<Badge variant="default">Default</Badge>
<Badge variant="primary">Primary (blue)</Badge>
<Badge variant="success">Success (green)</Badge>
<Badge variant="warning">Warning (amber)</Badge>
<Badge variant="error">Error (red)</Badge>

<Badge size="sm">Small</Badge>
<Badge size="md">Medium</Badge>
```

### Input
```tsx
<Input label="Text input" />
<Input label="Email" type="email" />
<Input label="With error" error="This field is required" />
<Input label="Disabled" disabled />
<Input label="With helper" helperText="Enter a valid value" />
```

### Spinner
```tsx
<Spinner size="sm" variant="primary" />
<Spinner size="md" variant="success" />
<Spinner size="lg" variant="error" />
```

---

## 🧪 TEST YOUR CHANGES

```bash
# Start dev server
npm run dev

# In another terminal, build to test production
npm run build

# Run linter
npm run lint
```

---

## 📚 FURTHER READING

- **Design System:** See `KITABU_YETU_DESIGN_SYSTEM.md`
- **Roadmap:** See `IMPLEMENTATION_ROADMAP.md`
- **Tabler Icons:** https://tabler.io/icons
- **Tailwind CSS:** https://tailwindcss.com/docs
- **next-themes:** https://github.com/pacocoursey/next-themes

---

## ✨ PHASE 1 SUMMARY

✅ Design tokens in Tailwind config  
✅ 5 reusable UI components  
✅ Dark mode infrastructure  
✅ Component showcase page  
✅ All dependencies installed  

**Ready for Phase 2:** Public website optimization (product pages, responsive testing, icon migration)

---

**Happy building! 🚀**
