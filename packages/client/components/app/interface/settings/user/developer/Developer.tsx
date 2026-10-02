import { useState } from "@revolt/state";
import { CategoryButton, Checkbox, Column, Text } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { StreamRecaps } from "./streamRecaps/StreamRecaps";

type Toggle =
  | "advanced:developer_mode"
  | "advanced:developer_overlay"
  | "advanced:developer_record";

/**
 * Developer settings
 */
export function DeveloperSettings() {
  const state = useState();

  const enabled = () => state.settings.getValue("advanced:developer_mode");

  const toggle = (key: Toggle) =>
    state.settings.setValue(key, !state.settings.getValue(key));

  return (
    <Column gap="lg">
      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>code</Symbol>}
          action={<Checkbox checked={enabled()} />}
          onClick={() => toggle("advanced:developer_mode")}
          description="Enable the developer tools below"
        >
          Developer mode
        </CategoryButton>
        <CategoryButton
          icon={<Symbol>analytics</Symbol>}
          disabled={!enabled()}
          action={
            <Checkbox
              checked={state.settings.getValue("advanced:developer_overlay")}
            />
          }
          onClick={() => toggle("advanced:developer_overlay")}
          description="Show live statistics on call video tiles"
        >
          Live statistics overlay
        </CategoryButton>
        <CategoryButton
          icon={<Symbol>monitoring</Symbol>}
          disabled={!enabled()}
          action={
            <Checkbox
              checked={state.settings.getValue("advanced:developer_record")}
            />
          }
          onClick={() => toggle("advanced:developer_record")}
          description="Record statistics of every stream you send or watch as a stream recap, with or without the overlay"
        >
          Record stream recaps
        </CategoryButton>
      </CategoryButton.Group>
      <Column>
        <Text class="title">Stream Recaps</Text>
        <StreamRecaps />
      </Column>
    </Column>
  );
}
