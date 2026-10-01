import { useState } from "@revolt/state";
import { CategoryButton, Checkbox, Column, Text } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { StreamRecaps } from "./streamRecaps/StreamRecaps";

/**
 * Developer settings
 */
export function DeveloperSettings() {
  const state = useState();

  return (
    <Column gap="lg">
      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>code</Symbol>}
          action={
            <Checkbox
              checked={state.settings.getValue("advanced:developer_mode")}
            />
          }
          onClick={() =>
            state.settings.setValue(
              "advanced:developer_mode",
              !state.settings.getValue("advanced:developer_mode"),
            )
          }
          description="Show live statistics on call video tiles and record stream recaps"
        >
          Developer mode
        </CategoryButton>
      </CategoryButton.Group>
      <Column>
        <Text class="title">Stream Recaps</Text>
        <StreamRecaps />
      </Column>
    </Column>
  );
}
