import { Trans } from "@lingui/solid/macro";
import { Show } from "solid-js";

import { useState } from "@revolt/state";
import {
  HighpassFrequency,
  NoiseSuppresionState,
  enhancedNoiseSuppressionSupported,
} from "@revolt/state/stores/Voice";
import {
  CategoryButton,
  CategorySelectOption,
  Checkbox,
  Column,
  Text,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

/**
 * Voice processing options
 */
export function VoiceProcessingOptions() {
  const { voice } = useState();

  return (
    <Column>
      <Text class="title">
        <Trans>Voice Processing</Trans>
      </Text>
      <CategoryButton.Group>
        <CategoryButton.Select
          icon={<Symbol>noise_aware</Symbol>}
          title={<Trans>Select noise suppression</Trans>}
          options={
            {
              disabled: { title: <Trans>Disabled</Trans> },
              browser: { title: <Trans>Browser</Trans> },
              // not offered on iOS, see enhancedNoiseSuppressionSupported
              ...(enhancedNoiseSuppressionSupported && {
                enhanced: {
                  title: <Trans>Enhanced</Trans>,
                  description: <Trans>Powered by RNNoise</Trans>,
                  shortDesc: <Trans>Enhanced (RNNoise)</Trans>,
                },
              }),
            } as Record<NoiseSuppresionState, CategorySelectOption>
          }
          value={voice.noiseSupression}
          onUpdate={(ns) => (voice.noiseSupression = ns)}
        />
        <Show when={voice.noiseSupression === "enhanced"}>
          <CategoryButton
            icon={<Symbol>mic_off</Symbol>}
            action={<Checkbox checked={voice.speechGate} />}
            onClick={() => (voice.speechGate = !voice.speechGate)}
            description={
              <Trans>
                Silences your microphone while you aren't talking, so knocks and
                background noise between sentences aren't heard.
              </Trans>
            }
          >
            <Trans>Mute when not speaking</Trans>
          </CategoryButton>
        </Show>
        <CategoryButton.Select
          icon={<Symbol>graphic_eq</Symbol>}
          title={<Trans>Low-cut filter</Trans>}
          options={
            {
              0: { title: <Trans>Off</Trans> },
              60: {
                title: <Trans>Light (60 Hz)</Trans>,
                shortDesc: <Trans>Light (60 Hz)</Trans>,
                description: <Trans>Removes deep rumble</Trans>,
              },
              90: {
                title: <Trans>Medium (90 Hz)</Trans>,
                shortDesc: <Trans>Medium (90 Hz)</Trans>,
                description: (
                  <Trans>Removes knocks on the desk or microphone</Trans>
                ),
              },
              150: {
                title: <Trans>Strong (150 Hz)</Trans>,
                shortDesc: <Trans>Strong (150 Hz)</Trans>,
                description: <Trans>Also thins out deep voices</Trans>,
              },
            } satisfies Record<HighpassFrequency, CategorySelectOption>
          }
          value={String(voice.highpassFrequency) as `${HighpassFrequency}`}
          onUpdate={(frequency) =>
            (voice.highpassFrequency = Number(frequency) as HighpassFrequency)
          }
        />
        <CategoryButton
          icon={<Symbol>spatial_audio_off</Symbol>}
          action={<Checkbox checked={voice.echoCancellation} />}
          onClick={() => (voice.echoCancellation = !voice.echoCancellation)}
        >
          <Trans>Browser Echo Cancellation</Trans>
        </CategoryButton>
        <CategoryButton
          icon={<Symbol>tune</Symbol>}
          action={<Checkbox checked={voice.autoGainControl} />}
          onClick={() => (voice.autoGainControl = !voice.autoGainControl)}
        >
          <Trans>Automatic Gain Control</Trans>
        </CategoryButton>
      </CategoryButton.Group>
    </Column>
  );
}
