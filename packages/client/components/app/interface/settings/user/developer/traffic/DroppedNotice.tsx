import { Show } from "solid-js";

import { plural } from "@lingui/core/macro";
import { styled } from "styled-system/jsx";

import { droppedCount } from "@revolt/traffic";

/**
 * Quiet note about entries the recorder dropped to stay within its count and
 * memory limits. Renders nothing while none were dropped; the count resets
 * when the log is cleared. Plain element, so it also works in the inspector's
 * own window.
 */
export function DroppedNotice() {
  return (
    <Show when={droppedCount() > 0}>
      <Note role="status">
        {plural(droppedCount(), {
          one: "# older entry was dropped to stay within the log's limits",
          other: "# older entries were dropped to stay within the log's limits",
        })}
      </Note>
    </Show>
  );
}

/** The note's text style */
const Note = styled("p", {
  base: {
    margin: 0,
    fontSize: "13px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});
