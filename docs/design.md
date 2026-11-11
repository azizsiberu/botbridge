# Desk design

botbridge is a daily operations tool: people check mail, tasks, connections, and delivery, then take one action. The interface is a cable desk. A fixed dark spine lists the routes. The work surface is a cool sheet where records sit in tables. One lagoon color marks the action you can take and the route you are on.

This replaces the postal-counter theme (acid lime, display serif, pill buttons, identical rounded cards). Those choices are not used.

## Palette

The same roles exist in both themes. Text on the accent fill always uses the accent ink, including hover. Disabled controls use their own pair, not a faded accent.

| Role | Light | Dark |
| --- | --- | --- |
| Field (page) | `#E4EBF0` | `#0C1419` |
| Sheet (surface) | `#F5F8FA` | `#152028` |
| Ink | `#142028` | `#E7EEF2` |
| Muted text | `#3C5160` | `#C3D0D8` |
| Divider | `#D5E0E6` | `#2A3C48` |
| Control border | `#4E6776` | `#8AA4B2` |
| Accent fill | `#0F5C6B` | `#B6E4EA` |
| Accent ink | `#F4FBFC` | `#06262C` |
| Accent hover | `#0C4E5B` | `#C8F0F4` |
| Focus ring | `#0F5C6B` | `#B6E4EA` |
| Spine | `#102830` | `#08141A` |
| Spine text | `#E7F2F4` | `#E7F2F4` |
| Spine muted | `#C5D8DF` | `#C5D8DF` |
| Active route mark | `#9EE7E4` | `#9EE7E4` |
| Success text | `#0B5130` | `#9BE8C0` |
| Warning text | `#6B3E06` | `#F0C27A` |
| Danger text | `#8A221C` | `#FFB4A8` |
| Mail bar | `#0F5C6B` | `#B6E4EA` |
| Task bar | `#8A5A12` | `#E2C07A` |
| Disabled fill | `#D0DDE4` | `#243440` |
| Disabled text | `#1C3344` | `#C3D0D8` |

Each text pair above is at least 4.5:1. Focus rings and control borders are at least 3:1 against the surface they sit on. The spine uses the lagoon mark for its focus ring, because the work-surface focus color disappears on the spine.

## Type

One family for the interface: [Familjen Grotesk](https://fonts.google.com/specimen/Familjen+Grotesk), weights 400, 500, and 600. Titles use the same face at a larger size. IBM Plex Mono is only for code, tokens, and secrets.

| Use | Size | Weight | Line height |
| --- | --- | --- | --- |
| Page title | 28px | 600 | 1.2 |
| Section title | 18px | 600 | 1.3 |
| Body | 15px | 400 | 1.5 |
| Tables, buttons, inputs | 14px | 400, buttons 600 | 1.4 |
| Labels, meta, table headers | 13px | 600 for labels and headers | 1.4 |

Nothing is set in all capitals. Numbers in tables and stats use tabular figures. Reading text stays under about 72 characters.

## Spacing

An 8px grid: 4, 8, 16, 24, 32, 48.

- Page padding is 24px, and 16px below 768px.
- Page header to content is 24px.
- Sections are 32px apart.
- Form fields stack with 16px between them.
- Buttons and inputs are 36px tall. Table rows are 48px tall.
- The spine is 220px wide.

## Radius

- 4px on buttons, inputs, tables, and panels.
- 8px on dialogs only, because they float above the page.
- No pills, no fully round controls.

## Components

- **Page header.** Title and one sentence on the left. Actions on the right. They wrap instead of overflowing.
- **Spine.** Product name, version, account, then routes. The current route has a lagoon bar on its left edge and a heavier weight. It is not a filled chip.
- **Tables.** Tabular data is a table: bots, mail, tasks, connections, audit, doorbell, accounts, reachability. The table scrolls inside its frame at narrow widths. The page itself does not.
- **Buttons.** Primary is the accent fill with accent ink. Secondary is a bordered sheet button. Danger is danger-colored text with a border, not a filled red. Hover changes the fill, not the text color.
- **Status.** A colored word (active, revoked, unread, failed). Not a tinted badge.
- **Panels.** A form or a definition list gets one ruled sheet. Pages are not a stack of identical cards.
- **Empty, loading, error.** Left aligned. Empty states say what is missing and offer the next action. Loading is a sentence. Errors name the failure. No entrance animation.
- **Dialogs.** One sheet, a title, a Close button, Escape to dismiss.
- **Chart.** Mail and tasks are separate bars with a written legend. They are not the only way the numbers are shown. The totals sit above the chart.
- **Auth.** Clerk sign-in and sign-up use this palette, this type, a 4px radius, and accent-ink on the primary button.

Motion only answers an action: a dialog opening, a button label changing to "Copied". There is no page-load animation.
