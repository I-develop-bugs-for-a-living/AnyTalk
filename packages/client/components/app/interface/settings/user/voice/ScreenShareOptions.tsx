import { Trans } from "@lingui/solid/macro";

import { useVoice } from "@revolt/rtc";
import { SCREEN_SHARE_RESOLUTION_LABELS } from "@revolt/rtc/state";
import { useState } from "@revolt/state";
import {
  ScreenShareFrameRate,
  ScreenShareFrameRates,
  ScreenShareResolution,
  closestScreenShareResolution,
} from "@revolt/state/stores/Voice";
import {
  CategoryButton,
  CategorySelectOption,
  Checkbox,
  Column,
  Text,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

export function ScreenShareOptions() {
  const { voice } = useState();
  const voiceContext = useVoice();

  const resolutions = voiceContext.getEnabledScreenShareResolutions();

  return (
    <Column>
      <Text class="title">
        <Trans>Screen Share Settings</Trans>
      </Text>
      <CategoryButton.Group>
        <CategoryButton.Select
          icon={<Symbol>screen_share</Symbol>}
          title={<Trans>Screen share resolution</Trans>}
          options={
            Object.fromEntries(
              resolutions.map((resolution) => [
                resolution,
                { title: SCREEN_SHARE_RESOLUTION_LABELS[resolution] },
              ]),
            ) as { [key in ScreenShareResolution]: CategorySelectOption }
          }
          value={closestScreenShareResolution(
            voice.screenShareResolution,
            resolutions,
          )}
          onUpdate={(resolution) => (voice.screenShareResolution = resolution)}
        />
        <CategoryButton.Select
          icon={<Symbol>speed</Symbol>}
          title={<Trans>Screen share frame rate</Trans>}
          options={
            Object.fromEntries(
              ScreenShareFrameRates.map((frameRate) => [
                String(frameRate),
                { title: `${frameRate} FPS` },
              ]),
            ) as Record<string, CategorySelectOption>
          }
          value={String(voice.screenShareFrameRate)}
          onUpdate={(frameRate) =>
            (voice.screenShareFrameRate = Number(
              frameRate,
            ) as ScreenShareFrameRate)
          }
        />
        <CategoryButton
          icon={<Symbol>high_quality</Symbol>}
          action={<Checkbox checked={voice.screenShareQualityAsk} />}
          onClick={() =>
            (voice.screenShareQualityAsk = !voice.screenShareQualityAsk)
          }
        >
          <Trans>Always Ask for Screen Share Quality</Trans>
        </CategoryButton>
        <CategoryButton
          icon={<Symbol>grid_view</Symbol>}
          action={<Checkbox checked={voice.multiStream} />}
          onClick={() => voiceContext.setMultiStream(!voice.multiStream)}
          description={
            <Trans>
              Opening another stream while watching one shows them side by side.
              When off, it replaces the stream you were watching.
            </Trans>
          }
        >
          <Trans>Watch multiple streams at once</Trans>
        </CategoryButton>
      </CategoryButton.Group>
    </Column>
  );
}
