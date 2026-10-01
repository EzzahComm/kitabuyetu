# Kitabu Yetu Branding Guide

## Logo v3 Specification

### Overview

The Kitabu Yetu Logo v3 features:

- Three-dot group mark above an open book
- Green and orange wordmark
- Single-colour uppercase tagline
- Modular format available in multiple layouts

### Logo Components

#### Dot Marks

- **Centre dot**: Orange (#F97316)
- **Side dots**: Green (#3CB043) - one on each side
- **Arrangement**: Horizontal grouping above the main icon
- **Purpose**: Symbolizes community and connection

#### Book Icon

- **Design**: Open book viewed from the front
- **Color**: Green (#3CB043)
- **Style**: Minimalist, modern outline
- **Position**: Centered below the dot group

#### Wordmark

- **"KITABU"**: Green (#3CB043)
- **"YETU"**: Orange (#F97316)
- **Font**: Inter, 700 weight
- **Letter spacing**: -1.5px
- **Treatment**: Uppercase, bold

#### Tagline

- **Text**: "COMMUNITY FINANCE" (or project-specific tagline)
- **Font**: Open Sans, 600 weight
- **Letter spacing**: 1.5px
- **Text transform**: UPPERCASE
- **Colors**:
  - Light backgrounds: #355EFC
  - Navy backgrounds: #8DA6FF
  - Blue backgrounds: #FFFFFF (white)

### Logo Formats

#### Icon Only (App Icon / Favicon)

- Use for: App icons, favicons, social profile pictures
- File: `public/img/logo-icon.svg`
- Dimensions: 128x128 (scalable)
- Contains: Dot group + book icon only

#### Horizontal

- Use for: Headers, navigation bars, horizontal layouts
- File: `public/img/logo-horizontal.svg`
- Aspect ratio: 4:1 (approximately)
- Contains: Icon + wordmark + tagline in horizontal alignment

#### Stacked

- Use for: Vertical layouts, email signatures, tall spaces
- File: `public/img/logo-stacked.svg`
- Aspect ratio: 1:1.4 (approximately)
- Contains: Icon, wordmark stacked vertically, tagline below

#### Full Logo with Tagline

- Use for: Marketing materials, official communications
- File: `public/img/logo.svg`
- Default format: Standard presentation
- Contains: All elements with proper spacing

### Color Palette

#### Primary Colors

| Element          | Color         | Hex     | Usage                         |
| ---------------- | ------------- | ------- | ----------------------------- |
| Green (Primary)  | Kitabu Green  | #3CB043 | Book, left dot, "KITABU" text |
| Orange (Accent)  | Kitabu Orange | #F97316 | Center dot, "YETU" text       |
| Navy (Secondary) | Kitabu Navy   | #0B3C88 | Alternative branding contexts |

#### Tagline Color

| Background | Color         | Hex     | Usage                      |
| ---------- | ------------- | ------- | -------------------------- |
| Light      | Tagline Blue  | #355EFC | On white/light backgrounds |
| Navy       | Tagline Light | #8DA6FF | On navy/dark backgrounds   |
| Blue       | White         | #FFFFFF | On blue backgrounds        |

#### Neutral Palette

| Element         | Color    | Hex     |
| --------------- | -------- | ------- |
| Paper (Default) | White    | #FFFFFF |
| Paper (Deep)    | Slate 50 | #F8FAFC |
| Neutral         | Slate 50 | #F8FAFC |

### Typography

#### Brand Font

- **Primary**: Inter (sans-serif)
- **Weight**: 700 (bold) for wordmark
- **Letter spacing**: -1.5px (tight)

#### Tagline Font

- **Font**: Open Sans
- **Weight**: 600 (semibold)
- **Letter spacing**: 1.5px
- **Transform**: uppercase

### Clear Space

- Minimum clear space around logo: 16px
- No elements should intrude on the clear space boundary
- The dot group, book, and wordmark form a unified mark and should not be separated

### Sizing

- **Minimum size**: 64px (width) for full logo with tagline
- **Icon only minimum**: 32px
- **Recommended sizes**:
  - Favicon/app icon: 128x128, 192x192, 512x512 pixels
  - Header logo: 100-200px width
  - Full page hero: 400px+ width

### Do's and Don'ts

✅ **Do**

- Use the primary green (#3CB043) for the majority of branding
- Maintain the exact color values specified
- Keep the dot marks and book together as a unit
- Use Open Sans 600 for all taglines
- Maintain proper aspect ratios

❌ **Don't**

- Change the dot colors or positions
- Modify the color hex values
- Separate the dot group from the book icon
- Use serif fonts for the wordmark
- Alter the letter spacing significantly
- Rotate or skew the logo

### Implementation

#### CSS Variables

The following Tailwind/CSS variables are available:

```css
--primary: #3cb043 (Green) --brand-orange: #f97316 (Orange) --brand-blue: #0b3c88 (Navy) --tagline-light: #355efc
  --tagline-navy: #8da6ff --tagline-blue: #ffffff;
```

#### Usage in Tailwind

```html
<!-- Green text -->
<span class="text-brand-500">Text</span>

<!-- Orange background -->
<div class="bg-brand-orange">Content</div>

<!-- Tagline color on light background -->
<p class="text-tagline-light font-semibold">COMMUNITY FINANCE</p>
```

#### SVG Files

- `public/img/logo.svg` - Main full logo
- `public/img/logo-icon.svg` - Icon only
- `public/img/logo-horizontal.svg` - Horizontal layout
- `public/img/logo-stacked.svg` - Stacked layout

### Migration Notes

- Updated from Logo v2 (indigo + typography)
- Logo v3 emphasizes community (dots) and learning (book)
- New tagline colors support multiple background contexts
- All brand assets updated: favicons, app icons, brand materials

---

**Last Updated**: October 1, 2026  
**Version**: 3.0  
**Author**: EZZAHCOMM NEXUS
