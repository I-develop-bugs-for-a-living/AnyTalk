import { Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";

import { useVoice } from "@revolt/rtc";
import { Button, IconButton } from "@revolt/ui/components/design";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

/**
 * Button that mutes or unmutes the microphone, shared by the call card and
 * the voice status footer
 */
export function MuteButton(props: { size: "xs" | "sm" }) {
  const voice = useVoice();
  const { t } = useLingui();

  // permissions only matter in a call, outside one the saved choice changes
  const allowed = () => !voice.channel() || voice.speakingPermission;

  const label = () =>
    allowed()
      ? voice.microphone()
        ? t`Mute`
        : t`Unmute`
      : t`Missing permission`;

  return (
    <IconButton
      size={props.size}
      variant={voice.microphone() ? "filled" : "tonal"}
      onPress={() => voice.toggleMute()}
      aria-label={label()}
      use:floating={{
        tooltip: {
          placement: "top",
          content: label(),
        },
      }}
      isDisabled={!allowed()}
    >
      <Show when={voice.microphone()} fallback={<Symbol>mic_off</Symbol>}>
        <Symbol>mic</Symbol>
      </Show>
    </IconButton>
  );
}

/**
 * Button that deafens or undeafens, shared by the call card and the voice
 * status footer
 */
export function DeafenButton(props: { size: "xs" | "sm" }) {
  const voice = useVoice();
  const { t } = useLingui();

  // permissions only matter in a call, outside one the saved choice changes
  const allowed = () => !voice.channel() || voice.listenPermission;

  const label = () =>
    allowed()
      ? voice.deafen()
        ? t`Undeafen`
        : t`Deafen`
      : t`Missing permission`;

  return (
    <IconButton
      size={props.size}
      variant={voice.deafen() || !allowed() ? "tonal" : "filled"}
      onPress={() => voice.toggleDeafen()}
      aria-label={label()}
      use:floating={{
        tooltip: {
          placement: "top",
          content: label(),
        },
      }}
      isDisabled={!allowed()}
    >
      <Show
        when={voice.deafen() || !allowed()}
        fallback={<Symbol>headset</Symbol>}
      >
        <Symbol>headset_off</Symbol>
      </Show>
    </IconButton>
  );
}

/**
 * Button that leaves the call, shared by the call card and the voice status
 * footer
 */
export function LeaveCallButton(props: { size: "xs" | "sm" }) {
  const voice = useVoice();
  const { t } = useLingui();

  return (
    <Button
      size={props.size}
      variant="_error"
      onPress={() => voice.disconnect()}
      aria-label={t`End call`}
      use:floating={{
        tooltip: {
          placement: "top",
          content: t`End call`,
        },
      }}
    >
      <Symbol>call_end</Symbol>
    </Button>
  );
}
