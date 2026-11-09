import { useLingui } from "@lingui/solid/macro";

import type { ServiceId } from "@revolt/traffic";

/**
 * Returns a function that gives the translated display name of a service.
 */
export function useServiceLabel() {
  const { t } = useLingui();
  return (service: ServiceId): string =>
    ({
      api: t`API`,
      events: t`Events`,
      uploads: t`Uploads`,
      embeds: t`Embeds proxy`,
      gif: t`GIF provider`,
      "call-signalling": t`Call signalling`,
      "call-media": t`Call media`,
      other: t`Other`,
    })[service];
}
