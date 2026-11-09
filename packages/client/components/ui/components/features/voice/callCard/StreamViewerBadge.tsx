import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";

import { plural } from "@lingui/core/macro";
import { styled } from "styled-system/jsx";

import { useUser } from "@revolt/markdown/users";
import { useVoice } from "@revolt/rtc";
import { otherViewers } from "@revolt/rtc/viewerList";
import { Avatar } from "@revolt/ui/components/design";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { theaterControlsHidden, touchOnly } from "./volumePanelState";

/**
 * Eye badge in the top start corner of a stream tile with the number of people
 * watching it. The list of who watches shows on hover or keyboard focus, and
 * on touch a tap opens and closes it. Nothing shows without other viewers.
 */
export function StreamViewerBadge(props: { streamer: string }) {
  const voice = useVoice();

  const viewers = createMemo(() =>
    otherViewers(
      voice.viewersOf(props.streamer),
      voice.room()?.localParticipant.identity,
    ),
  );

  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const [pinned, setPinned] = createSignal(false);
  /** Whether the list shows, for any of the three ways to open it */
  const open = () => hovered() || focused() || pinned();

  let holderRef: HTMLDivElement | undefined;
  let lastPointer = "mouse";

  /** Hide the list whatever opened it */
  const close = () => {
    setHovered(false);
    setFocused(false);
    setPinned(false);
  };

  // the list can't stay open once the controls fade or the viewers are gone
  createEffect(() => {
    if (!viewers().length || theaterControlsHidden()) close();
  });

  // a tap anywhere else closes a list opened by touch
  createEffect(() => {
    if (!pinned()) return;
    const onOutside = (e: PointerEvent) => {
      if (!holderRef?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onOutside);
    onCleanup(() => document.removeEventListener("pointerdown", onOutside));
  });

  /** Spoken and tooltip text, e.g. "2 people watching" */
  const label = () =>
    plural(viewers().length, {
      one: "# person watching",
      other: "# people watching",
    });

  return (
    <Show when={viewers().length}>
      <Holder
        ref={holderRef}
        hidden={theaterControlsHidden()}
        // like the name overlay: shown while the pointer is over the tile
        // (touch has no hover, there it stays), and kept while the list is
        // open or the badge has keyboard focus
        fade={!touchOnly() && !open() && !theaterControlsHidden()}
        // faded out: also out of the tab order and away from screen readers
        inert={theaterControlsHidden()}
        // a click here must not focus or enlarge the tile
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // only Escape on an open list is ours, other keys go on
          if (e.key === "Escape" && open()) {
            e.stopPropagation();
            e.preventDefault();
            close();
          }
        }}
        onPointerEnter={(e) => e.pointerType !== "touch" && setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocusIn={(e) =>
          // only keyboard focus: a tap focusing the button must not undo itself
          setFocused((e.target as Element).matches(":focus-visible"))
        }
        onFocusOut={(e) => {
          if (!holderRef?.contains(e.relatedTarget as Node)) setFocused(false);
        }}
      >
        <Badge
          type="button"
          aria-label={label()}
          aria-haspopup="true"
          aria-expanded={open()}
          onPointerDown={(e) => (lastPointer = e.pointerType)}
          // a keyboard click has no pointer (detail 0), it must not pin
          onClick={(e) =>
            e.detail > 0 && lastPointer === "touch" && setPinned((p) => !p)
          }
        >
          <Symbol size={16}>visibility</Symbol>
          {viewers().length}
        </Badge>
        <Show when={open()}>
          <List role="list" aria-label={label()}>
            <For each={viewers()}>{(id) => <Viewer id={id} />}</For>
          </List>
        </Show>
      </Holder>
    </Show>
  );
}

/** One viewer: avatar and name */
function Viewer(props: { id: string }) {
  // eslint-disable-next-line solid/reactivity
  const user = useUser(props.id);

  return (
    <Item role="listitem">
      <Avatar
        src={user().avatar}
        fallback={user().username}
        size={24}
        interactive={false}
      />
      <Name>{user().username}</Name>
    </Item>
  );
}

/**
 * Covers the tile so the list can be as tall as the tile, only its children
 * take pointer input
 */
const Holder = styled("div", {
  base: {
    gridArea: "1/1",
    justifySelf: "start",
    alignSelf: "stretch",
    position: "relative",
    minHeight: 0,
    zIndex: 2,
    padding: "var(--gap-sm)",
    pointerEvents: "none",
    transition: "var(--transitions-fast) opacity ease",
    "& > *": { pointerEvents: "auto" },
  },
  variants: {
    // full screen with idle controls: faded out for good
    hidden: {
      true: { opacity: 0, "& > *": { pointerEvents: "none" } },
    },
    // only while the tile is hovered, same fade as the name overlay (the
    // tile has the "group" class); keyboard focus on the badge shows it too
    fade: {
      true: {
        opacity: 0,
        "& > *": { pointerEvents: "none" },
        _groupHover: { opacity: 1, "& > *": { pointerEvents: "auto" } },
        _focusWithin: { opacity: 1, "& > *": { pointerEvents: "auto" } },
      },
    },
  },
});

/**
 * Small pill on a translucent dark background. The colors are fixed because
 * the badge sits on video, where theme colors can be unreadable. The invisible
 * ::after makes the touch target at least 44px.
 */
const Badge = styled("button", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "var(--gap-xs)",
    height: "28px",
    paddingInline: "var(--gap-md)",
    border: "none",
    borderRadius: "var(--borderRadius-full)",
    cursor: "pointer",
    background: "rgb(0 0 0 / 0.55)",
    color: "white",
    fontSize: "0.8125rem",
    fontWeight: 600,
    position: "relative",

    _after: { content: '""', position: "absolute", inset: "-8px" },
    _hover: { background: "rgb(0 0 0 / 0.75)" },
    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "2px",
    },
  },
});

/** Vertical list under the badge, scrolls when it doesn't fit the tile */
const List = styled("div", {
  base: {
    position: "absolute",
    insetInlineStart: "var(--gap-sm)",
    // touches the badge, the spacing is padding so the pointer never leaves
    insetBlockStart: "calc(28px + var(--gap-sm))",
    maxHeight: "calc(100% - 28px - var(--gap-sm) * 2)",
    maxWidth: "min(16rem, 70vw)",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
    padding: "var(--gap-sm)",
    paddingBlockStart: "var(--gap-md)",
    borderRadius: "var(--borderRadius-md)",
    background: "rgb(0 0 0 / 0.75)",
    color: "white",
  },
});

/** One row of the list */
const Item = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "var(--gap-sm)",
    minWidth: 0,
  },
});

/** Username, cut off with an ellipsis when too long */
const Name = styled("span", {
  base: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "0.8125rem",
  },
});
