import { JSX } from "solid-js";

import { Trans } from "@lingui/solid/macro";

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

/**
 * Read and flip the developer toggles stored in settings
 */
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
        <Trans>
          Developer modes measure call performance and keep statistics of
          previous calls and streams on this device. Turn on either or both.
        </Trans>
      </Text>
      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>call</Symbol>}
          action={<Checkbox checked={value("advanced:developer_voice")} />}
          onClick={() => toggle("advanced:developer_voice")}
          description={
            <Trans>
              Measure your microphone and everyone you hear in calls
            </Trans>
          }
        >
          <Trans>Voice call developer mode</Trans>
        </CategoryButton>
        <CategoryButton
          icon={<Symbol>screen_share</Symbol>}
          action={<Checkbox checked={value("advanced:developer_mode")} />}
          onClick={() => toggle("advanced:developer_mode")}
          description={
            <Trans>
              Measure camera and screen share video you send or watch
            </Trans>
          }
        >
          <Trans>Stream developer mode</Trans>
        </CategoryButton>
      </CategoryButton.Group>
      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>monitoring</Symbol>}
          action="chevron"
          onClick={() => navigate("developer/voice")}
          description={
            <Trans>Live overlay, recording and recaps of previous calls</Trans>
          }
        >
          <Trans>Voice call stats</Trans>
        </CategoryButton>
        <CategoryButton
          icon={<Symbol>analytics</Symbol>}
          action="chevron"
          onClick={() => navigate("developer/streams")}
          description={
            <Trans>
              Live overlay, recording and recaps of previous streams
            </Trans>
          }
        >
          <Trans>Stream stats</Trans>
        </CategoryButton>
        <CategoryButton
          icon={<Symbol>compare_arrows</Symbol>}
          action="chevron"
          onClick={() => navigate("developer/compare")}
          description={
            <Trans>Put your recaps next to CSV recaps from other people</Trans>
          }
        >
          <Trans>Compare recaps</Trans>
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
  modeName: JSX.Element;
  overlay: Toggle;
  overlayDescription: JSX.Element;
  record: Toggle;
  recordTitle: JSX.Element;
  recordDescription: JSX.Element;
}) {
  const { value, toggle } = useToggle();
  const enabled = () => value(props.mode);

  return (
    <CategoryButton.Group>
      <CategoryButton
        icon={<Symbol>code</Symbol>}
        action={<Checkbox checked={enabled()} />}
        onClick={() => toggle(props.mode)}
        description={<Trans>Enable the tools below</Trans>}
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
        <Trans>Live statistics overlay</Trans>
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

/**
 * Layout of a statistics page: mode options on top, recaps below
 */
function StatsPage(props: { options: JSX.Element; children: JSX.Element }) {
  return (
    <Column gap="lg">
      {props.options}
      <Column>
        <Text class="title">
          <Trans>Recaps</Trans>
        </Text>
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
          modeName={<Trans>Voice call developer mode</Trans>}
          overlay="advanced:developer_voice_overlay"
          overlayDescription={
            <Trans>Show live microphone statistics on call tiles</Trans>
          }
          record="advanced:developer_voice_record"
          recordTitle={<Trans>Record call recaps</Trans>}
          recordDescription={
            <Trans>
              Record statistics of every call you are in, with or without the
              overlay
            </Trans>
          }
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
          modeName={<Trans>Stream developer mode</Trans>}
          overlay="advanced:developer_overlay"
          overlayDescription={
            <Trans>Show live statistics on call video tiles</Trans>
          }
          record="advanced:developer_record"
          recordTitle={<Trans>Record stream recaps</Trans>}
          recordDescription={
            <Trans>
              Record statistics of every stream you send or watch, with or
              without the overlay
            </Trans>
          }
        />
      }
    >
      <StreamRecaps />
    </StatsPage>
  );
}
