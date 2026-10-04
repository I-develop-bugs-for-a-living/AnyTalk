import { For } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";

import { useState } from "@revolt/state";
import {
  AVAILABLE_EXPERIMENTS,
  EXPERIMENTS,
} from "@revolt/state/stores/Experiments";
import { CategoryButton, Checkbox, Column } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

/**
 * Advanced settings
 */
export default function AdvancedSettings() {
  const state = useState();
  const { t } = useLingui();

  return (
    <Column gap="xl">
      <Column>
        <Checkbox
          checked={state.settings.getValue("appearance:compact_mode")}
          onChange={(e) =>
            state.settings.setValue(
              "appearance:compact_mode",
              e.currentTarget.checked,
            )
          }
        >
          <Trans>Compact mode</Trans>
        </Checkbox>
        <Checkbox
          checked={state.settings.getValue("advanced:copy_id")}
          onChange={(e) =>
            state.settings.setValue("advanced:copy_id", e.currentTarget.checked)
          }
        >
          <Trans>Show 'copy ID' in context menus</Trans>
        </Checkbox>
        <Checkbox
          checked={state.settings.getValue("advanced:admin_panel")}
          onChange={(e) =>
            state.settings.setValue(
              "advanced:admin_panel",
              e.currentTarget.checked,
            )
          }
        >
          <Trans>Show admin panel shortcuts in context menus</Trans>
        </Checkbox>
      </Column>
      <CategoryButton.Group>
        <For each={AVAILABLE_EXPERIMENTS}>
          {(key) => (
            <CategoryButton
              icon={<Symbol>science</Symbol>}
              action={
                <Checkbox
                  checked={state.experiments.isEnabled(key)}
                  onChange={(event) =>
                    state.experiments.setEnabled(
                      key,
                      event.currentTarget.checked,
                    )
                  }
                />
              }
              description={t(EXPERIMENTS[key].description)}
              onClick={() => void 0}
            >
              {t(EXPERIMENTS[key].title)}
            </CategoryButton>
          )}
        </For>
      </CategoryButton.Group>
    </Column>
  );
}
