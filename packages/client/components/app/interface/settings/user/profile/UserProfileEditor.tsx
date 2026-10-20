import { createFormControl, createFormGroup, IFormGroup } from "solid-forms";
import { createEffect, createSignal, JSX, on, Show } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";
import { useQueryClient } from "@tanstack/solid-query";
import { API, User } from "stoat.js";

import { useClient } from "@revolt/client";
import type { ProfileWithHue } from "@revolt/client/resources";
import { useInstance } from "@revolt/instance";
import {
  CategoryButton,
  CircularProgress,
  Column,
  Form2,
  Row,
  Text,
  validBannerHue,
} from "@revolt/ui";

import MdBadge from "@material-design-icons/svg/filled/badge.svg?component-solid";

import { useSettingsNavigation } from "../../Settings";

import { BannerColourField } from "./BannerColourField";

type AttachedControl<T> = {
  name: string;
  value: T;
};

interface Props {
  user: User;
  profile?: ProfileWithHue;
  attach?: AttachedControl<unknown>[];
  onSubmit?: (g: IFormGroup) => void;
  onReset?: (g: IFormGroup) => void;
  /** Called with the banner hue as currently edited (null = automatic) */
  onBannerHueChange?: (hue: number | null) => void;
  children?: (g: IFormGroup) => JSX.Element;
}

export function UserProfileEditor(props: Props) {
  const { t } = useLingui();
  const client = useClient();
  const queryClient = useQueryClient();
  const instance = useInstance();
  const { navigate } = useSettingsNavigation();

  /* eslint-disable solid/reactivity */
  const editGroup = createFormGroup({
    displayName: createFormControl(props.user.displayName),
    // username: createFormControl(props.user.username),
    avatar: createFormControl<string | File[] | null>(
      props.user.animatedAvatarURL,
    ),
    pronouns: createFormControl<string>(props.user.pronouns),
    banner: createFormControl<string | File[] | null>(null),
    bannerHue: createFormControl<number | null>(null),
    bio: createFormControl(""),
    ...(props.attach
      ? props.attach.reduce(
          (attached, toAttach) => ({
            [toAttach.name]: createFormControl(toAttach.value),
            ...attached,
          }),
          {},
        )
      : {}),
  });
  /* eslint-enable solid/reactivity */

  const [initialBio, setInitialBio] = createSignal<readonly [string]>();

  /** Banner hue stored on the server (null = automatic), to detect changes */
  const [initialHue, setInitialHue] = createSignal<number | null>(null);

  /** Set the hue control from a stored value and tell the preview */
  function resetHue(hue: number | undefined) {
    const valid = validBannerHue(hue) ?? null;
    setInitialHue(valid);
    editGroup.controls.bannerHue.setValue(valid);
    editGroup.controls.bannerHue.markDirty(false);
    props.onBannerHueChange?.(valid);
  }

  /** Apply a hue picked in the field: update the control and the preview */
  function pickHue(hue: number | null) {
    editGroup.controls.bannerHue.setValue(hue);
    editGroup.controls.bannerHue.markDirty(hue !== initialHue());
    props.onBannerHueChange?.(hue);
  }

  // once profile data is loaded, copy it into the form
  createEffect(
    on(
      () => props.profile,
      (profileData) => {
        if (profileData) {
          editGroup.controls.banner.setValue(
            profileData.animatedBannerURL || null,
          );

          editGroup.controls.bio.setValue(profileData.content || "");
          setInitialBio([profileData.content || ""]);
          resetHue(profileData.bannerHue);
        }
      },
    ),
  );

  function onReset() {
    editGroup.controls.displayName.setValue(props.user.displayName);
    editGroup.controls.avatar.setValue(props.user.animatedAvatarURL);
    editGroup.controls.pronouns.setValue(props.user.pronouns || "");

    if (props.profile) {
      editGroup.controls.banner.setValue(
        props.profile.animatedBannerURL || null,
      );
      editGroup.controls.bio.setValue(props.profile.content || "");
      setInitialBio([props.profile.content || ""]);
      resetHue(props.profile.bannerHue);
    }

    if (props.onReset) {
      props.onReset(editGroup);
    }
  }

  async function onSubmit() {
    const changes: API.DataEditUser = {
      remove: [],
    };

    if (editGroup.controls.displayName.isDirty) {
      if (!editGroup.controls.displayName.value) {
        changes.remove!.push("DisplayName");
      } else {
        changes.display_name = editGroup.controls.displayName.value.trim();
      }
    }

    if (editGroup.controls.avatar.isDirty) {
      if (!editGroup.controls.avatar.value) {
        changes.remove!.push("Avatar");
      } else if (Array.isArray(editGroup.controls.avatar.value)) {
        changes.avatar = await client().uploadFile(
          "avatars",
          editGroup.controls.avatar.value[0],
          instance.mediaUrl,
        );
      }
    }

    if (editGroup.controls.pronouns.isDirty) {
      if (!editGroup.controls.pronouns.value) {
        changes.remove?.push("Pronouns");
      } else {
        changes.pronouns = editGroup.controls.pronouns.value.trim();
      }
    }

    if (editGroup.controls.bio.isDirty) {
      if (!editGroup.controls.bio.value) {
        changes.remove!.push("ProfileContent");
      } else {
        changes.profile ??= {};
        changes.profile.content = editGroup.controls.bio.value;
      }
    }

    let newBannerUrl: string | null = null;

    if (editGroup.controls.banner.isDirty) {
      if (!editGroup.controls.banner.value) {
        changes.remove!.push("ProfileBackground");
      } else if (Array.isArray(editGroup.controls.banner.value)) {
        changes.profile ??= {};
        changes.profile.background = await client().uploadFile(
          "backgrounds",
          editGroup.controls.banner.value[0],
          instance.mediaUrl,
        );

        newBannerUrl = `${instance.mediaUrl}/backgrounds/${changes.profile.background}`;
      } else {
        newBannerUrl = editGroup.controls.banner.value;
      }
    }

    // custom banner colour (only editable while there is no banner image).
    // A hue picked before adding an image is saved on purpose: it shows
    // again if the image is removed.
    const newHue = editGroup.controls.bannerHue.value;
    const hueChanged = editGroup.controls.bannerHue.isDirty;

    if (hueChanged) {
      if (newHue === null) {
        // `ProfileBannerHue` is newer than the stoat-api types
        (changes.remove as string[]).push("ProfileBannerHue");
      } else {
        changes.profile ??= {};
        (changes.profile as { banner_hue?: number }).banner_hue = newHue;
      }
    }

    await props.user.edit(changes);

    if (
      (editGroup.controls.banner.isDirty ||
        editGroup.controls.bio.isDirty ||
        hueChanged) &&
      props.profile
    ) {
      queryClient.setQueryData(["profile", props.user.id], {
        ...props.profile,
        // keep the cached banner unless this save changed it
        animatedBannerURL: editGroup.controls.banner.isDirty
          ? newBannerUrl
          : props.profile.animatedBannerURL,
        bannerURL: editGroup.controls.banner.isDirty
          ? newBannerUrl
          : props.profile.bannerURL,
        content: editGroup.controls.bio.value,
        bannerHue: newHue ?? undefined,
      });
      setInitialHue(newHue);
    }

    if (props.onSubmit) {
      props.onSubmit(editGroup);
    }
  }

  const submit = Form2.useSubmitHandler(editGroup, onSubmit, onReset);

  return (
    <form onSubmit={submit}>
      <Column>
        <Form2.FileInput
          control={editGroup.controls.avatar}
          accept="image/*"
          label={t`Avatar`}
          imageJustify={false}
          maxSize={instance.limits().file_upload_size_limits["avatars"]}
        />
        <Form2.FileInput
          control={editGroup.controls.banner}
          accept="image/*"
          label={t`Banner`}
          imageAspect="232/100"
          imageRounded={false}
          imageJustify={false}
          maxSize={instance.limits().file_upload_size_limits["backgrounds"]}
        />
        <Show when={!editGroup.controls.banner.value}>
          <BannerColourField
            userId={props.user.id}
            value={editGroup.controls.bannerHue.value}
            onChange={pickHue}
          />
        </Show>
        <Form2.TextField
          minlength={2}
          maxlength={32}
          counter
          name="displayName"
          control={editGroup.controls.displayName}
          label={t`Display Name`}
        />
        <Form2.TextField
          minlength={1}
          maxlength={24}
          counter
          name="pronouns"
          control={editGroup.controls.pronouns}
          label={t`Pronouns`}
        />
        <Show when={!props.user.bot}>
          <CategoryButton
            icon={<MdBadge />}
            action="chevron"
            description={
              <Trans>Go to account settings to edit your username</Trans>
            }
            onClick={() => navigate("account")}
          >
            <Trans>Want to change username?</Trans>
          </CategoryButton>
        </Show>
        <Text class="label">
          <Trans>Profile Bio</Trans>
        </Text>
        <Form2.TextEditor
          initialValue={initialBio()}
          control={editGroup.controls.bio}
          placeholder={t`Something cool about me...`}
        />
        {props.children?.(editGroup)}

        <Row>
          <Form2.Reset group={editGroup} onReset={onReset} />
          <Form2.Submit group={editGroup} requireDirty>
            <Trans>Save</Trans>
          </Form2.Submit>
          <Show when={editGroup.isPending}>
            <CircularProgress />
          </Show>
        </Row>
      </Column>
    </form>
  );
}
