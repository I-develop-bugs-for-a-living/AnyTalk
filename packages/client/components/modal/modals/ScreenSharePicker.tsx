import { Trans, useLingui } from "@lingui/solid/macro";
import { createFormControl, createFormGroup } from "solid-forms";

import { useState } from "@revolt/state";
import {
  ScreenShareFrameRate,
  ScreenShareFrameRates,
  ScreenShareResolution,
  closestScreenShareResolution,
} from "@revolt/state/stores/Voice";
import {
  Avatar,
  Column,
  Dialog,
  DialogProps,
  Form2,
  Ripple,
  Text,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { styled } from "styled-system/jsx";
import { Modals } from "../types";
import { PickerSourceItem, mergeSources } from "./screenSharePickerSources";

/** How often the source list is re-read while the picker is open */
const REFRESH_INTERVAL_MS = 1500;

/** Every n-th refresh also re-reads the thumbnails, they are expensive */
const THUMBNAIL_EVERY = 4;

export function ScreenSharePickerModal(
  props: DialogProps & Modals & { type: "screen_share_picker" },
) {
  const { voice } = useState();
  const { t } = useLingui();

  // Live list of sources, kept current while the picker is open
  const [list, setList] = createSignal(props.sources);

  onMount(() => {
    const refresh = window.native?.refreshScreenPicker;
    if (!refresh) return;

    let inFlight = false;
    let stopped = false;
    let polls = 0;

    let queued: { thumbnails: boolean } | undefined;

    /**
     * Fetch the sources again. A request made while a fetch is running is
     * remembered and runs once after it, so it is never dropped.
     */
    const poll = async (thumbnails = false) => {
      if (stopped) return;
      if (inFlight) {
        queued = { thumbnails: thumbnails || !!queued?.thumbnails };
        return;
      }
      inFlight = true;
      try {
        const withThumbnails = thumbnails || polls++ % THUMBNAIL_EVERY === 0;
        const next = await refresh(withThumbnails);
        if (next && !stopped)
          setList((prev) => mergeSources(prev, next, withThumbnails));
      } finally {
        inFlight = false;
      }
      if (queued) {
        const again = queued.thumbnails;
        queued = undefined;
        poll(again);
      }
    };

    // Returning from another window (e.g. the game) must show it at once
    const onVisible = () => {
      if (document.visibilityState === "visible") poll(true);
    };
    const onFocus = () => poll(true);

    const timer = setInterval(() => {
      // Nothing to see while hidden, the visibility handler catches up
      if (!document.hidden) poll();
    }, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    onCleanup(() => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    });
  });

  // Open on the screens, or on the apps when there is no screen to share
  const hasScreens = list().some((source) => source.isFullScreen);

  const group = createFormGroup({
    category: createFormControl(hasScreens ? "screens" : "apps"),
    resolution: createFormControl<ScreenShareResolution>(
      closestScreenShareResolution(
        voice.screenShareResolution,
        props.resolutions.map((r) => r.value),
      ),
    ),
    frameRate: createFormControl(String(voice.screenShareFrameRate)),
    audio: createFormControl(voice.screenShareAudio),
    idx: createFormControl<number[]>([], { required: true }),
  });

  /** Sources of the selected category, keeping their index in the full list */
  const wrappers = new WeakMap<
    object,
    { item: PickerSourceItem; value: number }
  >();
  const sources = createMemo(() =>
    list()
      .filter(
        (source) =>
          source.isFullScreen === (group.controls.category.value === "screens"),
      )
      .map((source) => {
        // Reuse the wrapper of an unchanged source so its tile isn't rebuilt
        let wrapper = wrappers.get(source);
        if (!wrapper) {
          wrapper = { item: source, value: source.idx };
          wrappers.set(source, wrapper);
        }
        return wrapper;
      }),
  );

  // Keep the selected source while it still exists in the category, else
  // select the first one, or none when it is empty, so a hidden source can
  // never be submitted
  createEffect(
    on(sources, (items) => {
      const current = group.controls.idx.value[0];
      if (items.some((s) => s.value === current)) return;
      group.controls.idx.setValue(items.slice(0, 1).map((s) => s.value));
    }),
  );

  /** Whether a source of the visible category is selected */
  const canSubmit = createMemo(() =>
    sources().some((source) => source.value === group.controls.idx.value[0]),
  );

  async function onSubmit() {
    if (!canSubmit()) return;

    const frameRate = Number(
      group.controls.frameRate.value,
    ) as ScreenShareFrameRate;

    // Remember the choice as the default for next time
    voice.screenShareResolution = group.controls.resolution.value;
    voice.screenShareFrameRate = frameRate;

    props.callback(
      group.controls.idx.value[0],
      group.controls.resolution.value,
      frameRate,
      group.controls.audio.value,
    );
    props.onClose();
  }

  const submit = Form2.useSubmitHandler(group, onSubmit);

  return (
    <Dialog
      minWidth={420}
      show={props.show}
      onClose={() => {
        props.onCancel();
        props.onClose();
      }}
      title={t`Pick a Screen to Share`}
      actions={[
        { text: <Trans>Cancel</Trans> },
        {
          text: <Trans>Go</Trans>,
          isDisabled: !canSubmit(),
          onClick: () => {
            onSubmit();
            return false;
          },
        },
      ]}
    >
      <form onSubmit={submit}>
        <Column>
          <div role="group" aria-label={t`Source type`}>
            <Form2.ButtonGroup
              control={group.controls.category}
              buttonDefinitions={[
                { children: <Trans>Entire screen</Trans>, value: "screens" },
                { children: <Trans>Apps</Trans>, value: "apps" },
              ]}
            />
          </div>
          <Show
            when={sources().length > 0}
            fallback={
              <Empty role="status">
                <Symbol size={48}>
                  {group.controls.category.value === "screens"
                    ? "desktop_windows"
                    : "web_asset"}
                </Symbol>
                <Text size="medium">
                  {group.controls.category.value === "screens" ? (
                    <Trans>No screens found</Trans>
                  ) : (
                    <Trans>No apps found</Trans>
                  )}
                </Text>
                <Text size="medium">
                  {group.controls.category.value === "screens" ? (
                    <Trans>Switch to Apps to share a single window.</Trans>
                  ) : (
                    <Trans>Open an app or switch to Entire screen.</Trans>
                  )}
                </Text>
              </Empty>
            }
          >
            <Form2.VirtualSelect
              control={group.controls.idx}
              items={sources()}
              selectHeight="max(30vh, 200px)"
              isMaxHeight={true}
              itemHeight={60}
            >
              {(val, selected) => (
                <Item selected={selected}>
                  <Ripple />
                  <Avatar
                    src={val.image}
                    fallback={val.name}
                    size={36}
                    shape="rounded-square"
                  />
                  <span>{val.name}</span>
                </Item>
              )}
            </Form2.VirtualSelect>
          </Show>
          <Form2.ButtonGroup
            control={group.controls.resolution}
            buttonDefinitions={props.resolutions.map((resolution) => ({
              children: resolution.label,
              value: resolution.value,
            }))}
          />
          <Form2.ButtonGroup
            control={group.controls.frameRate}
            buttonDefinitions={ScreenShareFrameRates.map((frameRate) => ({
              children: `${frameRate} FPS`,
              value: String(frameRate),
            }))}
          />
          <Form2.Checkbox control={group.controls.audio}>
            <Trans>Share audio</Trans>
          </Form2.Checkbox>
        </Column>
      </form>
    </Dialog>
  );
}

/** Placeholder shown when the selected category has no sources */
const Empty = styled("div", {
  base: {
    height: "max(30vh, 200px)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    textAlign: "center",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const Item = styled("div", {
  base: {
    height: "60px",
    display: "flex",
    position: "relative",
    alignItems: "center",
    gap: "var(--gap-md)",
    padding: "var(--gap-md)",
    borderRadius: "var(--borderRadius-sm)",
  },
  variants: {
    selected: {
      true: {
        color: "var(--md-sys-color-on-primary)",
        background: "var(--md-sys-color-primary)",
      },
    },
  },
});
