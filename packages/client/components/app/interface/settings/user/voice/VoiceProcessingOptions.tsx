import { Trans } from "@lingui/solid/macro";

import { useState } from "@revolt/state";
import {
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
          icon={"blank"}
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
        <CategoryButton
          icon="blank"
          action={<Checkbox checked={voice.echoCancellation} />}
          onClick={() => (voice.echoCancellation = !voice.echoCancellation)}
        >
          <Trans>Browser Echo Cancellation</Trans>
        </CategoryButton>
        <CategoryButton
          icon="blank"
          action={<Checkbox checked={voice.autoGainControl} />}
          onClick={() => (voice.autoGainControl = !voice.autoGainControl)}
        >
          <Trans>Automatic Gain Control</Trans>
        </CategoryButton>
      </CategoryButton.Group>
    </Column>
  );
}
