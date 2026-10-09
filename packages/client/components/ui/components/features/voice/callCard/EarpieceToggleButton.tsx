import { Show, createMemo } from "solid-js";
import { useMediaDeviceSelect } from "solid-livekit-components";

import { useLingui } from "@lingui/solid/macro";

import { findEarpiece, useVoice } from "@revolt/rtc";
import { useState } from "@revolt/state";
import { IconButton } from "@revolt/ui/components/design";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

/**
 * iPhone and iPad: toggle between the loudspeaker (the system's normal
 * route, which is also headphones when connected) and the built-in earpiece
 * ("phone call"). iOS ignores the microphone choice, so there is no list.
 * The click handler calls `setAudioOutput` directly, because Safari only
 * lets pages switch the output inside a user gesture. Only shown when an
 * earpiece is found.
 */
export function EarpieceToggleButton(props: { size: "xs" | "sm" }) {
  const voice = useVoice();
  const state = useState();
  const { t } = useLingui();

  const media = createMemo(() => useMediaDeviceSelect({ kind: "audiooutput" }));
  const earpiece = createMemo(() => findEarpiece(media().devices()));
  const phoneCall = () =>
    !!earpiece() &&
    state.voice.preferredAudioOutputDevice === earpiece()!.deviceId;

  return (
    <Show when={earpiece()}>
      <IconButton
        size={props.size}
        variant={phoneCall() ? "filled" : "tonal"}
        aria-label={t`Phone call mode`}
        aria-pressed={phoneCall()}
        onPress={() =>
          voice.setAudioOutput(phoneCall() ? undefined : earpiece()!.deviceId)
        }
        use:floating={{
          tooltip: {
            placement: "top",
            content: phoneCall() ? t`Phone call` : t`Loudspeaker`,
          },
        }}
      >
        <Show when={phoneCall()} fallback={<Symbol>volume_up</Symbol>}>
          <Symbol>phone_in_talk</Symbol>
        </Show>
      </IconButton>
    </Show>
  );
}
