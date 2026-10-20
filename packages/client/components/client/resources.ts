import { useQuery } from "@tanstack/solid-query";
import { type Client, User, UserProfile } from "stoat.js";

import { useClient } from ".";

/** User profile plus the custom banner hue, which stoat.js does not expose */
export type ProfileWithHue = UserProfile & {
  /** Raw `banner_hue` from the server; undefined means automatic */
  bannerHue?: number;
};

/**
 * Fetch a user's profile and keep the raw `banner_hue` field, which the
 * stoat.js `UserProfile` class drops. Servers without the field give none.
 * @param client Client
 * @param user User
 * @returns Profile with `bannerHue` when the server sent one
 */
export async function fetchProfile(
  client: Client,
  user: User,
): Promise<ProfileWithHue> {
  const data = await client.api.get(`/users/${user.id as ""}/profile`);
  const profile: ProfileWithHue = new UserProfile(client, data);
  const hue = (data as { banner_hue?: unknown }).banner_hue;
  if (typeof hue === "number") profile.bannerHue = hue;
  return profile;
}

/**
 * Create a new resource for current account's MFA configuration
 * @returns MFA configuration
 */
export function createMfaResource() {
  const client = useClient();

  return useQuery(() => ({
    queryKey: ["mfa", client().user!.id],
    queryFn: () => client().account.mfa(),
    throwOnError: true,
  }));
}

/**
 * Create a new resource for user profile
 * @param user User
 * @returns User profile resource
 */
export function createProfileResource(user: User) {
  const client = useClient();
  return useQuery(() => ({
    queryKey: ["profile", user.id],
    queryFn: () => fetchProfile(client(), user),
    throwOnError: true,
  }));
}

/**
 * Create a new resource for own user profile
 * @returns User profile resource
 */
export function createOwnProfileResource() {
  const client = useClient();
  return createProfileResource(client().user!);
}

/**
 * Create a new resource for own bots
 * @returns List of owned bots
 */
export function createOwnBotsResource() {
  const client = useClient();
  return useQuery(() => ({
    queryKey: ["bots", client().user!.id],
    queryFn: () => client().bots.fetchOwned(),
    throwOnError: true,
  }));
}
