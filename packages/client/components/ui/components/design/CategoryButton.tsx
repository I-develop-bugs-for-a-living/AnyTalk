import {
  ComponentProps,
  For,
  JSX,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  splitProps,
} from "solid-js";

import { cva } from "styled-system/css";
import { styled } from "styled-system/jsx";

import MdChevronRight from "@material-design-icons/svg/outlined/chevron_right.svg?component-solid";
import MdContentCopy from "@material-design-icons/svg/outlined/content_copy.svg?component-solid";
import MdKeyboardDown from "@material-design-icons/svg/outlined/keyboard_arrow_down.svg?component-solid";
import MdOpenInNew from "@material-design-icons/svg/outlined/open_in_new.svg?component-solid";

import { OverflowingText, iconSize } from "../utils";

import { Radio2 } from "./Radio";
import { Ripple } from "./Ripple";
import { typography } from "./Text";
import { TextField } from "./TextField";

/**
 * Permissible actions
 */
type Action =
  | "chevron"
  | "collapse"
  | "external"
  | "edit"
  | "copy"
  | JSX.Element;

export interface Props {
  readonly icon?: JSX.Element | "blank";
  readonly children?: JSX.Element;
  readonly description?: JSX.Element;

  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly action?: Action | Action[];

  readonly roundedIcon?: boolean;
  readonly iconBackground?: boolean;

  readonly variant?: "filled" | "tonal" | "tertiary" | "tertiaryAlt";

  readonly ignoreClick?: boolean;
}

/**
 * Category Button
 */
export function CategoryButton(props: Props) {
  return (
    <Base
      variant={props.variant}
      isLink={!!props.onClick}
      disabled={props.disabled}
      aria-disabled={props.disabled}
      onClick={(e: Event) => {
        // Disable action when button is disabled
        if (props.disabled || props.ignoreClick) return;

        // Prevent propagation when action is called
        e.preventDefault();
        props.onClick?.();
      }}
    >
      <Ripple />

      <Show when={props.icon !== "blank"}>
        <IconWrapper
          rounded={props.roundedIcon}
          transparent={props.iconBackground === false}
        >
          {props.icon}
        </IconWrapper>
      </Show>

      <Show when={props.icon === "blank"}>
        <BlankIconWrapper />
      </Show>

      <Content>
        <Show when={props.children}>
          <OverflowingText>{props.children}</OverflowingText>
        </Show>
        <Show when={props.description}>
          <Description>{props.description}</Description>
        </Show>
      </Content>
      <For each={Array.isArray(props.action) ? props.action : [props.action]}>
        {(action) => (
          <Switch fallback={action}>
            <Match when={action === "chevron"}>
              <Action>
                <MdChevronRight class="rtl-mirror" {...iconSize(18)} />
              </Action>
            </Match>
            <Match when={action === "collapse"}>
              <Action>
                <MdKeyboardDown {...iconSize(18)} />
              </Action>
            </Match>
            <Match when={action === "external"}>
              <Action>
                <MdOpenInNew {...iconSize(18)} />
              </Action>
            </Match>
            <Match when={action === "copy"}>
              <Action>
                <MdContentCopy {...iconSize(18)} />
              </Action>
            </Match>
          </Switch>
        )}
      </For>
    </Base>
  );
}

/**
 * Base container for button
 */
const Base = styled("a", {
  base: {
    // for <Ripple />:
    position: "relative",

    gap: "16px",
    padding: "13px",
    borderRadius: "var(--borderRadius-md)",

    userSelect: "none",
    cursor: "pointer",
    transition: "background-color 0.1s ease-in-out",

    display: "flex",
    alignItems: "center",
    flexDirection: "row",

    color: "var(--color)",
    fill: "var(--color)",
  },
  variants: {
    variant: {
      filled: {
        background: "var(--md-sys-color-primary)",
        "--color": "var(--md-sys-color-on-primary)",
      },
      tonal: {
        background: "var(--md-sys-color-secondary-container)",
        "--color": "var(--md-sys-color-on-secondary-container)",
      },
      tertiary: {
        background: "var(--md-sys-color-tertiary-container)",
        "--color": "var(--md-sys-color-on-tertiary-container)",
        "--mdui-color-primary": "var(--color)",
      },
      tertiaryAlt: {
        background: "var(--md-sys-color-tertiary)",
        "--color": "var(--md-sys-color-on-tertiary)",
        "--mdui-color-primary": "var(--color)",
      },
    },
    isLink: {
      true: {
        cursor: "pointer",
      },
      false: {
        cursor: "initial",
      },
    },
    disabled: {
      true: {
        cursor: "not-allowed",
      },
    },
  },
  defaultVariants: {
    variant: "tonal",
  },
});

/**
 * Title and description styles
 */
const Content = styled("div", {
  base: {
    display: "flex",
    flexGrow: 1,
    flexDirection: "column",

    fontWeight: 500,
    fontSize: "14px",
    gap: "2px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

/**
 * Accented wrapper for the category button icons
 */
const IconWrapper = styled("div", {
  base: {
    fill: "var(--md-sys-color-on-surface)",
    background: "var(--md-sys-color-surface-dim)",

    width: "36px",
    height: "36px",
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  variants: {
    rounded: {
      true: {
        borderRadius: "var(--borderRadius-full)",
      },
      false: {
        borderRadius: "var(--borderRadius-md)",
      },
    },
    transparent: {
      true: {
        background: "transparent",
      },
    },
  },
  defaultVariants: {
    rounded: true,
  },
});

/**
 * Category button icon wrapper for the blank state
 */
const BlankIconWrapper = styled(IconWrapper, {
  base: {
    background: "transparent",
  },
});

/**
 * Description shown below title
 */
const Description = styled("span", {
  base: {
    ...typography.raw({ class: "label" }),

    textWrap: "wrap",

    "& a:hover": {
      textDecoration: "underline",
    },
  },
});

/**
 * Container for action icons
 */
const Action = styled("div", {
  base: {
    width: "24px",
    height: "24px",
    flexShrink: 0,

    display: "grid",
    placeItems: "center",
  },
});

/**
 * Group a set of category buttons
 */
CategoryButton.Group = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-xs)",

    borderRadius: "var(--borderRadius-xl)",
    overflow: "hidden",
  },
});

type CollapseProps = Omit<
  ComponentProps<typeof CategoryButton>,
  "onClick" | "children"
> & {
  children?: JSX.Element;
  title?: JSX.Element;

  scrollable?: boolean;
};

const MAX_HEIGHT = 340;

/**
 * Category button with collapsed children
 */
CategoryButton.Collapse = (props: CollapseProps) => {
  const [_, remote] = splitProps(props, ["action", "children"]);

  const [opened, setOpened] = createSignal(false);
  let column: HTMLDivElement | undefined;

  //Toggle the opened state and scroll to the beginning of contents
  const toggleOpened = () => {
    const open = !opened();
    if (open) column?.scroll({ top: 0 });
    setOpened(open);
  };

  //Recalculate the column height for transition
  const updatedHeight = createMemo(() => {
    const height = opened()
      ? Math.min(column?.scrollHeight || 0, MAX_HEIGHT)
      : 0;
    return `${height}px`;
  });

  return (
    <Details onClick={toggleOpened} class={opened() ? "open" : undefined}>
      <summary>
        <CategoryButton
          {...remote}
          action={[props.action, "collapse"].flat()}
          onClick={() => void 0}
        >
          {props.title}
        </CategoryButton>
      </summary>
      <Switch
        fallback={
          <div
            class={innerColumn({ static: true })}
            ref={column!}
            style={{ height: updatedHeight() }}
          >
            {props.children}
          </div>
        }
      >
        <Match when={props.scrollable}>
          <div
            ref={column!}
            style={{ height: updatedHeight() }}
            use:scrollable={{ class: innerColumn() }}
          >
            {props.children}
          </div>
        </Match>
      </Switch>
    </Details>
  );
};

export type CategorySelectOption = Omit<
  ComponentProps<typeof CategoryButton>,
  "onClick" | "children"
> &
  (
    | {
        title: JSX.Element;
        shortDesc?: JSX.Element;
      }
    | {
        title?: JSX.Element;
        shortDesc: JSX.Element;
      }
  );

/**
 * Opt-in search field shown at the top of an opened select
 */
export interface SelectSearch<T extends string> {
  /** Accessible label and placeholder of the field */
  readonly label: string;
  /** Whether an option matches what the user typed */
  readonly matches: (query: string, key: T) => boolean;
  /** Spoken (polite live region) summary of the number of results */
  readonly resultsLabel: (count: number) => string;
  /** Title of the empty state when nothing matches */
  readonly emptyTitle: JSX.Element;
  /** One line of help in the empty state */
  readonly emptyBody: JSX.Element;
}

type SelectProps<T extends string> = Omit<
  ComponentProps<typeof CategoryButton>,
  "onClick" | "children" | "description"
> & {
  title?: JSX.Element;
  options: { [k in T]: CategorySelectOption };
  /** Adds a search field to the opened list, other selects are unchanged */
  search?: SelectSearch<T>;
  value?: T;
  onUpdate: (v: T) => void;
};

/**
 * Select dropdown with options from a dictionary
 */
CategoryButton.Select = <T extends string>(props: SelectProps<T>) => {
  const [_, remote] = splitProps(props, [
    "action",
    "options",
    "search",
    "value",
    "onUpdate",
  ]);

  const [query, setQuery] = createSignal("");
  const [opened, setOpened] = createSignal(false);
  let column: HTMLDivElement | undefined, lastVal: T;
  let summary: HTMLElement | undefined;

  const opts = createMemo(() => Object.keys(props.options) as T[]);

  // options left after applying the search query
  const visible = createMemo(() => {
    const search = props.search;
    const q = query();
    if (!search || !q.trim()) return opts();
    return opts().filter((key) => search.matches(q, key));
  });

  const [value, setValue] = createSignal(undefined as unknown as T);

  //Update if props.value changes, but don't run onUpdate
  createRenderEffect(() => {
    //@ts-expect-error Type check breaks
    setValue((lastVal = props.value ?? opts()[0]));
  });

  //Send user input to onUpdate
  createEffect(() => {
    const val = value();
    if (val !== lastVal) props.onUpdate((lastVal = val));
  });

  //Toggle the opened state and scroll to the beginning of contents
  const toggleOpened = () => {
    const open = !opened();
    if (open && column && column.scrollHeight > MAX_HEIGHT)
      column.children[opts().indexOf(value())]?.scrollIntoView();
    setQuery("");
    setOpened(open);
  };

  //Recalculate the column height for transition
  const updatedHeight = createMemo(() => {
    const height = opened()
      ? Math.min(column?.scrollHeight || 0, MAX_HEIGHT)
      : 0;
    return `${height}px`;
  });

  // a searchable list fits its results (capped), so it can't use the measured height
  const columnStyle = (): JSX.CSSProperties =>
    props.search
      ? opened()
        ? {
            height: "auto",
            "min-height": "min(8rem, 50vh)",
            "max-height": `min(${MAX_HEIGHT}px, 50vh)`,
          }
        : { height: "0px" }
      : { height: updatedHeight() };

  // close the list and put focus back on the select's button
  const closeAndRestoreFocus = () => {
    setQuery("");
    setOpened(false);
    summary?.focus();
  };

  // the option buttons currently in the list
  const optionElements = () =>
    Array.from(column?.querySelectorAll<HTMLElement>(":scope > a") ?? []);

  // move focus to an option button (they aren't tabbable by default)
  const focusOption = (el: HTMLElement | undefined) => {
    if (!el) return;
    el.tabIndex = -1;
    el.focus();
  };

  return (
    <Details
      onClick={toggleOpened}
      class={opened() ? "open" : undefined}
      onKeyDown={(e: KeyboardEvent) => {
        if (!props.search || !opened()) return;

        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeAndRestoreFocus();
          return;
        }

        const target = e.target as HTMLElement;
        const options = optionElements();
        const index = options.indexOf(target);
        if (index === -1) return;

        // arrow keys walk the options, Enter/Space pick the focused one
        if (e.key === "ArrowDown") {
          e.preventDefault();
          focusOption(options[index + 1]);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          if (index === 0) {
            column?.parentElement
              ?.querySelector<HTMLElement>("mdui-text-field")
              ?.focus();
          } else focusOption(options[index - 1]);
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          target.click();
        }
      }}
    >
      <summary ref={summary} tabIndex={props.search ? -1 : undefined}>
        <CategoryButton
          {...remote}
          description={(() => {
            const opt = props.options[value()];
            if (opt) return opt.shortDesc ?? opt.description ?? opt.title;
          })()}
          action={[props.action, "collapse"].flat()}
          onClick={() => void 0}
        >
          {props.title}
        </CategoryButton>
      </summary>
      <Show when={props.search && opened()}>
        {/* clicks inside the field must not toggle the select */}
        <div
          class={searchBox()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              // jump from the field to the first visible option
              e.preventDefault();
              focusOption(optionElements()[0]);
            } else if (e.key === "Enter" && visible().length === 1) {
              // a single result left: pick it
              e.preventDefault();
              setValue(() => visible()[0]);
              closeAndRestoreFocus();
            }
          }}
        >
          <TextField
            variant="outlined"
            type="search"
            enterkeyhint="search"
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
            clearable
            label={props.search!.label}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            ref={(el: HTMLInputElement) => {
              // mdui doesn't pass aria-label on to its inner input, so set it there
              const labelInner = () =>
                (el as unknown as { shadowRoot: ShadowRoot | null }).shadowRoot
                  ?.querySelector("input")
                  ?.setAttribute("aria-label", props.search?.label ?? "");
              void (
                el as unknown as { updateComplete?: Promise<unknown> }
              ).updateComplete?.then(labelInner);
              createEffect(labelInner);
              // don't pop up the on-screen keyboard on touch devices
              if (!window.matchMedia("(pointer: coarse)").matches)
                setTimeout(() => el.focus());
            }}
          />
          <span role="status" aria-live="polite" class={visuallyHidden()}>
            {/* only announce once the user typed, not when the list opens */}
            <Show when={query().trim()}>
              {props.search!.resultsLabel(visible().length)}
            </Show>
          </span>
        </div>
      </Show>
      <div
        ref={column!}
        style={columnStyle()}
        use:scrollable={{ class: innerColumn() }}
      >
        <Show when={props.search && visible().length === 0}>
          {/* clicks in the empty state must not close the list */}
          <EmptyResults onClick={(e: MouseEvent) => e.stopPropagation()}>
            <strong>{props.search!.emptyTitle}</strong>
            <span>{props.search!.emptyBody}</span>
          </EmptyResults>
        </Show>
        <For each={visible()}>
          {(val) => (
            <CategoryButton
              icon="blank"
              variant={value() === val ? "tertiaryAlt" : "tertiary"}
              action={<Radio2.Option checked={value() === val} />}
              //@ts-expect-error Type check breaks
              onClick={() => setValue(val)}
              {...props.options[val]}
            >
              {props.options[val].title ?? props.options[val].shortDesc}
            </CategoryButton>
          )}
        </For>
      </div>
    </Details>
  );
};

/**
 * Spacing around the search field of a select
 */
const searchBox = cva({
  base: { paddingBlockEnd: "var(--gap-xs)" },
});

/**
 * Hide an element visually but keep it for screen readers
 */
const visuallyHidden = cva({
  base: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
});

/**
 * Quiet centred message shown when a search finds nothing
 */
const EmptyResults = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: "var(--gap-xs)",
    padding: "var(--gap-lg)",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

/**
 * Column with inner content
 */
const innerColumn = cva({
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-xs)",

    borderRadius: "var(--borderRadius-md)",
    transition: "0.3s",

    scrollbarWidth: "none",
    "&::-webkit-scrollbar": {
      display: "none",
    },
  },
  variants: {
    static: {
      true: {
        overflow: "hidden",
      },
    },
  },
});

/**
 * Parent base component
 */
const Details = styled("div", {
  base: {
    "&:not(.open) .InnerColumn": {
      opacity: 0,
      pointerEvents: "none",
    },

    /* add transition to the icon */
    "& summary div:last-child svg": {
      transition: "0.3s",
    },

    /* rotate chevron when it is open */
    "&.open summary div:last-child svg": {
      transform: "rotate(180deg)",
    },

    /* add additional padding between top button and children when it is open */
    "&.open summary": {
      marginBottom: "var(--gap-xs)",
    },

    /* hide the default details component marker */
    "& summary": {
      transition: "0.3s",
      listStyle: "none",
    },

    "& summary::marker, summary::-webkit-details-marker": {
      display: "none",
    },

    /* connect elements vertically */
    // "& > :not(summary) .CategoryButton": {
    //   /* and set child backgrounds */
    //   background: "var(--unset-bg)",
    // },
  },
});
