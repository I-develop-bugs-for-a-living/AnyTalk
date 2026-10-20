import { BiRegularCheckCircle, BiSolidCheckCircle } from "solid-icons/bi";

import { Show } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import type { ServerFlags } from "stoat.js";

import { Tooltip } from "@revolt/ui";

/**
 * Server badge: a filled check for official servers, an outlined one for
 * verified servers, nothing otherwise
 */
export function ServerBadge(props: { flags: ServerFlags }) {
  const { t } = useLingui();

  return (
    <Show when={props.flags}>
      <Tooltip
        content={props.flags === 1 ? t`Official Server` : t`Verified`}
        placement="top"
      >
        {props.flags === 1 ? (
          <BiSolidCheckCircle size={12} />
        ) : (
          <BiRegularCheckCircle size={12} />
        )}
      </Tooltip>
    </Show>
  );
}
