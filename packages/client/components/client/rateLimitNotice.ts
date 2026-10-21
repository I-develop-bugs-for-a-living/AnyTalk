import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/solid/macro";

import {
  RateLimitInfo,
  claimRateLimitNotice,
  retryAfterSeconds,
} from "@revolt/state/stores/rateLimit";
import { useSnackbar } from "@revolt/ui";

/**
 * Create a function that tells the user to slow down when a message was
 * blocked by the rate limit or slowmode. Only the first blocked message of a
 * burst gets a notice (shared across channels).
 * @returns Function to call with the rejection info
 */
export function useRateLimitNotice() {
  const { t } = useLingui();
  const snackbar = useSnackbar();

  return (info: RateLimitInfo) => {
    if (!claimRateLimitNotice(info, Date.now())) return;

    const seconds = retryAfterSeconds(info);

    let message: string;
    if (info.kind === "slowmode") {
      message = seconds
        ? plural(seconds, {
            one: "This channel is in slowmode. Your message is back in the text box, try again in # second.",
            other:
              "This channel is in slowmode. Your message is back in the text box, try again in # seconds.",
          })
        : t`This channel is in slowmode. Your message is back in the text box, try again in a moment.`;
    } else {
      message = seconds
        ? plural(seconds, {
            one: "You're sending messages too quickly. Your message is back in the text box, try again in # second.",
            other:
              "You're sending messages too quickly. Your message is back in the text box, try again in # seconds.",
          })
        : t`You're sending messages too quickly. Your message is back in the text box, try again in a moment.`;
    }

    snackbar.show({ message });
  };
}
