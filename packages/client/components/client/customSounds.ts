import localforage from "localforage";

import type { SoundName } from "@revolt/state";

/**
 * The user's own sound files, kept in this browser only
 */
const storage = localforage.createInstance({
  name: "anytalk",
  storeName: "custom_sounds",
});

/** Largest file accepted */
export const MAX_CUSTOM_SOUND_BYTES = 1024 * 1024;

/** Longest sound accepted, in seconds (ringtones repeat) */
export const MAX_CUSTOM_SOUND_SECONDS = 30;

/**
 * Check that a file is a short sound the browser can play
 * @param file File
 * @returns Error message, if it can't be used
 */
export async function checkCustomSound(file: File): Promise<string | void> {
  if (!file.type.startsWith("audio/")) return "This isn't an audio file.";
  if (file.size > MAX_CUSTOM_SOUND_BYTES)
    return "The file is too big, sounds can be up to 1 MB.";

  const url = URL.createObjectURL(file);
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const audio = new Audio();
      const timer = setTimeout(() => reject(new Error("timeout")), 5000);
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(audio.duration);
      };
      audio.onerror = () => {
        clearTimeout(timer);
        reject(new Error("unplayable"));
      };
      audio.src = url;
    });

    if (duration > MAX_CUSTOM_SOUND_SECONDS)
      return `The sound is too long, sounds can be up to ${MAX_CUSTOM_SOUND_SECONDS} seconds.`;
  } catch {
    return "This browser can't play this file.";
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function saveCustomSound(name: SoundName, file: Blob) {
  await storage.setItem(name, file);
}

export async function removeCustomSound(name: SoundName) {
  await storage.removeItem(name);
}

/**
 * Every stored sound file
 * @returns Files by the sound they replace
 */
export async function loadCustomSounds() {
  const files = new Map<SoundName, Blob>();
  await storage.iterate<Blob, void>((file, name) => {
    if (file instanceof Blob) files.set(name as SoundName, file);
  });
  return files;
}
