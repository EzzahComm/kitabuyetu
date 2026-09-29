# Image sources

Marketing photos are stored locally so the site never depends on a remote image
request at render time. Pages never import these files directly: every photo is
declared once, by the role it plays, in `components/marketing/photos.ts`. To
replace a photo site-wide, drop the new file here and change that one entry.

The images illustrate products and audiences. They are not customer or partner
claims, and nobody pictured is presented as a Kitabu Yetu user.

## In use

| File              | Role in `photos.ts`           | Source                                                                       |
| ----------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| `hero-one.jpg`    | `youthTech`                   | Not recorded — confirm the licence before launch (see below)                 |
| `hero-two.jpg`    | `memberPhone`                 | Not recorded — confirm the licence before launch (see below)                 |
| `benefit-one.jpg` | `vslaRecords`                 | Not recorded — confirm the licence before launch (see below)                 |
| `benefit-two.jpg` | `vslaReading`                 | Not recorded — confirm the licence before launch (see below)                 |
| `fundraise.jpg`   | `payments` (placeholder)      | Unsplash License — https://images.unsplash.com/photo-1556742049-0cfed4f6a45d |
| `enterprise.jpg`  | `organisations` (placeholder) | Unsplash License — https://images.unsplash.com/photo-1551836022-d5d88e9218df |

The first four were already in the repository with no recorded source. Before
they carry the brand, confirm where each came from (Unsplash, Pexels or your own
shoot) and record it in the table.

Removed: `bookkeeper.jpg` (Unsplash photo-1556761175-b413da4baf72) and
`chama-reminder.jpg` (Unsplash photo-1516321318423-f06f85e504b3), generic
Western office stock replaced by the photos above.

## Replacement brief

Art direction: East African people, real settings, natural light, no staged
office stock. Landscape, at least 1600px wide, faces clear of the left 40% of
the frame (the hero's text wave covers it on desktop).

1. **payments**: a woman or young person paying or confirming an M-Pesa
   contribution on a phone, ideally at a group meeting or market stall.
2. **organisations**: a field officer or NGO programme staff member meeting a
   community group, with a laptop or tablet.
3. **VSLA meeting** (to add alongside `vslaRecords`): women seated in a circle
   with the cash box and passbooks, record keeper writing.
4. **Youth group** (to add alongside `youthTech`): young women and men
   outdoors or at a hub, looking at phones together.

Best source is your own photos of real client groups, with signed consent
forms. Otherwise use Unsplash or Pexels, both free for commercial use, and
record each photo's URL above.
