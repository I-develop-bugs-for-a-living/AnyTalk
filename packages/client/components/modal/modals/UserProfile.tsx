import { Show } from "solid-js";

import { useQuery } from "@tanstack/solid-query";
import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import { fetchProfile } from "@revolt/client/resources";
import { useDevice } from "@revolt/common";
import { Dialog, DialogProps, Profile } from "@revolt/ui";

import { useModals } from "..";
import { Modals } from "../types";

import { UserProfilePhone } from "./UserProfilePhone";

/**
 * Full user profile. Phone layouts (<= 600px wide) get the full-screen
 * `UserProfilePhone` page, everything else the dialog.
 */
export function UserProfileModal(
  props: DialogProps &
    Modals & { type: "user_profile" } & {
      /** Id of this modal entry, to tell stacked profiles apart */
      modalId?: string;
    },
) {
  const { layout } = useDevice();
  const { openModal } = useModals();
  const client = useClient();

  const query = useQuery(() => ({
    queryKey: ["profile", props.user.id],
    queryFn: () => fetchProfile(client(), props.user),
  }));

  return (
    <Show
      when={layout() !== "phone"}
      fallback={
        <UserProfilePhone
          show={props.show}
          onClose={props.onClose}
          modalId={props.modalId}
          user={props.user}
          member={props.member}
        />
      }
    >
      <Dialog
        show={props.show}
        onClose={props.onClose}
        minWidth={560}
        padding={8}
      >
        <Grid>
          <Profile.Banner
            width={3}
            user={props.user}
            member={props.member}
            bannerUrl={query.data?.animatedBannerURL}
            bannerHue={query.data?.bannerHue}
            onClick={
              query.data?.banner
                ? () =>
                    openModal({
                      type: "image_viewer",
                      file: query.data!.banner!,
                    })
                : undefined
            }
            onClickAvatar={(e) => {
              e.stopPropagation();

              if (props.user.avatar) {
                openModal({ type: "image_viewer", file: props.user.avatar });
              }
            }}
          />

          <Profile.Actions
            user={props.user}
            member={props.member}
            onClose={props.onClose}
            width={3}
          />
          <Profile.Roles member={props.member} />
          <Profile.Status user={props.user} />
          <Profile.Badges user={props.user} />
          <Profile.Joined user={props.user} member={props.member} />
          <Profile.Mutuals user={props.user} member={props.member} />
          <Profile.Bio content={query.data?.content} full />
        </Grid>
      </Dialog>
    </Show>
  );
}

const Grid = styled("div", {
  base: {
    display: "grid",
    gap: "var(--gap-md)",
    padding: "var(--gap-md)",
    gridTemplateColumns: "repeat(3, 1fr)",
  },
});
