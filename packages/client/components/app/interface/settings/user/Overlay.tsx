import { Show, createSignal } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";

import {
  gameDetectionAvailable,
  overlayCorner,
  overlayEnabled,
  overlayMode,
  overlayStyle,
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
          <Trans>Style</Trans>
        </Text>
        <Radio2
          aria-label={t`Style`}
          value={overlayStyle()}
          onChange={(event) =>
            save({
              overlayStyle: event.currentTarget
                .value as DesktopConfig["overlayStyle"],
            })
          }
        >
          <Radio2.Option value="compact">
            <Trans>Compact: only the avatars</Trans>
          </Radio2.Option>
          <Radio2.Option value="detailed">
            <Trans>
              Detailed: names while someone speaks, and a LIVE tag for streams
            </Trans>
          </Radio2.Option>
        </Radio2>
      </Column>

      <Show when={saveError()}>
        <div role="alert">
          <Text class="label">{saveError()}</Text>
        </div>
      </Show>
    </Column>
  );
}
