import { type JSX, createEffect, createSignal, For, onCleanup } from "solid-js";

import { styled } from "styled-system/jsx";

/** Rows rendered above and below the visible ones, so scrolling stays smooth. */
const OVERSCAN = 8;

/** How close (px) to the bottom still counts as "at the bottom". */
const BOTTOM_SLACK = 4;

/**
 * A scrolling list that only renders the rows in view (plus a few more), for
 * thousands of rows of one fixed height. Newest entries are expected at the
 * bottom: while the user is at the bottom the list follows new rows.
 *
 * Uses native listeners only (`on:scroll`), so it also works inside a popout
 * window, where Solid's delegated events don't fire.
 */
export function WindowedList<T>(props: {
  items: T[];
  /** Height of every row in px */
  rowHeight: number;
  /** Index of the selected row, scrolled into view when it changes */
  selected?: number;
  /** Stable key of an item, used for the row element's id */
  rowId: (item: T) => string;
  /** Draws one row */
  children: (item: T, index: number) => JSX.Element;
  /** Accessible name of the list */
  label: string;
  /** Id of the selected row's element, for `aria-activedescendant` */
  activeId?: string;
  onKeyDown?: (event: KeyboardEvent) => void;
}) {
  let container: HTMLDivElement | undefined;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [height, setHeight] = createSignal(600);
  /** Whether new rows keep the list scrolled to the bottom */
  let following = true;

  /** Read the scroll position and whether it is at the bottom. */
  const onScroll = () => {
    if (!container) return;
    setScrollTop(container.scrollTop);
    following =
      container.scrollTop + container.clientHeight >=
      container.scrollHeight - BOTTOM_SLACK;
  };

  // follow the size of the box, with the observer of the window it is in
  const attach = (el: HTMLDivElement) => {
    container = el;
    setHeight(el.clientHeight || 600);
    const view = (el.ownerDocument.defaultView ?? window) as Window &
      typeof globalThis;
    const observer = new view.ResizeObserver(() => {
      setHeight(el.clientHeight || 600);
      if (following) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };

  // follow new rows while at the bottom
  createEffect(() => {
    const total = props.items.length * props.rowHeight;
    if (container && following) {
      container.scrollTop = total;
      setScrollTop(container.scrollTop);
    }
  });

  // keep the selected row in view
  createEffect(() => {
    const index = props.selected;
    if (!container || index === undefined || index < 0) return;
    const top = index * props.rowHeight;
    const bottom = top + props.rowHeight;
    if (top < container.scrollTop) {
      container.scrollTop = top;
    } else if (bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = bottom - container.clientHeight;
    }
  });

  const first = () =>
    Math.max(0, Math.floor(scrollTop() / props.rowHeight) - OVERSCAN);
  const last = () =>
    Math.min(
      props.items.length,
      Math.ceil((scrollTop() + height()) / props.rowHeight) + OVERSCAN,
    );
  const visible = () => props.items.slice(first(), last());

  return (
    <Scroller
      ref={attach}
      role="listbox"
      tabIndex={0}
      aria-label={props.label}
      aria-activedescendant={props.activeId}
      on:scroll={onScroll}
      on:keydown={(e: KeyboardEvent) => props.onKeyDown?.(e)}
    >
      <div
        style={{
          position: "relative",
          height: `${props.items.length * props.rowHeight}px`,
        }}
      >
        <For each={visible()}>
          {(item, i) => (
            <div
              id={props.rowId(item)}
              role="option"
              aria-selected={first() + i() === props.selected}
              style={{
                position: "absolute",
                "inset-inline": 0,
                top: `${(first() + i()) * props.rowHeight}px`,
                height: `${props.rowHeight}px`,
              }}
            >
              {props.children(item, first() + i())}
            </div>
          )}
        </For>
      </div>
    </Scroller>
  );
}

/** The scrolling box of the list */
const Scroller = styled("div", {
  base: {
    flex: "1 1 0",
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    outline: "none",

    _focusVisible: {
      boxShadow: "inset 0 0 0 2px var(--md-sys-color-primary)",
    },
  },
});
