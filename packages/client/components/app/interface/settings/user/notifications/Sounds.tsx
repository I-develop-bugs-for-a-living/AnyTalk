import { Trans, useLingui } from "@lingui/solid/macro";
import { For, Show, createSignal } from "solid-js";
import { styled } from "styled-system/jsx";

import { useSound } from "@revolt/client";
import { checkCustomSound } from "@revolt/client/customSounds";
import { SOUND_NAMES, SoundName, useState } from "@revolt/state";
import {
  Button,
  CategoryButton,
  Checkbox,
  Column,
  IconButton,
  Row,
  Slider,
  Text,
  iconSize,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import MdVolumeUp from "@material-design-icons/svg/outlined/volume_up.svg?component-solid";

const percent = (value: number) => (value * 100).toFixed(0) + "%";

/**
 * Sound settings: everyone gets a switch and a volume for all sounds,
 * advanced settings turn single sounds off, set their volume or replace
 * them with a file of the user's
 */
export default function Sounds() {
  const { sounds } = useState();
  const soundController = useSound();
  const { t } = useLingui();
  const [advanced, setAdvanced] = createSignal(false);

  const groups = (): {
    title: string;
    sounds: { name: SoundName; title: string; description: string }[];
  }[] => [
    {
      title: t`Messages`,
      sounds: [
        {
          name: "message",
          title: t`Message received`,
          description: t`A message or notification arrives`,
        },
      ],
    },
    {
      title: t`Calls`,
      sounds: [
        {
          name: "userJoinVoice",
          title: t`User joined call`,
          description: t`Someone joins your voice channel`,
        },
        {
          name: "userLeaveVoice",
          title: t`User left call`,
          description: t`Someone leaves your voice channel`,
        },
        {
          name: "userMoved",
          title: t`User moved`,
          description: t`Someone moves into or out of your voice channel`,
        },
        {
          name: "ringtoneIncoming",
          title: t`Incoming call`,
          description: t`Someone calls you in a DM or group`,
        },
        {
          name: "ringtoneOutgoing",
          title: t`Outgoing call`,
          description: t`You call someone and wait for them to join`,
        },
      ],
    },
    {
      title: t`Microphone and headphones`,
      sounds: [
        {
          name: "mute",
          title: t`Mute`,
          description: t`You mute your microphone`,
        },
        {
          name: "unmute",
          title: t`Unmute`,
          description: t`You unmute your microphone`,
        },
        {
          name: "deafen",
          title: t`Deafen`,
          description: t`You deafen yourself`,
        },
        {
          name: "undeafen",
          title: t`Undeafen`,
          description: t`You undeafen yourself`,
        },
      ],
    },
    {
      title: t`Streams`,
      sounds: [
        {
          name: "streamStart",
          title: t`Stream started`,
          description: t`A stream starts in your call`,
        },
        {
          name: "streamEnd",
          title: t`Stream ended`,
          description: t`A stream in your call ends`,
        },
        {
          name: "streamViewerJoin",
          title: t`Viewer joined`,
          description: t`Someone starts watching your stream`,
        },
        {
          name: "streamViewerLeave",
          title: t`Viewer left`,
          description: t`Someone stops watching your stream`,
        },
      ],
    },
  ];

  async function resetAll() {
    if (!confirm(t`Turn every sound on and reset their volumes and files?`))
      return;

    for (const name of SOUND_NAMES) {
      if (!sounds.enabled(name)) sounds.toggle(name);
      sounds.setSoundVolume(name, 1);
      if (sounds.customFile(name))
        await soundController.setCustomSound(name, undefined);
    }
  }

  return (
    <Column>
      <Text class="title">
        <Trans>Sounds</Trans>
      </Text>
      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>volume_up</Symbol>}
          action={<Checkbox checked={sounds.playSounds} />}
          onClick={() => (sounds.playSounds = !sounds.playSounds)}
          description={<Trans>Message, call and stream sounds</Trans>}
        >
          <Trans>Play sounds</Trans>
        </CategoryButton>
      </CategoryButton.Group>

      <Text class="label">
        <Trans>Sound volume</Trans>
      </Text>
      <Content>
        <Grow>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={sounds.volume}
            onInput={(event) => (sounds.volume = event.currentTarget.value)}
            // preview the new volume once the slider is let go
            onChange={() => soundController.playSound("userJoinVoice", true)}
            labelFormatter={percent}
          />
        </Grow>
        <PreviewButton sound="userJoinVoice" />
      </Content>

      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>tune</Symbol>}
          action={<Symbol>{advanced() ? "expand_less" : "expand_more"}</Symbol>}
          onClick={() => setAdvanced(!advanced())}
          description={
            <Trans>
              Turn single sounds off, change their volume or use your own
            </Trans>
          }
        >
          <Trans>Advanced sound settings</Trans>
        </CategoryButton>
      </CategoryButton.Group>

      <Show when={advanced()}>
        <Show when={!sounds.playSounds}>
          <Text class="label">
            <Trans>
              Sounds are turned off above, you can still preview them here.
            </Trans>
          </Text>
        </Show>
        <For each={groups()}>
          {(group) => (
            <Column gap="sm">
              <Text class="label">{group.title}</Text>
              <For each={group.sounds}>
                {(sound) => <SoundCard {...sound} />}
              </For>
            </Column>
          )}
        </For>
        <Row>
          <Button size="sm" variant="text" onPress={resetAll}>
            <Trans>Reset all sounds</Trans>
          </Button>
        </Row>
      </Show>
    </Column>
  );
}

/**
 * Play a sound regardless of the settings
 */
function PreviewButton(props: { sound: SoundName }) {
  const soundController = useSound();
  const { t } = useLingui();

  return (
    <IconButton
      onPress={() => soundController.playSound(props.sound, true)}
      use:floating={{
        tooltip: {
          placement: "top",
          content: t`Play sound`,
        },
      }}
    >
      <MdVolumeUp {...iconSize(18)} />
    </IconButton>
  );
}

/**
 * One sound: on or off, its volume and its file
 */
function SoundCard(props: {
  name: SoundName;
  title: string;
  description: string;
}) {
  const { sounds } = useState();
  const soundController = useSound();
  const { t } = useLingui();
  const [error, setError] = createSignal<string>();
  const [busy, setBusy] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;

  const enabled = () => sounds.enabled(props.name);
  const customFile = () => sounds.customFile(props.name);

  async function pickFile(file?: File) {
    if (fileInput) fileInput.value = "";
    if (!file) return;

    setBusy(true);
    try {
      const problem = await checkCustomSound(file);
      if (problem) {
        setError(problem);
        return;
      }

      await soundController.setCustomSound(props.name, file);
      setError();
      soundController.playSound(props.name, true);
    } catch (err) {
      console.error("[sounds] could not save sound", err);
      setError(t`The sound couldn't be saved.`);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await soundController.setCustomSound(props.name, undefined);
      setError();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Content>
        <Checkbox
          checked={enabled()}
          onChange={(event) => {
            if (event.currentTarget.checked !== enabled())
              sounds.toggle(props.name);
          }}
        />
        <Grow>
          <Column gap="none">
            <SoundTitle>{props.title}</SoundTitle>
            <Muted>{props.description}</Muted>
          </Column>
        </Grow>
        <PreviewButton sound={props.name} />
      </Content>

      <Show when={enabled()}>
        <Content>
          <Muted>
            <Trans>Volume</Trans>
          </Muted>
          <Grow>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={sounds.soundVolume(props.name)}
              onInput={(event) =>
                sounds.setSoundVolume(props.name, event.currentTarget.value)
              }
              onChange={() => soundController.playSound(props.name, true)}
              labelFormatter={percent}
            />
          </Grow>
        </Content>

        <Row gap="sm" align wrap>
          <Grow>
            <Muted>
              <Show when={customFile()} fallback={<Trans>Default sound</Trans>}>
                <Trans>Your file: {customFile()}</Trans>
              </Show>
            </Muted>
          </Grow>
          <Button
            size="sm"
            variant="tonal"
            isDisabled={busy()}
            onPress={() => fileInput?.click()}
          >
            <Trans>Change</Trans>
          </Button>
          <Show when={customFile()}>
            <Button
              size="sm"
              variant="text"
              isDisabled={busy()}
              onPress={reset}
            >
              <Trans>Reset</Trans>
            </Button>
          </Show>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => pickFile(e.currentTarget.files?.[0])}
          />
        </Row>
        <Show when={error()}>
          <ErrorText>{error()}</ErrorText>
        </Show>
      </Show>
    </Card>
  );
}

/**
 * Sound content wrapper
 */
const Content = styled("div", {
  base: {
    display: "flex",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: "var(--gap-md)",
  },
});

const Grow = styled("div", {
  base: {
    flexGrow: 1,
    minWidth: 0,
  },
});

const Card = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-sm)",
    padding: "var(--gap-md)",
    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-surface-container)",
    color: "var(--md-sys-color-on-surface)",
  },
});

const SoundTitle = styled("span", {
  base: {
    fontWeight: 600,
  },
});

const Muted = styled("span", {
  base: {
    fontSize: "13px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const ErrorText = styled("span", {
  base: {
    fontSize: "13px",
    color: "var(--md-sys-color-error)",
  },
});
