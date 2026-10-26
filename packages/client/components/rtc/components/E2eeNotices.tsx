import { createEffect, on } from "solid-js";

import { useLingui } from "@lingui/solid/macro";

import { useSnackbar } from "@revolt/ui";

import { useVoice } from "../state";

/**
 * Tells the user with a short message when call encryption kept them out of a
 * call or ended it (unsupported browser, worker or key exchange failure).
 * Renders nothing.
 */
export function E2eeNotices() {
  const voice = useVoice();
  const snackbar = useSnackbar();
  const { t } = useLingui();

  createEffect(
    on(voice.e2eeNotice, (notice) => {
      if (!notice) return;
      snackbar.show({
        message:
          notice.kind === "unsupported"
            ? t`Your browser can't encrypt calls, so you can't join.`
            : notice.kind === "worker"
              ? t`Call encryption couldn't be loaded. Try reloading the page.`
              : t`Couldn't set up call encryption. The server may need an update.`,
      });
    }),
  );

  return null;
}
