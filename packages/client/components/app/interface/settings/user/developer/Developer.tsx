import { JSX } from "solid-js";

import { useState } from "@revolt/state";
import { CategoryButton, Checkbox, Column, Text } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { useSettingsNavigation } from "../../Settings";

import { CallRecaps } from "./CallRecaps";
import { StreamRecaps } from "./StreamRecaps";

type Toggle =
  | "advanced:developer_mode"
  | "advanced:developer_overlay"
  | "advanced:developer_record"
  | "advanced:developer_voice"
  | "advanced:developer_voice_overlay"
  | "advanced:developer_voice_record";

function useToggle() {
  const state = useState();
  return {
    value: (key: Toggle) => !!state.settings.getValue(key),
    toggle: (key: Toggle) =>
      state.settings.setValue(key, !state.settings.getValue(key)),
  };
}

/**
 * Developer settings: turn voice and stream developer modes on and open
 * their statistics
 */
export function DeveloperSettings() {
  const { navigate } = useSettingsNavigation();
  const { value, toggle } = useToggle();

  return (
    <Column gap="lg">
      <Text class="label">
        Developer modes measure call performance and keep statistics of previous
        calls and streams on this device. Turn on either or both.
      </Text>
      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>call</Symbol>}
          action={<Checkbox checked={value("advanced:developer_voice")} />}
          onClick={() => toggle("advanced:developer_voice")}
          description="Measure your microphone and everyone you hear in calls"
        >
          Voice call developer mode
        </CategoryButton>
        <CategoryButton
          icon={<Symbol>screen_share</Symbol>}
          action={<Checkbox checked={value("advanced:developer_mode")} />}
          onClick={() => toggle("advanced:developer_mode")}
          description="Measure camera and screen share video you send or watch"
        >
          Stream developer mode
        </CategoryButton>
      </CategoryButton.Group>
      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>monitoring</Symbol>}
          action="chevron"
          onClick={() => navigate("developer/voice")}
          description="Live overlay, recording and recaps of previous calls"
        >
          Voice call stats
        </CategoryButton>
        <CategoryButton
          icon={<Symbol>analytics</Symbol>}
          action="chevron"
          onClick={() => navigate("developer/streams")}
          description="Live overlay, recording and recaps of previous streams"
        >
          Stream stats
        </CategoryButton>
        <CategoryButton
          icon={<Symbol>compare_arrows</Symbol>}
          action="chevron"
          onClick={() => navigate("developer/compare")}
          description="Put your recaps next to CSV recaps from other people"
        >
          Compare recaps
        </CategoryButton>
      </CategoryButton.Group>
    </Column>
  );
}

/**
 * Overlay and recording toggles of one developer mode
 */
function ModeOptions(props: {
  mode: Toggle;
  modeName: string;
  overlay: Toggle;
  overlayDescription: string;
  record: Toggle;
  recordTitle: string;
  recordDescription: string;
}) {
  const { value, toggle } = useToggle();
  const enabled = () => value(props.mode);

  return (
    <CategoryButton.Group>
      <CategoryButton
        icon={<Symbol>code</Symbol>}
        action={<Checkbox checked={enabled()} />}
        onClick={() => toggle(props.mode)}
        description="Enable the tools below"
      >
        {props.modeName}
      </CategoryButton>
      <CategoryButton
        icon={<Symbol>analytics</Symbol>}
        disabled={!enabled()}
        action={<Checkbox checked={value(props.overlay)} />}
        onClick={() => toggle(props.overlay)}
        description={props.overlayDescription}
      >
        Live statistics overlay
      </CategoryButton>
      <CategoryButton
        icon={<Symbol>monitoring</Symbol>}
        disabled={!enabled()}
        action={<Checkbox checked={value(props.record)} />}
        onClick={() => toggle(props.record)}
        description={props.recordDescription}
      >
        {props.recordTitle}
      </CategoryButton>
    </CategoryButton.Group>
  );
}

function StatsPage(props: { options: JSX.Element; children: JSX.Element }) {
  return (
    <Column gap="lg">
      {props.options}
      <Column>
        <Text class="title">Recaps</Text>
        {props.children}
      </Column>
    </Column>
  );
}

/**
 * Voice call statistics (voice developer mode)
 */
export function VoiceStatsSettings() {
  return (
    <StatsPage
      options={
        <ModeOptions
          mode="advanced:developer_voice"
          modeName="Voice call developer mode"
          overlay="advanced:developer_voice_overlay"
          overlayDescription="Show live microphone statistics on call tiles"
          record="advanced:developer_voice_record"
          recordTitle="Record call recaps"
          recordDescription="Record statistics of every call you are in, with or without the overlay"
        />
      }
    >
      <CallRecaps />
    </StatsPage>
  );
}

/**
 * Stream statistics (stream developer mode)
 */
export function StreamStatsSettings() {
  return (
    <StatsPage
      options={
        <ModeOptions
          mode="advanced:developer_mode"
          modeName="Stream developer mode"
          overlay="advanced:developer_overlay"
          overlayDescription="Show live statistics on call video tiles"
          record="advanced:developer_record"
          recordTitle="Record stream recaps"
          recordDescription="Record statistics of every stream you send or watch, with or without the overlay"
        />
      }
    >
      <StreamRecaps />
    </StatsPage>
  );
}
