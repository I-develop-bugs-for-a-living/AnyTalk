import { For, Show, createEffect, createSignal, on } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import {
  BANNER_HUE_PRESETS,
  Slider,
  Text,
  emptyBannerColour,
  supportsRelativeColour,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

interface Props {
  /** Id of the user, used for the automatic colour */
  userId: string;

  /** Chosen hue (0-359), or null for the automatic colour */
  value: number | null;

  /** Called when the user picks another colour */
  onChange: (hue: number | null) => void;
}

/** Hue the custom slider starts at when switching to a custom colour */
const DEFAULT_CUSTOM_HUE = 210;

/**
 * Stops for the rainbow slider track, one every 40 degrees up to 360
 */
const RAINBOW_HUES = [0, 40, 80, 120, 160, 200, 240, 280, 320, 359];

/**
 * Choose the colour of a profile banner without an image: automatic, one of
 * the presets, or a custom hue. A radiogroup with arrow-key navigation, every
 * colour is drawn the way the banner will look in the current theme.
 */
export function BannerColourField(props: Props) {
  const { t } = useLingui();

  const presets = () => [
    { hue: BANNER_HUE_PRESETS.red, name: t`Red` },
    { hue: BANNER_HUE_PRESETS.green, name: t`Green` },
    { hue: BANNER_HUE_PRESETS.teal, name: t`Teal` },
    { hue: BANNER_HUE_PRESETS.cyan, name: t`Cyan` },
    { hue: BANNER_HUE_PRESETS.blue, name: t`Blue` },
    { hue: BANNER_HUE_PRESETS.violet, name: t`Violet` },
    { hue: BANNER_HUE_PRESETS.magenta, name: t`Magenta` },
    { hue: BANNER_HUE_PRESETS.pink, name: t`Pink` },
  ];

  /** Whether the Custom button was pressed (keeps the slider open) */
  const [customOpen, setCustomOpen] = createSignal(false);

  /** True while a change that this field made itself is being applied */
  let ownChange = false;

  /** Report a pick to the parent, remembering that the change is ours */
  function change(hue: number | null) {
    ownChange = hue !== props.value;
    props.onChange(hue);
  }

  // Value changed from outside (reset, save, profile loaded): drop the
  // pressed-Custom state so the field shows what is really stored.
  createEffect(
    on(
      () => props.value,
      () => {
        if (!ownChange) setCustomOpen(false);
        ownChange = false;
      },
      { defer: true },
    ),
  );

  /** Whether the current value is a preset */
  const isPreset = () =>
    props.value !== null &&
    (Object.values(BANNER_HUE_PRESETS) as number[]).includes(props.value);

  /** Custom is selected when a non-preset hue is set or Custom was pressed */
  const isCustom = () => props.value !== null && (!isPreset() || customOpen());

  /** Radio elements in visual order: Automatic, presets, Custom */
  const items: HTMLButtonElement[] = [];

  /**
   * Select the item at an index and report the new hue to the parent.
   * @param index 0 = automatic, 1..n = presets, n + 1 = custom
   */
  function select(index: number) {
    const list = presets();

    if (index === 0) {
      setCustomOpen(false);
      change(null);
    } else if (index <= list.length) {
      setCustomOpen(false);
      change(list[index - 1].hue);
    } else {
      setCustomOpen(true);
      change(props.value ?? DEFAULT_CUSTOM_HUE);
    }
  }

  /** Index of the selected item */
  const selectedIndex = () =>
    props.value === null
      ? 0
      : isCustom()
        ? presets().length + 1
        : presets().findIndex((preset) => preset.hue === props.value) + 1;

  /**
   * Arrow keys, Home and End move the selection like a native radio group
   * (flipped in right-to-left, wrapping at both ends).
   * @param event Key event from the radiogroup
   */
  function onKeyDown(event: KeyboardEvent) {
    const last = presets().length + 1;
    const rtl =
      getComputedStyle(event.currentTarget as Element).direction === "rtl";
    let next: number | undefined;

    switch (event.key) {
      case "ArrowRight":
        next = selectedIndex() + (rtl ? -1 : 1);
        break;
      case "ArrowDown":
        next = selectedIndex() + 1;
        break;
      case "ArrowLeft":
        next = selectedIndex() + (rtl ? 1 : -1);
        break;
      case "ArrowUp":
        next = selectedIndex() - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
    }

    if (next === undefined) return;
    event.preventDefault();

    // wrap around at both ends
    next = (next + last + 1) % (last + 1);
    select(next);
    items[next]?.focus();
  }

  /** Gradient across all hues, in the colours the banner would use */
  const rainbow = (direction: "right" | "left") =>
    `linear-gradient(to ${direction}, ${RAINBOW_HUES.map((hue) => emptyBannerColour(props.userId, hue)).join(", ")})`;

  // without relative colours the banner can not show a chosen hue
  return (
    <Show when={supportsRelativeColour()}>
      <Field>
        <Text class="label">
          <Trans>Banner colour</Trans>
        </Text>
        <Options
          role="radiogroup"
          aria-label={t`Banner colour`}
          onKeyDown={onKeyDown}
        >
          <Chip
            type="button"
            role="radio"
            aria-checked={props.value === null}
            tabIndex={selectedIndex() === 0 ? 0 : -1}
            ref={(el) => (items[0] = el)}
            onClick={() => select(0)}
          >
            <Show when={props.value === null}>
              <Symbol size={18}>check</Symbol>
            </Show>
            <Trans>Automatic</Trans>
          </Chip>

          <For each={presets()}>
            {(preset, index) => (
              <Swatch
                type="button"
                role="radio"
                aria-checked={props.value === preset.hue && !isCustom()}
                aria-label={preset.name}
                title={preset.name}
                tabIndex={selectedIndex() === index() + 1 ? 0 : -1}
                ref={(el) => (items[index() + 1] = el)}
                style={{
                  background: emptyBannerColour(props.userId, preset.hue),
                }}
                onClick={() => select(index() + 1)}
              >
                <Show when={props.value === preset.hue && !isCustom()}>
                  <Symbol size={20}>check</Symbol>
                </Show>
              </Swatch>
            )}
          </For>

          <Chip
            type="button"
            role="radio"
            aria-checked={isCustom()}
            tabIndex={selectedIndex() === presets().length + 1 ? 0 : -1}
            ref={(el) => (items[presets().length + 1] = el)}
            onClick={() => select(presets().length + 1)}
          >
            <Symbol size={18}>{isCustom() ? "check" : "add"}</Symbol>
            <Trans>Custom</Trans>
          </Chip>
        </Options>

        <Show when={isCustom() && props.value !== null}>
          <CustomRow>
            <Preview
              aria-hidden="true"
              style={{
                background: emptyBannerColour(props.userId, props.value),
              }}
            />
            <SliderBox
              style={{
                "--banner-rainbow": rainbow("right"),
                "--banner-rainbow-rtl": rainbow("left"),
              }}
            >
              <Slider
                min={0}
                max={359}
                step={1}
                value={props.value ?? DEFAULT_CUSTOM_HUE}
                aria-label={t`Banner hue`}
                onInput={(event) => change(event.currentTarget.value)}
              />
            </SliderBox>
          </CustomRow>
        </Show>
      </Field>
    </Show>
  );
}

const Field = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
});

const Options = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
  },
});

const Chip = styled("button", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",

    minHeight: "44px",
    paddingInline: "16px",

    cursor: "pointer",
    borderRadius: "var(--borderRadius-full)",
    border: "1px solid var(--md-sys-color-outline)",
    background: "transparent",
    color: "var(--md-sys-color-on-surface-variant)",
    fontSize: "14px",
    fontWeight: 500,

    transition: "var(--transitions-fast)",

    '&[aria-checked="true"]': {
      border: "1px solid transparent",
      background: "var(--md-sys-color-secondary-container)",
      color: "var(--md-sys-color-on-secondary-container)",
    },

    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "2px",
    },
  },
});

const Swatch = styled("button", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",

    width: "44px",
    height: "44px",
    flexShrink: 0,

    cursor: "pointer",
    borderRadius: "var(--borderRadius-circle)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    color: "var(--md-sys-color-on-primary-container)",

    '&[aria-checked="true"]': {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "2px",
    },

    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "2px",
    },
  },
});

const CustomRow = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },
});

const Preview = styled("div", {
  base: {
    width: "64px",
    height: "44px",
    flexShrink: 0,
    borderRadius: "var(--borderRadius-md)",
    border: "1px solid var(--md-sys-color-outline-variant)",
  },
});

const SliderBox = styled("div", {
  base: {
    flexGrow: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",

    // Rainbow track: the inactive track carries the gradient, the active
    // part is see-through so the whole range stays visible.
    "& mdui-slider": {
      width: "100%",
    },
    "& mdui-slider::part(track-inactive)": {
      background: "var(--banner-rainbow)",
    },
    // explicit selector: `_rtl` expands to a list that is invalid after `::part()`
    "[dir=rtl] &": {
      "& mdui-slider::part(track-inactive)": {
        background: "var(--banner-rainbow-rtl)",
      },
    },
    "& mdui-slider::part(track-active)": {
      background: "transparent",
    },
  },
});
