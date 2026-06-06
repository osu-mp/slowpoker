# Chip Stack Visualization Plan

## Context

SlowPoker is a React/TypeScript poker app (Vite client + Express/WS server). Chip values are plain integers. The goal is to replace bare chip numbers with realistic stacked chip visuals everywhere, and animate bets as a flying chip cluster.

Relevant files:
- `client/src/App.tsx` — single-component UI, all game rendering
- `client/src/styles.css` — all styles
- `client/src/sounds.ts` — audio (not relevant here)
- `server/src/` — no changes needed for this feature

---

## Denomination Set

Standard home-game denominations (hardcoded, not configurable):

| Value | Color name | CSS color |
|-------|-----------|-----------|
| 500 | Purple | `#9b59b6` |
| 100 | Black | `#2c2c2c` |
| 25 | Green | `#27ae60` |
| 5 | Red | `#e74c3c` |
| 1 | White | `#d5d8dc` |

```ts
const DENOMS = [500, 100, 25, 5, 1] as const;
const DENOM_COLOR: Record<number, string> = {
  500: "#9b59b6",
  100: "#2c2c2c",
   25: "#27ae60",
    5: "#e74c3c",
    1: "#d5d8dc",
};
const DENOM_BORDER: Record<number, string> = {
  500: "#7d3c98",
  100: "#111",
   25: "#1e8449",
    5: "#c0392b",
    1: "#aab7b8",
};
```

---

## `chipBreakdown(amount)` Utility

Greedy decomposition — returns array of `{ denom, count }` in descending order, skipping zeros.

```ts
type ChipGroup = { denom: number; count: number };

function chipBreakdown(amount: number): ChipGroup[] {
  let remaining = Math.max(0, Math.floor(amount));
  const result: ChipGroup[] = [];
  for (const d of DENOMS) {
    const count = Math.floor(remaining / d);
    if (count > 0) result.push({ denom: d, count });
    remaining %= d;
  }
  return result;
}
```

---

## `ChipStack` Component

Renders a vertical stack of chip discs. Multiple columns if a single denomination has >10 chips.

### Visual design of one chip disc

- Circle, 20px diameter (seat) / 16px (pot) / 24px (large)
- Background: `DENOM_COLOR[denom]`
- Border: 2px solid `DENOM_BORDER[denom]`
- Box-shadow for 3D bevel:
  ```css
  box-shadow: 0 2px 0 <border-color>, inset 0 1px 0 rgba(255,255,255,0.25);
  ```
- In a stack, each chip is offset 5px upward from the previous (absolute positioning within a relative column div)

### Stacking layout

- One column per denomination (e.g. 3 green chips = one column of 3)
- Within a denomination: cap at 10 chips per column, start a new column if more
- Columns sit side-by-side (flexbox row, gap 3px)
- A small label (count × denom) appears below each column if count > 10, replacing extra chips with a ×N badge

### Sizing variants

```tsx
type ChipSize = "sm" | "md" | "lg";
// sm: 14px chips, 4px offset — used in seat stacks
// md: 18px chips, 5px offset — used in pot
// lg: 24px chips, 6px offset — used nowhere yet, future
```

### Props

```tsx
function ChipStack({ amount, size = "sm", maxCols = 8 }: {
  amount: number;
  size?: ChipSize;
  maxCols?: number;
}) { ... }
```

---

## Integration Points

### 1. Seat chip count (replace bare number)

Currently: `<AnimatedNumber value={p.stack} />`  
Replace with: `<ChipStack amount={p.stack} size="sm" />` alongside the number (number stays for precision).

Layout: number on top, chip stack below it within the seat card.

### 2. Pot display (center of table)

Currently: `Pot: <AnimatedNumber value={state.pot} />`  
Replace with: number on top, `<ChipStack amount={state.pot} size="md" />` below.

Keep the existing pot pulse animation (framer-motion scale) wrapping the whole thing.

### 3. Side pots

Same treatment as main pot. Each side pot label gets its own `<ChipStack>`.

---

## Flying Chip Animation

### Current behavior

A `flyingChip` div (showing the bet amount as a number) flies from the seat's ellipse position to the center (50%, 50%) using framer-motion spring animation.

### New behavior

Replace the single `flyingChip` with a `flyingChipCluster` — a rendered `<ChipStack>` that flies as one unit. No individual chips animate separately. No merge animation.

When the cluster reaches the center:
- It disappears (exit animation: opacity 0, scale 0.8)
- The pot `<ChipStack>` re-renders with the updated total (snaps to new value — no incremental merge)

### Implementation

**In the `ChipAnim` type** (already exists):
```ts
type ChipAnim = { id: number; seatIndex: number; amount: number };
// amount is already there — no type change needed
```

**In the chip animation layer** (already exists in JSX, search for `chipAnimationLayer`):

Replace the current `motion.div` contents:
```tsx
// Old: shows a number
<motion.div key={chip.id} className="flyingChip" ...>
  {chip.amount}
</motion.div>

// New: shows a chip stack cluster
<motion.div
  key={chip.id}
  className="flyingChipCluster"
  initial={{ left: startLeft, top: startTop, scale: 1, opacity: 1 }}
  animate={{ left: "50%", top: "50%", scale: 0.7, opacity: 0 }}
  transition={{ type: "spring", stiffness: 180, damping: 22 }}
  onAnimationComplete={() =>
    setChipAnimations(a => a.filter(c => c.id !== chip.id))
  }
>
  <ChipStack amount={chip.amount} size="sm" />
</motion.div>
```

The opacity goes to 0 on arrival — the updated pot stack appears immediately when state updates (which happens server-side on the same action that triggered the animation). The timing usually works out; if not, a brief delay can be added before the pot re-renders.

### CSS for `.flyingChipCluster`

```css
.flyingChipCluster {
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 10;
}
```

Remove or repurpose the old `.flyingChip` style.

---

## Build Order

1. **`chipBreakdown()` + `ChipStack` component** — pure UI, no state changes. Test in isolation by temporarily rendering `<ChipStack amount={580} size="md" />` somewhere visible.

2. **Seat stack display** — swap `AnimatedNumber` for `ChipStack` in the seat card. Verify all stack sizes look right (0 chips edge case: show nothing or a gray "empty" chip).

3. **Pot display** — swap the pot total. Check side pots.

4. **Flying animation** — replace `flyingChip` div contents with `<ChipStack>`. Tune spring physics so the cluster doesn't fly too slowly (the stack SVG is heavier visually than a number).

5. **Polish** — check mobile layout (sm breakpoint hides the felt ring; chip stacks should still render inline), check that very large stacks (10,000+) don't overflow seat cards.

---

## Edge Cases

- **amount = 0**: `chipBreakdown(0)` returns `[]`. `ChipStack` renders nothing (or a faint placeholder).
- **amount not divisible by 1** (shouldn't happen — chips are integers): `Math.floor` guards this.
- **Very large amounts** (e.g. 9,500): `9500 = 19×500`. That's 19 purple chips. Cap at 10 per column → 1 full column + 1 column of 9. Fine.
- **All-in pot with many side pots**: each pot renders its own `ChipStack`. Keep `size="sm"` for side pots to avoid crowding.
- **Mobile** (≤700px): the table ring switches to a column layout; chip stacks should use `size="sm"` always on mobile.
