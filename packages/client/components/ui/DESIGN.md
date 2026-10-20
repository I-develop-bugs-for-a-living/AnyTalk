# AnyTalk UI design notes

Read this before designing or building UI. The goal: new UI looks like it belongs, reuses what exists, and works on phones, with a keyboard and in every language.

## Look and feel

- Based on **Material 3 (Material You)**. Colors come from a generated Material palette, shapes from the M3 corner scale.
- Calm surfaces, one accent color (`primary`), rounded shapes, little decoration.
- Dark and light mode are both supported. Never hard-code colors, so both keep working.

## Building blocks

### Styling

- PandaCSS: `styled()` and `css()` from `styled-system/jsx` / `styled-system/css`, `cva()` for components with variants. Look at `design/Button.tsx` as the reference.
- Responsive conditions from `components/common/Breakpoint.ts`: `phone` (max-width 600px) and `tablet` (max-width 840px or max-height 600px). Use them as Panda conditions with a leading underscore: `{ padding: "16px", _phone: { padding: "8px" } }`.

### Colors (CSS variables)

Use the Material roles, never hex values:

| Use | Variable |
|---|---|
| Main text | `--md-sys-color-on-surface` |
| Secondary text, icons | `--md-sys-color-on-surface-variant` |
| Page background | `--md-sys-color-surface` |
| Cards, panels (low to high emphasis) | `--md-sys-color-surface-container-low`, `-container`, `-container-high`, `-container-highest` |
| Accent, primary actions | `--md-sys-color-primary` / `--md-sys-color-on-primary` |
| Selected or highlighted areas | `--md-sys-color-primary-container`, `--md-sys-color-secondary-container` (with their `on-` text colors) |
| Borders, dividers | `--md-sys-color-outline-variant` (subtle), `--md-sys-color-outline` (stronger) |
| Errors, destructive actions | `--md-sys-color-error` |

Presence colors are `--brand-presence-online/idle/busy/focus/invisible`.

### Shape, spacing, motion

- Corner radius: `--borderRadius-xs` (4px), `-sm` (8), `-md` (12), `-lg` (16), `-xl` (28), `-full` (pill), `-circle`. Small controls use `sm`/`md`, cards and dialogs `lg`/`xl`, buttons and chips `full`.
- Spacing: use multiples of 4px (4, 8, 12, 16, 24, 32). The `--gap-*` variables are deprecated, so set spacing in the component.
- Transitions: `--transitions-fast` (.1s) for hover and press, `--transitions-medium` (.2s) for opening and moving things. Respect `prefers-reduced-motion` for larger animations.

### Typography

Use `<Text class="..." size="...">` from `@revolt/ui` instead of setting font sizes: `display`, `headline`, `title`, `label`, `body`, each with `large`, `medium`, `small`. Typical: `title` for section headings, `label` for buttons and small captions, `body` for running text.

### Components to reuse

Exported from `@revolt/ui` (`components/ui/components/design`): `Button` (variants `filled`, `tonal`, `outlined`, `text`, `elevated`; sizes `xs` to `xl`), `IconButton`, `Fab`, `TextField`, `TextEditor`, `Checkbox`, `Radio2`, `Switch`, `Slider`, `FloatingSelect`, `Dialog`, `BottomSheet` (phone-only sheet from the bottom edge: scrim, focus trap, scroll lock, close button; use it where desktop shows a popover), `MenuItem`, `MenuButton`, `List`, `DataTable`, `Avatar`, `Badge`, `CircularProgress`, `LoadingScreen`, `Text`.

Layout helpers: `Column`, `Row`, `Header`, `main` (`components/layout`). Icons: `Symbol` from `@revolt/ui/components/utils/Symbol` (Material Symbols, outlined; `fill` only for active states).

Check these before writing a new component. If something is close but not quite right, extend it with a variant instead of copying it.

### Button hierarchy

- One `filled` button per view for the main action.
- `tonal` for important secondary actions, `text` for low-emphasis actions (Cancel, Learn more).
- Destructive actions (delete, kick, ban) confirm in a `Dialog` and use the error color.

## Empty states

Every list, panel or page that can be empty needs an empty state instead of blank space:

- A large `Symbol` icon in `--md-sys-color-on-surface-variant`, a short `title` ("No friends yet") and one line of `body` text explaining what goes here.
- If the user can fix it, add one button with the action ("Add a friend").
- Center it in the available space. Keep it quiet: no bright colors or big illustrations.
- Loading is not empty: show `CircularProgress` or skeletons while data loads, and only then the empty state.

## Mobile

Design with phones in mind from the start, but desktop and phone don't have to work the same way.

- **Desktop and phone can differ.** Hover, right-click and keyboard shortcuts are fine on desktop. On phones, the same feature can work differently (tap, long-press, a bottom sheet, a separate screen), be simplified, or be left out.
- **Decide with the user.** Whether a feature ships on phones, and what the phone version looks like, is the user's decision. When designing something that relies on hover or a large screen, propose a phone version (or suggest leaving it out) and ask, instead of silently copying the desktop behavior or dropping the feature.
- **Hover is allowed** on desktop. Anything that only appears on hover needs a phone solution, or an explicit decision that it's desktop-only. Use the `_phone` / `_tablet` conditions or `(hover: hover)` media queries to separate the two, so phones never get stuck on a hover state.
- Note desktop-only features in a code comment (e.g. `// desktop only: phones use the long-press menu`), so it's clear the gap is on purpose.
- Test at phone width (375px) and in iPhone Safari. Respect safe areas with `env(safe-area-inset-*)` (rounded corners, home indicator), as recent fixes do.
- Touch targets are at least 44×44px.
- Use the visible viewport (`dvh`), not `vh`, for full-height layouts.

## Accessibility

- Semantic elements: `button` for actions, `a` for navigation, headings in order, lists as lists.
- Icon-only buttons need an `aria-label` (translated).
- Everything works with the keyboard: visible focus ring, logical tab order, `Escape` closes menus and dialogs, focus returns to where it came from.
- Text contrast follows the Material roles above. Don't put `on-surface-variant` text on `surface-container-highest` for small text.

## Languages and text length

- All text goes through Lingui (see CLAUDE.md). Design for text that's 30–50% longer than English (German, French) and for CJK text (Japanese, Korean, Chinese) that's shorter but taller. Let buttons and labels grow or wrap, never fix their width to the English text.
### Right-to-left (Arabic, Persian, Urdu, Kurdish)

Languages marked `rtl: true` in `components/i18n/Languages.ts` set `dir="rtl"` on the page, and the layout flips. To keep it working:

- Use logical CSS properties instead of left/right: `marginInlineStart`, `paddingInlineEnd`, `borderInlineStart`, `insetInlineEnd`, `textAlign: "start"`. Flexbox and grid flip on their own.
- Left/right is still correct for positions from mouse or pointer coordinates (floating menus, dragging), symmetric `left: 0; right: 0`, centering with `left: 50%`, safe-area insets, and video or call overlays.
- Icons that point in the reading direction (back, forward, chevrons, reply, send, logout) must mirror. `Symbol` does this automatically for known names. For SVG icons, add `class="rtl-mirror"`.
- Use `_rtl` / `_ltr` Panda conditions for anything else that needs to differ.
- To test, switch the app language to Arabic in settings.
