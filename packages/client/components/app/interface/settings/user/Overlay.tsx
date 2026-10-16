import { For, Show, createSignal } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";

import {
  type OverlayVisibility,
  COMPACT_ELEMENTS,
  DETAILED_ELEMENTS,
  gameDetectionAvailable,
  overlayAvatar,
  overlayCorner,
  overlayEnabled,
  overlayLive,
  overlayMode,
  overlayName,
  overlayPreset,
  overlayStatus,
  overlayWatching,
  saveOverlaySettings,
} from "@revolt/rtc";
import { CategoryButton, Checkbox, Column, Radio2, Text } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

/**
 * Settings of the in-game voice overlay (desktop app only)
 */
export default function Overlay() {
  const { t } = useLingui();

  /** Problem saving a setting, shown under the options */
  const [saveError, setSaveError] = createSignal<string>();

  /**
   * Save settings in the desktop shell and show a message if that fails
   * @param partial Settings to change
   */
  async function save(partial: Parameters<typeof saveOverlaySettings>[0]) {
    const ok = await saveOverlaySettings(partial);
    setSaveError(ok ? undefined : t`Could not save this setting.`);
  }

  /** The elements with their own visibility setting, in overlay order */
  const elements = () => [
    {
      key: "overlayAvatar" as const,
      title: t`Avatar`,
      value: overlayAvatar,
    },
    { key: "overlayName" as const, title: t`Name`, value: overlayName },
    {
      key: "overlayLive" as const,
      title: t`LIVE indicator`,
      value: overlayLive,
    },
    {
      key: "overlayStatus" as const,
      title: t`Mute and deafen`,
      value: overlayStatus,
    },
    {
      key: "overlayWatching" as const,
      title: t`Stream viewers`,
      value: overlayWatching,
      hint: t`Needs a server that supports stream viewers.`,
    },
  ];

  return (
    <Column gap="lg">
      <Text class="label">
        <Trans>
          Shows who is talking in your call on top of your game. It works over
          borderless and windowed games, not over exclusive fullscreen.
        </Trans>
      </Text>

      <CategoryButton.Group>
        <CategoryButton
          action={<Checkbox checked={overlayEnabled()} />}
          onClick={() => save({ overlayEnabled: !overlayEnabled() })}
          icon={<Symbol>picture_in_picture</Symbol>}
          description={
            <Trans>
              You can also switch it on and off with the Toggle overlay hotkey
              in Hotkeys.
            </Trans>
          }
        >
          <Trans>Show overlay</Trans>
        </CategoryButton>
      </CategoryButton.Group>

      <Column>
        <Text class="title">
          <Trans>Position</Trans>
        </Text>
        <Radio2
          aria-label={t`Position`}
          value={overlayCorner()}
          onChange={(event) =>
            save({
              overlayCorner: event.currentTarget
                .value as DesktopConfig["overlayCorner"],
            })
          }
        >
          <Radio2.Option value="top-left">
            <Trans>Top left</Trans>
          </Radio2.Option>
          <Radio2.Option value="top-right">
            <Trans>Top right</Trans>
          </Radio2.Option>
          <Radio2.Option value="bottom-left">
            <Trans>Bottom left</Trans>
          </Radio2.Option>
          <Radio2.Option value="bottom-right">
            <Trans>Bottom right</Trans>
          </Radio2.Option>
        </Radio2>
        <Show when={window.native?.isWayland?.()}>
          <Text class="label">
            <Trans>
              On Wayland your desktop decides where windows go, so the overlay
              may not stay on top of games or in the chosen corner.
            </Trans>
          </Text>
        </Show>
      </Column>

      <Column>
        <Text class="title">
          <Trans>When to show</Trans>
        </Text>
        <Radio2
          aria-label={t`When to show`}
          value={overlayMode()}
          onChange={(event) =>
            save({
              overlayMode: event.currentTarget
                .value as DesktopConfig["overlayMode"],
            })
          }
        >
          <Radio2.Option value="always">
            <Trans>Whenever I'm in a call</Trans>
          </Radio2.Option>
          <Radio2.Option value="games">
            <Trans>Only while a detected game is running</Trans>
          </Radio2.Option>
        </Radio2>
        <div role="status">
          <Show when={overlayMode() === "games" && !gameDetectionAvailable()}>
            <Text class="label">
              <Trans>
                This option needs game detection. Turn on "Detect running games"
                in the Desktop settings.
              </Trans>
            </Text>
          </Show>
        </div>
      </Column>

      <Column>
        <Text class="title">
          <Trans>Preset</Trans>
        </Text>
        <Radio2
          aria-label={t`Preset`}
          value={overlayPreset()}
          onChange={(event) => {
            // Custom is only a state, picking a preset writes all five keys
            const value = event.currentTarget.value;
            if (value === "compact") save({ ...COMPACT_ELEMENTS });
            else if (value === "detailed") save({ ...DETAILED_ELEMENTS });
          }}
        >
          <Radio2.Option value="compact">
            <Trans>Compact</Trans>
          </Radio2.Option>
          <Radio2.Option value="detailed">
            <Trans>Detailed</Trans>
          </Radio2.Option>
          <Show when={overlayPreset() === "custom"}>
            <Radio2.Option value="custom">
              <Trans>Custom</Trans>
            </Radio2.Option>
          </Show>
        </Radio2>
      </Column>

      <For each={elements()}>
        {(element) => (
          <Column>
            <Text class="title">{element.title}</Text>
            <Radio2
              aria-label={element.title}
              aria-describedby={
                element.hint ? `${element.key}-hint` : undefined
              }
              value={element.value()}
              onChange={(event) =>
                save({
                  [element.key]: event.currentTarget.value as OverlayVisibility,
                })
              }
            >
              <Radio2.Option value="always">
                <Trans>Always show</Trans>
              </Radio2.Option>
              <Radio2.Option value="speaking">
                <Trans>Show when speaking</Trans>
              </Radio2.Option>
              <Radio2.Option value="off">
                <Trans>Off</Trans>
              </Radio2.Option>
            </Radio2>
            <Show when={element.hint}>
              <div id={`${element.key}-hint`}>
                <Text class="label">{element.hint}</Text>
              </div>
            </Show>
          </Column>
        )}
      </For>

      <Show when={saveError()}>
        <div role="alert">
          <Text class="label">{saveError()}</Text>
        </div>
      </Show>
    </Column>
  );
}
