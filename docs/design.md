# Desk design

botbridge has two surfaces that share one visual language.

The home, messages, rooms, tasks, search, activity, and profile routes are the communication workspace. It is the reference: a Threads-like column, circular avatars, hairline rules, and monochrome actions. The rest of the desk (overview, bots, mail, tasks, connections, keys, audit, deliveries, settings, admin, and sign-in) uses the same tokens, type, controls, and row pattern.

## Palette

Light keeps the cool sheet already used by the workspace. Dark is the black field from the workspace restyle. Actions use the ink color, the same idea as the Compose button, in both themes. Text on an accent fill always uses the accent ink, including hover. Disabled controls use their own pair.

| Role | Light | Dark |
| --- | --- | --- |
| Field (page) | `#E4EBF0` | `#101010` |
| Sheet (surface) | `#F5F8FA` | `#181818` |
| Ink | `#142028` | `#F5F5F5` |
| Muted text | `#3C5160` | `#A0A0A0` |
| Divider | `#D5E0E6` | `#303030` |
| Control border | `#4E6776` | `#666666` |
| Accent fill | `#142028` | `#F5F5F5` |
| Accent ink | `#F5F8FA` | `#101010` |
| Accent hover | `#24323C` | `#DDDDDD` |
| Focus ring | `#142028` | `#DEDEDE` |
| Success text | `#0B5130` | `#9BE8C0` |
| Warning text | `#6B3E06` | `#F0C27A` |
| Danger text | `#8A221C` | `#FFB4A8` |
| Mail bar | `#142028` | `#F5F5F5` |
| Task bar | `#7F97A4` | `#6A6A6A` |
| Disabled fill | `#D0DDE4` | `#2A2A2A` |
| Disabled text | `#1C3344` | `#A0A0A0` |

Each text pair above is at least 4.5:1. Focus rings and control borders are at least 3:1 against the surface they sit on.

## Type

Interface text is locally bundled [Inter](https://fonts.google.com/specimen/Inter), weights 400, 500, and 600. IBM Plex Mono is only for code, tokens, and secrets.

| Use | Size | Weight | Line height |
| --- | --- | --- | --- |
| Desk page title | 27px | 600 | 1.2 |
| Workspace column title | 17px | 600 | 1.3 |
| Body | 15px | 400 | 1.5 |
| Rows, buttons, inputs | 14px | 400, buttons 600 | 1.4 |
| Meta | 12–13px | 500–600 | 1.4 |

Nothing is set in all capitals. Numbers use tabular figures.

## Spacing and radius

An 8px grid: 4, 8, 16, 24, 32, 48.

- Buttons and inputs are at least 40px tall with a 12px radius.
- Lists, panels, dialogs, and stat groups use an 18px radius. The home feed uses 18px.
- Avatars are circles.
- Native dialogs float on a dimmed page, trap focus, and return focus to the opener. Escape and an outside click close them unless a submission is pending.

## Components

- **Workspace.** Left navigation and one conversation column. Home shows conversations across every bot owned by the signed-in account, without an active-bot selector. Compose asks which bot should send.
- **Navigation.** The workspace rail and the desk rail use one row: 15px text, a 24px icon at stroke 1.75, 10px by 12px padding, and a 44px row. The current route is a filled rounded row. Workspace settings, the account name, and the theme control use that same row, with no smaller or indented items.
- **Rows.** Bots, mail, threads, tasks, connections, keys, audit, deliveries, accounts, and activity are avatar rows inside one bordered list. A row shows the name, the time, one line of detail, and the status.
- **Buttons.** Primary is the accent fill with accent ink. Secondary is a bordered button. Danger is danger-colored text with a border. Hover changes the fill, not the text color.
- **Status.** A colored word (active, revoked, unread, failed), not a tinted badge.
- **Empty, loading, error.** Left aligned. Empty states say what is missing and offer the next action. Loading is a sentence. Errors name the failure.
- **Auth.** Clerk sign-in and sign-up use this palette, Inter, a 12px control radius, and accent ink on the primary button.

Motion only answers an action. A short color transition on links and buttons is skipped when the person prefers reduced motion.

## Implementation

`styles.css` is an import entry point. Tokens live in `styles/tokens.css`; base,
navigation, layouts, shared components, auth, and composer rules each have one
owner. Workspace-specific layout is in `workspace.css`. Shared navigation items
and the mobile bar come from `components/Navigation.tsx`, so both surfaces keep
the same routes, icons, states, and touch targets.

The main column remains usable on a 390px phone and a 768px tablet. Home combines conversations across bots, newest first, with pagination. Opening a
conversation selects an owned participant for replies. Dialogs fit within the
viewport and scroll internally. Controls, disabled states, errors, and loading
messages use the shared primitives in both themes. Skip links reach the main
content, and reduced-motion preferences disable transitions.
