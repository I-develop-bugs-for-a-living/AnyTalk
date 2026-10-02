import { Trans, useLingui } from "@lingui/solid/macro";
import { createFormControl, createFormGroup } from "solid-forms";

import { useState } from "@revolt/state";
import {
  ScreenShareFrameRate,
  ScreenShareFrameRates,
  ScreenShareResolution,
  closestScreenShareResolution,
} from "@revolt/state/stores/Voice";
import { Column, Dialog, DialogProps, Form2 } from "@revolt/ui";
import { VideoTrack } from "solid-livekit-components";

import { Show } from "solid-js";
import { Modals } from "../types";

export function ScreenShareSettingsModal(
  props: DialogProps & Modals & { type: "screen_share_settings" },
) {
  const { voice } = useState();
  const { t } = useLingui();

  const group = createFormGroup({
    resolution: createFormControl<ScreenShareResolution>(
      closestScreenShareResolution(
        voice.screenShareResolution,
        props.resolutions.map((r) => r.value),
      ),
      { required: true },
    ),
    frameRate: createFormControl(String(voice.screenShareFrameRate), {
      required: true,
    }),
    audio: createFormControl(props.audio && voice.screenShareAudio, {
      disabled: !props.audio,
    }),
    dontAsk: createFormControl(false),
  });

  async function onSubmit() {
    const frameRate = Number(
      group.controls.frameRate.value,
    ) as ScreenShareFrameRate;

    // Remember the choice as the default for next time
    voice.screenShareResolution = group.controls.resolution.value;
    voice.screenShareFrameRate = frameRate;

    if (group.controls.dontAsk.value) {
      voice.screenShareQualityAsk = false;
      voice.screenShareAudio = group.controls.audio.value;
    }

    props.callback(
      group.controls.resolution.value,
      frameRate,
      group.controls.audio.value && props.audio,
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
      title={t`Screen Share Settings`}
      actions={[
        { text: <Trans>Cancel</Trans> },
        {
          text: <Trans>Go</Trans>,
          onClick: () => {
            onSubmit();
            return false;
          },
        },
      ]}
    >
      <VideoTrack
        trackRef={props.trackReference}
        style={{
          padding: "var(--gap-md)",
          "border-radius": "var(--borderRadius-lg)",
          "max-height": "400px",
          "justify-self": "center",
        }}
      />
      <form onSubmit={submit}>
        <Column>
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
          <Show when={props.audio}>
            <Form2.Checkbox control={group.controls.audio}>
              <Trans>Share audio</Trans>
            </Form2.Checkbox>
          </Show>
          <Form2.Checkbox control={group.controls.dontAsk}>
            <Trans>Don't ask me again</Trans>
          </Form2.Checkbox>
          <Show when={!props.audio}>
            <small>
              <Trans>Audio disabled by browser</Trans>
            </small>
          </Show>
        </Column>
      </form>
    </Dialog>
  );
}
