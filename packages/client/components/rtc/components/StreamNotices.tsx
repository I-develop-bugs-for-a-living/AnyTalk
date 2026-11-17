import { createEffect, on } from "solid-js";

import { useLingui } from "@lingui/solid/macro";

import { useSnackbar } from "@revolt/ui";

import { useVoice } from "../state";

/**
 * Warns with a short message when a stream started with the Stream button or
 * the hotkey could not start: no window to capture, or the capture failed.
 * Renders nothing.
 */
export function StreamNotices() {
  const voice = useVoice();
  const snackbar = useSnackbar();
  const { t } = useLingui();

  createEffect(
    on(voice.streamNotice, (notice) => {
      if (!notice) return;
      // a named variable, so the catalog shows {name}
      const name = notice.name;
      snackbar.show({
        message:
          notice.kind === "no-window"
            ? name
              ? t`Couldn't find a window to stream for ${name}.`
              : t`Couldn't find a window to stream. Bring the app you want to share to the front, then press the hotkey again.`
            : name
              ? t`Couldn't start the stream. Try running ${name} in windowed or borderless mode.`
              : t`Couldn't start the stream.`,
      });
    }),
  );

  return null;
}
