import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { Portal } from "solid-js/web";
import { Motion, Presence } from "solid-motionone";

import { Trans, useLingui } from "@lingui/solid/macro";
import { useNavigate } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import type { Channel, Server, ServerMember, User } from "stoat.js";
import { css } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { UserContextMenu } from "@revolt/app";
import { useClient } from "@revolt/client";
import { fetchProfile } from "@revolt/client/resources";
import { Markdown } from "@revolt/markdown";
import {
  Avatar,
  CircularProgress,
  IconButton,
  OverflowingText,
  Profile,
  Text,
  UserStatus,
  emptyBannerColour,
  useMutualsQuery,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { useModals } from "..";

import { isSwipeDown, shouldCloseOnSwipe } from "./userProfileSwipe";

/** Selector for elements that can take keyboard focus */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Black overlay that keeps the white controls readable on any banner */
const BANNER_OVERLAY = "linear-gradient(rgba(0, 0, 0, 0.2),rgba(0, 0, 0, 0.5))";

/** Fills the 44px scrim circle so the whole circle is the touch target */
const FILL_STYLE = { width: "100%", height: "100%", "aspect-ratio": "auto" };

/**
 * Number of open phone profile pages that lock page scrolling, and the
 * `overflow` value to restore when the last one closes.
 */
let scrollLocks = 0;
let scrollLockRestore = "";

/**
 * Lock page scrolling. Stacked pages share one lock so closing them in any
 * order (e.g. `closeAll`) always restores the original value.
 *
 * @returns Function that releases this lock
 */
function lockPageScroll(): () => void {
  if (scrollLocks === 0) {
    scrollLockRestore = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLocks++;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLocks--;
    if (scrollLocks === 0) document.body.style.overflow = scrollLockRestore;
  };
}

/**
 * Full-screen user profile for phone layouts: one scrolling column with the
 * banner, avatar, actions and sections, and full-screen sub-pages for mutual
 * friends and groups.
 *
 * Closes with the back button, Escape or a swipe down at the top of the page.
 * While open it traps Tab, locks page scroll, and hands focus back to the
 * opener on close.
 */
export function UserProfilePhone(props: {
  /** Id of this page's modal entry, to know when it is the topmost modal */
  modalId?: string;
  show: boolean;
  onClose: () => void;
  user: User;
  member?: ServerMember;
}) {
  const { t } = useLingui();
  const modals = useModals();
  const { openModal, closeAll } = modals;
  const client = useClient();
  const navigate = useNavigate();

  const query = useQuery(() => ({
    queryKey: ["profile", props.user.id],
    queryFn: () => fetchProfile(client(), props.user),
  }));
  const mutuals = useMutualsQuery(() => props.user);

  /** Which page is showing: the profile or one of its sub-pages */
  const [view, setView] = createSignal<"profile" | "friends" | "groups">(
    "profile",
  );
  const [isCopied, setIsCopied] = createSignal(false);
  /** How far the page is dragged down by a swipe (px) */
  const [dragOffset, setDragOffset] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);

  let root: HTMLDivElement | undefined;
  let profileLayer: HTMLDivElement | undefined;
  let scroller: HTMLDivElement | undefined;
  /** Row that opened the current sub-page, to return focus to */
  let openerRow: HTMLElement | undefined;

  const reduceMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const displayName = () => props.member?.displayName ?? props.user.displayName;
  const pronouns = () => props.member?.pronouns ?? props.user.pronouns;

  /** Roles of the member that still exist on the server, highest first */
  const roles = createMemo(() =>
    props.member
      ? props.member.orderedRoles
          .filter((r) =>
            props.member?.server ? props.member.server.roles.has(r.id) : true,
          )
          .toReversed()
      : [],
  );

  /**
   * Whether this page is the topmost open modal. Pages (and anything opened
   * over them, like the image viewer) stack, and only the top one may react
   * to keys.
   */
  const isTop = () =>
    [...modals.modals].reverse().find((m) => m.show)?.id === props.modalId;

  /** Open a sub-page, remembering the row that opened it */
  function openView(next: "friends" | "groups", opener: HTMLElement) {
    openerRow = opener;
    setView(next);
  }

  /** Go back from a sub-page to the profile, focusing the row that opened it */
  function backToProfile() {
    setView("profile");
    // wait for the profile layer to lose `inert`
    requestAnimationFrame(() => openerRow?.focus());
  }

  /** Go back one page, or close from the profile page */
  function back() {
    if (view() !== "profile") backToProfile();
    else props.onClose();
  }

  // keep the profile out of reach while a sub-page is open, and the whole
  // page while something is opened over it
  createEffect(() => {
    if (profileLayer) profileLayer.inert = view() !== "profile";
    if (root) root.inert = !isTop();
  });

  // when something opened over the page closes and the page is on top again,
  // put focus back where it was before the page was covered
  let focusBeforeCover: HTMLElement | null = null;
  createEffect(
    on(isTop, (top, wasTop) => {
      if (!props.show) return;
      if (!top && wasTop) {
        const active = document.activeElement as HTMLElement | null;
        focusBeforeCover = active && root?.contains(active) ? active : null;
      } else if (top && wasTop === false) {
        // wait for the page to lose `inert`
        requestAnimationFrame(() =>
          (focusBeforeCover?.isConnected ? focusBeforeCover : root)?.focus(),
        );
      }
    }),
  );

  // focus trap, sub-page Escape, scroll lock and focus restore while open
  createEffect(
    on(
      () => props.show,
      (show) => {
        if (!show) return;

        const previous = document.activeElement as HTMLElement | null;

        // Capture phase, so it runs before the global Escape handler (which
        // closes the top modal). It only takes Escape on a sub-page, to go
        // back one page; on the profile page the global handler closes it.
        const onEscape = (event: KeyboardEvent) => {
          if (event.key !== "Escape" || !isTop() || view() === "profile")
            return;
          event.preventDefault();
          event.stopPropagation();
          backToProfile();
        };

        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key !== "Tab" || !root || !isTop()) return;

          const items = Array.from(
            root.querySelectorAll<HTMLElement>(FOCUSABLE),
          ).filter((el) => !el.closest("[inert]"));
          if (!items.length) {
            event.preventDefault();
            root.focus();
            return;
          }
          const first = items[0];
          const last = items[items.length - 1];
          const active = document.activeElement;
          if (event.shiftKey && (active === first || active === root)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
          }
        };
        document.addEventListener("keydown", onEscape, true);
        document.addEventListener("keydown", onKeyDown);

        const unlock = lockPageScroll();

        onCleanup(() => {
          document.removeEventListener("keydown", onEscape, true);
          document.removeEventListener("keydown", onKeyDown);
          unlock();
          if (!document.activeElement || root?.contains(document.activeElement))
            previous?.focus();
        });
      },
    ),
  );

  onMount(() => {
    // wait for the element to be in the page before focusing it
    requestAnimationFrame(() => root?.focus());
  });

  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copiedTimer));

  /** Copy `username#discriminator` and show "Copied!" for two seconds */
  function copyUsername() {
    navigator.clipboard
      .writeText(`${props.user.username}#${props.user.discriminator}`)
      .then(() => {
        setIsCopied(true);
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => setIsCopied(false), 2000);
      })
      .catch(() => setIsCopied(false));
  }

  // swipe down at the top of the page closes it
  let touchStart: { x: number; y: number; time: number; top: number } | null =
    null;

  /** Remember where a touch started and the scroll position at that time */
  function onTouchStart(e: TouchEvent) {
    if (view() !== "profile" || e.touches.length !== 1) return;
    const touch = e.touches[0];
    touchStart = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
      top: scroller?.scrollTop ?? 0,
    };
  }

  /** Follow the finger while a swipe down is in progress */
  function onTouchMove(e: TouchEvent) {
    if (!touchStart) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;

    if (
      isSwipeDown(touchStart.top, dx, dy) &&
      (scroller?.scrollTop ?? 0) <= 0
    ) {
      setDragging(true);
      setDragOffset(dy);
    } else if (dragging()) {
      setDragOffset(0);
    }
  }

  /** Close or snap back when the finger lifts */
  function onTouchEnd() {
    const start = touchStart;
    touchStart = null;
    if (!start || !dragging()) return;

    const offset = dragOffset();
    setDragging(false);
    setDragOffset(0);
    if (shouldCloseOnSwipe(offset, Date.now() - start.time)) props.onClose();
  }

  /** Translate a presence status message into the user's language */
  const statusText = () =>
    props.user.statusMessage((s) =>
      s === "Online"
        ? t`Online`
        : s === "Busy"
          ? t`Busy`
          : s === "Focus"
            ? t`Focus`
            : s === "Idle"
              ? t`Idle`
              : t`Offline`,
    );

  /** Slide direction for sub-pages, mirrored in right-to-left languages */
  const subPageFrom = () => (document.dir === "rtl" ? "-100%" : "100%");

  return (
    <Portal mount={document.getElementById("floating")!}>
      <Presence>
        <Show when={props.show}>
          <Motion.div
            ref={(el: HTMLDivElement) => (root = el)}
            class={rootStyle}
            role="dialog"
            aria-modal="true"
            aria-label={displayName()}
            tabIndex={-1}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{
              duration: reduceMotion() ? 0 : 0.3,
              easing: [0.05, 0.7, 0.1, 1.0],
            }}
          >
            <div
              ref={profileLayer}
              class={layerStyle}
              style={{
                transform: dragOffset() ? `translateY(${dragOffset()}px)` : "",
                transition:
                  dragging() || reduceMotion() ? "none" : "transform 0.2s",
              }}
            >
              <div
                ref={scroller}
                class={scrollStyle}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                onTouchCancel={onTouchEnd}
              >
                <Banner
                  style={{
                    "background-image": query.data?.animatedBannerURL
                      ? `${BANNER_OVERLAY}, url('${query.data.animatedBannerURL}')`
                      : BANNER_OVERLAY,
                    "background-color": query.data?.animatedBannerURL
                      ? undefined
                      : emptyBannerColour(props.user.id, query.data?.bannerHue),
                  }}
                >
                  <Show when={query.data?.banner}>
                    <button
                      type="button"
                      class={bannerTapStyle}
                      aria-label={t`View banner`}
                      onClick={() =>
                        openModal({
                          type: "image_viewer",
                          file: query.data!.banner!,
                        })
                      }
                    />
                  </Show>
                  <TopBar>
                    <ScrimCircle>
                      <IconButton
                        variant="_header"
                        aria-label={t`Back`}
                        style={FILL_STYLE}
                        onPress={back}
                      >
                        <Symbol>arrow_back</Symbol>
                      </IconButton>
                    </ScrimCircle>
                    <ScrimCircle>
                      <IconButton
                        variant="_header"
                        aria-label={t`More options`}
                        style={FILL_STYLE}
                        use:floating={{
                          contextMenu: () => (
                            <UserContextMenu
                              user={props.user}
                              member={props.member}
                              onClose={props.onClose}
                            />
                          ),
                          contextMenuHandler: "click",
                        }}
                      >
                        <Symbol>more_vert</Symbol>
                      </IconButton>
                    </ScrimCircle>
                  </TopBar>
                </Banner>

                <Body>
                  <AvatarWrap>
                    <Avatar
                      src={props.user.animatedAvatarURL}
                      fallback={displayName()}
                      size={96}
                      holepunch="bottom-right"
                      interactive={!!props.user.avatar}
                      onClick={() => {
                        if (props.user.avatar)
                          openModal({
                            type: "image_viewer",
                            file: props.user.avatar,
                          });
                      }}
                      overlay={
                        <UserStatus.Graphic status={props.user.presence} />
                      }
                    />
                  </AvatarWrap>

                  <Identity>
                    <Text class="headline" size="small">
                      {displayName()}
                    </Text>
                    <Text class="body" size="medium">
                      <UsernameButton type="button" onClick={copyUsername}>
                        {props.user.username}
                        <span class={css({ opacity: 0.6 })}>
                          #{props.user.discriminator}
                        </span>
                      </UsernameButton>
                      <Show when={pronouns()}>
                        <span class={css({ opacity: 0.6 })}>
                          {" "}
                          · {pronouns()}
                        </span>
                      </Show>
                    </Text>
                    <span
                      class={css({ fontSize: "0.75rem" })}
                      aria-live="polite"
                    >
                      <Show when={isCopied()}>
                        <Trans>Copied!</Trans>
                      </Show>
                    </span>
                    <Show when={props.user.status?.text}>
                      <Text class="body" size="medium">
                        {statusText()}
                      </Text>
                    </Show>
                  </Identity>

                  <Profile.Actions
                    variant="page"
                    user={props.user}
                    member={props.member}
                    onClose={props.onClose}
                  />

                  <Sections>
                    <Show when={query.isLoading}>
                      <Loading>
                        <CircularProgress />
                      </Loading>
                    </Show>

                    <Show when={query.data?.content}>
                      <Profile.Card width={3}>
                        <Text class="title" size="large">
                          <Trans>About me</Trans>
                        </Text>
                        <div class={bioStyle}>
                          <Markdown content={query.data?.content} />
                        </div>
                      </Profile.Card>
                    </Show>

                    <Show when={roles().length}>
                      <Profile.Card width={3}>
                        <Text class="title" size="large">
                          <Trans>Roles</Trans>
                        </Text>
                        <ul class={chipListStyle}>
                          <For each={roles()}>
                            {(role) => (
                              <Chip>
                                <RoleDot
                                  style={{
                                    background:
                                      role.colour ??
                                      "var(--md-sys-color-outline-variant)",
                                  }}
                                />
                                {role.name}
                              </Chip>
                            )}
                          </For>
                        </ul>
                      </Profile.Card>
                    </Show>

                    <Profile.Badges user={props.user} />
                    <Profile.Joined user={props.user} member={props.member} />
                    <Show when={props.user.bot}>
                      <Profile.Owner bot={props.user.bot!} />
                    </Show>

                    <Show when={mutuals.data?.users.length}>
                      <NavRow
                        type="button"
                        onClick={(e) => openView("friends", e.currentTarget)}
                      >
                        <span>
                          <Trans>
                            Mutual friends ({mutuals.data!.users.length})
                          </Trans>
                        </span>
                        <Symbol>chevron_right</Symbol>
                      </NavRow>
                    </Show>
                    <Show when={mutuals.data?.groups.length}>
                      <NavRow
                        type="button"
                        onClick={(e) => openView("groups", e.currentTarget)}
                      >
                        <span>
                          <Trans>
                            Mutual groups ({mutuals.data!.groups.length})
                          </Trans>
                        </span>
                        <Symbol>chevron_right</Symbol>
                      </NavRow>
                    </Show>
                  </Sections>
                </Body>
              </div>
            </div>

            <Presence>
              <Show when={view() !== "profile"}>
                <Motion.div
                  class={subPageStyle}
                  initial={{ x: subPageFrom() }}
                  animate={{ x: 0 }}
                  exit={{ x: subPageFrom() }}
                  transition={{
                    duration: reduceMotion() ? 0 : 0.25,
                    easing: [0.05, 0.7, 0.1, 1.0],
                  }}
                >
                  <SubHeader>
                    <span
                      ref={(el) =>
                        requestAnimationFrame(() =>
                          el.querySelector("button")?.focus(),
                        )
                      }
                    >
                      <IconButton aria-label={t`Back`} onPress={back}>
                        <Symbol>arrow_back</Symbol>
                      </IconButton>
                    </span>
                    <Text class="title" size="large">
                      <Show
                        when={view() === "friends"}
                        fallback={<Trans>Mutual groups</Trans>}
                      >
                        <Trans>Mutual friends</Trans>
                      </Show>
                    </Text>
                  </SubHeader>
                  <SubList>
                    <Show when={view() === "friends"}>
                      <For each={mutuals.data?.users}>
                        {(user) => (
                          <ListRow
                            type="button"
                            onClick={() =>
                              openModal({
                                type: "user_profile",
                                user,
                                member: props.member?.server?.getMember(
                                  user.id,
                                ),
                              })
                            }
                          >
                            <Avatar
                              size={40}
                              src={user.animatedAvatarURL}
                              fallback={user.displayName}
                            />
                            <OverflowingText>{user.username}</OverflowingText>
                          </ListRow>
                        )}
                      </For>
                    </Show>
                    <Show when={view() === "groups"}>
                      <For each={mutuals.data?.groups}>
                        {(group: Server | Channel) => (
                          <ListRow
                            type="button"
                            onClick={() => {
                              navigate(group.path);
                              closeAll();
                            }}
                          >
                            <Avatar
                              size={40}
                              src={group.animatedIconURL}
                              fallback={group.name}
                            />
                            <OverflowingText>{group.name}</OverflowingText>
                          </ListRow>
                        )}
                      </For>
                    </Show>
                  </SubList>
                </Motion.div>
              </Show>
            </Presence>
          </Motion.div>
        </Show>
      </Presence>
    </Portal>
  );
}

/** Full-screen surface, over the app and under the context menus */
const rootStyle = css({
  position: "fixed",
  inset: 0,
  zIndex: 100,
  height: "100dvh",
  overflow: "hidden",
  outline: "none",
  color: "var(--md-sys-color-on-surface)",
  background: "var(--md-sys-color-surface)",
});

/** Layer that moves with the swipe */
const layerStyle = css({
  height: "100%",
  background: "var(--md-sys-color-surface)",
});

/** Vertical scroll area, never sideways */
const scrollStyle = css({
  height: "100%",
  overflowY: "auto",
  overflowX: "hidden",
  overscrollBehavior: "contain",
  paddingBlockEnd: "calc(24px + env(safe-area-inset-bottom))",
  overflowWrap: "anywhere",
});

/** Invisible button over the banner image that opens the image viewer */
const bannerTapStyle = css({
  position: "absolute",
  inset: 0,
  border: 0,
  padding: 0,
  background: "transparent",
  cursor: "pointer",
});

/** Bio text, selectable */
const bioStyle = css({
  userSelect: "text",
  minWidth: 0,
});

/** Wrapping list of role chips */
const chipListStyle = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  margin: 0,
  padding: 0,
  listStyle: "none",
});

/** Sub-page layer that covers the profile */
const subPageStyle = css({
  position: "absolute",
  inset: 0,
  zIndex: 1,
  display: "flex",
  flexDirection: "column",
  background: "var(--md-sys-color-surface)",
  paddingBlockStart: "env(safe-area-inset-top)",
  paddingBlockEnd: "env(safe-area-inset-bottom)",
  // safe-area insets are physical
  paddingLeft: "env(safe-area-inset-left)",
  paddingRight: "env(safe-area-inset-right)",
});

/** Banner that extends under the top safe area */
const Banner = styled("div", {
  base: {
    position: "relative",
    height: "calc(140px + env(safe-area-inset-top))",
    backgroundSize: "cover",
    backgroundPosition: "center",
  },
});

/** Row with the back and menu buttons, below the safe area */
const TopBar = styled("div", {
  base: {
    position: "absolute",
    insetInline: 0,
    insetBlockStart: 0,
    display: "flex",
    justifyContent: "space-between",
    paddingBlockStart: "calc(8px + env(safe-area-inset-top))",
    paddingLeft: "calc(8px + env(safe-area-inset-left))",
    paddingRight: "calc(8px + env(safe-area-inset-right))",
    pointerEvents: "none",

    "& > *": {
      pointerEvents: "auto",
    },
  },
});

/** Content below the banner */
const Body = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    paddingLeft: "calc(16px + env(safe-area-inset-left))",
    paddingRight: "calc(16px + env(safe-area-inset-right))",
  },
});

/** Pulls the avatar up over the banner */
const AvatarWrap = styled("div", {
  base: {
    marginBlockStart: "-48px",
    width: "fit-content",
    position: "relative",
  },
});

/** Names and status */
const Identity = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
  },
});

/** Username text that copies on tap, at least 44px tall */
const UsernameButton = styled("button", {
  base: {
    all: "unset",
    cursor: "pointer",
    minHeight: "44px",
    display: "inline-flex",
    alignItems: "center",
    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
    },
  },
});

/** Stack of sections; profile cards are stretched to the column width */
const Sections = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",

    // the shared profile cards are square tiles in the grid layouts
    "& > div": {
      aspectRatio: "auto",
      height: "auto",
      overflow: "visible",
    },
  },
});

/** Box for the loading spinner */
const Loading = styled("div", {
  base: {
    height: "56px",
    width: "56px",
    alignSelf: "center",
  },
});

/** Role chip */
const Chip = styled("li", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "32px",
    paddingInline: "12px",
    borderRadius: "var(--borderRadius-full)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    color: "var(--md-sys-color-on-surface-variant)",
    maxWidth: "100%",
  },
});

/** Colour dot of a role */
const RoleDot = styled("span", {
  base: {
    flexShrink: 0,
    width: "8px",
    height: "8px",
    borderRadius: "var(--borderRadius-circle)",
  },
});

/** Row that opens a sub-page */
const NavRow = styled("button", {
  base: {
    all: "unset",
    boxSizing: "border-box",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    minHeight: "56px",
    width: "100%",
    paddingInline: "16px",
    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-surface-container-low)",
    color: "var(--md-sys-color-on-surface)",
    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
    },
  },
});

/** Header of a sub-page */
const SubHeader = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexShrink: 0,
    minHeight: "56px",
    paddingInline: "8px 16px",
  },
});

/** Scrolling list of a sub-page */
const SubList = styled("div", {
  base: {
    flexGrow: 1,
    overflowY: "auto",
    overflowX: "hidden",
    overscrollBehavior: "contain",
    display: "flex",
    flexDirection: "column",
  },
});

/** Tappable row in a sub-page list */
const ListRow = styled("button", {
  base: {
    all: "unset",
    boxSizing: "border-box",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minHeight: "56px",
    paddingInline: "16px",
    minWidth: 0,
    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "-2px",
    },
  },
});

/** 44px dark circle that keeps the banner buttons readable on any banner */
const ScrimCircle = styled("span", {
  base: {
    display: "flex",
    width: "44px",
    height: "44px",
    borderRadius: "var(--borderRadius-circle)",
    background: "rgba(0, 0, 0, 0.45)",
  },
});
