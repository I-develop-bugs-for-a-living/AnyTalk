import {
  Accessor,
  batch,
  createEffect,
  For,
  JSX,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { cva } from "styled-system/css";
import { styled } from "styled-system/jsx";
import { Column, Row } from "../layout";

export interface ListView2Update {
  /**
   * Element that we should anchor scroll position to
   */
  scrollAnchorId: string | null;

  /**
   * Callback to apply changes to DOM
   */
  commitToDOM(): void;
}

interface Props {
  /**
   * Handle when the top of the list is reached
   * @returns Update hints and callback
   */
  fetchTop(): Promise<ListView2Update | undefined>;

  /**
   * Handle when the bottom of the list is reached
   * @returns Update hints and callback
   */
  fetchBottom(): Promise<ListView2Update | undefined>;

  /**
   * Render the list itself
   */
  children: JSX.Element;

  /**
   * Whether we've reached the start of the list
   */
  atStart: Accessor<boolean>;

  /**
   * Whether we've reached the end of the list
   */
  atEnd: Accessor<boolean>;

  /**
   * Whether the skeletons should be listening
   */
  permitFetching: Accessor<boolean>;
}

/**
 * Dynamic list view with ability to move through history
 *
 * This component only provides the scrolling behaviour
 */
export function ListView2(props: Props) {
  let ref: HTMLDivElement | undefined;

  function consumeDOMUpdate(update?: ListView2Update) {
    if (!update) return;

    const currentRect = update.scrollAnchorId
      ? document.getElementById(update.scrollAnchorId)?.getBoundingClientRect()
      : null;

    batch(() => {
      update.commitToDOM();
    });

    if (currentRect) {
      queueMicrotask(() => {
        const updatedRect = update.scrollAnchorId
          ? document
              .getElementById(update.scrollAnchorId)
              ?.getBoundingClientRect()
          : null;

        if (updatedRect) {
          ref?.scrollTo({
            top: ref.scrollTop + (updatedRect.top - currentRect.top),
          });
        }
      });
    }
  }

  async function loadStart() {
    consumeDOMUpdate(await props.fetchTop());
  }

  async function loadEnd() {
    consumeDOMUpdate(await props.fetchBottom());
  }

  return (
    <div
      ref={ref}
      use:scrollable={{
        direction: "y",
        class: container({
          parent: true,
        }),
      }}
      // Account for https://issues.chromium.org/issues/40829494
      // Chromium based browsers (read: Chrome and Electron) will overscroll on reverse column flexboxes
      // breaking automatic scrolling when adding new messages. This caps the scrolltop at 0 (it's negative.)
      onScroll={(e) => {
        if (e.target.scrollTop > 0) {
          e.target.scrollTop = 0;
        }
      }}
    >
      <div class={container()}>
        <div>
          <Show when={!props.atStart()}>
            <Skeleton
              align="end"
              onVisible={loadStart}
              containerRef={ref}
              permitFetching={props.permitFetching}
            />
          </Show>
          {props.children}
          <Show when={!props.atEnd()}>
            <Skeleton
              align="start"
              onVisible={loadEnd}
              containerRef={ref}
              permitFetching={props.permitFetching}
            />
          </Show>
        </div>
      </div>
    </div>
  );
}

/**
 * Number of skeleton messages. Covers the viewport area next to the
 * content; the list fetches more as soon as the skeleton scrolls into view.
 */
const SKELETON_COUNT = 14;

/**
 * Loading placeholder shown above or below the messages. Fetches more when it
 * scrolls into view, and animates only the messages that are on screen.
 */
function Skeleton(props: {
  onVisible(): void;
  containerRef: HTMLDivElement | undefined;
  permitFetching: Accessor<boolean>;
  align: "start" | "end";
}) {
  let ref: HTMLDivElement | undefined;

  // The shimmer only runs for skeleton messages that are actually inside the
  // scroll container. The whole skeleton is 100rem tall and overlaps the
  // viewport long before its bars are visible, so a single container-level
  // check would keep every bar animating. One shared observer toggles
  // `data-on-screen` on each message instead.
  createEffect(
    on(
      () => [ref, props.containerRef] as const,
      ([ref, containerRef]) => {
        if (ref && containerRef) {
          const observer = new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                entry.target.toggleAttribute(
                  "data-on-screen",
                  entry.isIntersecting,
                );
              }
            },
            { root: containerRef, rootMargin: "50px 0px" },
          );

          for (const message of Array.from(ref.children)) {
            observer.observe(message);
          }

          onCleanup(() => observer.disconnect());
        }
      },
    ),
  );

  function onEvent([entry]: IntersectionObserverEntry[]) {
    if (entry) {
      if (entry.isIntersecting) {
        props.onVisible();
      }
    }
  }

  createEffect(
    on(
      () => [ref, props.containerRef, props.permitFetching()] as const,
      ([ref, containerRef, permitFetching]) => {
        if (ref && containerRef && permitFetching) {
          const observer = new IntersectionObserver(onEvent, {
            root: containerRef,
          });

          observer.observe(ref);

          onCleanup(() => observer.disconnect());
        }
      },
    ),
  );

  return (
    <SkeletonBase ref={ref} align={props.align}>
      <For each={new Array(SKELETON_COUNT).fill(0)}>
        {() => (
          <Column gap="none">
            <Row>
              <AvatarFrame>
                <Frame shape="avatar" />
              </AvatarFrame>
              <Column gap="sm">
                <Frame
                  shape="username"
                  style={{
                    width: `${Math.floor(Math.random() * 5 + 5)}em`,
                  }}
                />
                <For each={new Array(Math.ceil(Math.random() * 3)).fill(0)}>
                  {() => (
                    <Frame
                      shape="content"
                      style={{
                        width: `${Math.floor(Math.random() * 10 + 15)}em`,
                      }}
                    />
                  )}
                </For>
              </Column>
            </Row>
          </Column>
        )}
      </For>
    </SkeletonBase>
  );
}

const SkeletonBase = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--message-group-spacing)",

    height: "100rem",
    overflow: "hidden",
    pointerEvents: "none",
  },
  variants: {
    align: {
      start: {
        justifyContent: "start",
      },
      end: {
        justifyContent: "end",
      },
    },
  },
});

const AvatarFrame = styled("div", {
  base: {
    width: "52px",
    alignSelf: "start",

    display: "flex",
    justifyContent: "end",
    paddingInline: "var(--gap-sm)",
  },
});

/**
 * Skeleton placeholder shape. The shimmer is a gradient band on a
 * pseudo-element moved with `transform`, which runs on the compositor
 * and costs no main-thread style/paint work (unlike `background-position`).
 */
const Frame = styled("div", {
  base: {
    position: "relative",
    overflow: "hidden",
    background: "var(--md-sys-color-surface-container-highest)",
    "&::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      background:
        "linear-gradient(90deg, transparent 0%, var(--md-sys-color-surface-container-high) 50%, transparent 100%)",
      transform: "translateX(-100%)",
      animation: "skeletonSweep 1.5s infinite",
      // paused until the parent skeleton message scrolls into view
      animationPlayState: "paused",
    },
    "[data-on-screen] &": {
      "&::after": {
        animationPlayState: "running",
        // only bars that are shown get a compositor layer
        willChange: "transform",
      },
    },
    "@media (prefers-reduced-motion: reduce)": {
      "&::after": {
        animation: "none",
        display: "none",
      },
    },
  },
  variants: {
    shape: {
      avatar: {
        width: "36px",
        height: "36px",
        borderRadius: "var(--borderRadius-full)",
      },
      username: {
        height: "0.8em",
        borderRadius: "var(--borderRadius-sm)",
      },
      content: {
        height: "var(--message-size)",
        marginTop: "var(--gap-sm)",
        borderRadius: "var(--borderRadius-sm)",
      },
    },
  },
});

const container = cva({
  base: {
    display: "flex",
    flexDirection: "column-reverse",
  },
  variants: {
    parent: {
      true: {
        height: "100%",
        flexGrow: 1,
      },
    },
  },
});
