import { Show, createSignal, onMount } from "solid-js";

import { Trans, useLingui } from "@lingui/solid/macro";

import {
  Button,
  CategoryButton,
  Checkbox,
  Column,
  Dialog,
  Text,
  TextField,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

/**
 * Desktop Configuration Page
 */
export default function Native() {
  const { t } = useLingui();
  const [autostart, setAutostart] = createSignal(false);
  const [config, setConfig] = createSignal(window.desktopConfig.get());

  /** Problem saving a setting, shown under the list */
  const [saveError, setSaveError] = createSignal<string>();

  /**
   * Save settings in the desktop shell and show what it actually stored
   * @param config Settings to change
   * @returns Whether the shell accepted them
   */
  async function set(config: Partial<DesktopConfig>) {
    try {
      setConfig(await window.desktopConfig.set(config));
      setSaveError();
      return true;
    } catch (err) {
      console.error("[desktop] could not save settings", err);
      setSaveError(t`Could not save this setting.`);
      return false;
    }
  }

  onMount(async () => {
    const value = await window.desktopConfig.getAutostart();
    setAutostart(value);
  });

  async function toggleAutostart() {
    const newValue = !autostart();
    const savedValue = await window.desktopConfig.setAutostart(newValue);
    setAutostart(savedValue);
  }

  /** Server address being typed in the advanced section */
  const [serverDraft, setServerDraft] = createSignal(config().serverUrl);
  const [serverError, setServerError] = createSignal<string>();
  /** Server the user asked to switch to, waiting for confirmation */
  const [pendingServer, setPendingServer] = createSignal<string>();
  const [defaultServer, setDefaultServer] = createSignal("");

  onMount(async () => {
    try {
      setDefaultServer(await window.desktopConfig.getDefaultServerUrl());
    } catch (err) {
      console.error("[desktop] could not read the default server", err);
    }
  });

  /**
   * Check the typed address and ask for confirmation before switching
   */
  function saveServer() {
    const value = serverDraft().trim();

    // an empty field means the default server
    if (!value) {
      setServerError();
      setPendingServer("");
      return;
    }

    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw 0;
      setServerError();
      setPendingServer(url.href);
    } catch {
      setServerError(t`Enter a full address starting with http:// or https://`);
    }
  }

  /**
   * Switch server, the app reloads from the new address
   */
  async function applyServer() {
    const value = pendingServer();
    if (value === undefined) return;
    if (await set({ serverUrl: value })) setServerDraft(value);
  }

  const toggles: Partial<Record<keyof DesktopConfig, () => void>> = {
    minimiseToTray: () => set({ minimiseToTray: !config().minimiseToTray }),
    startMinimisedToTray: () =>
      set({ startMinimisedToTray: !config().startMinimisedToTray }),
    customFrame: () => set({ customFrame: !config().customFrame }),
    spellchecker: () => set({ spellchecker: !config().spellchecker }),
    hardwareAcceleration: () =>
      set({ hardwareAcceleration: !config().hardwareAcceleration }),
  };

  /**
   * A settings row with a checkbox bound to one boolean desktop setting
   * @param key Setting to toggle
   * @param icon Material symbol name
   * @param label Row title
   * @param description Row subtitle
   */
  function CheckboxButton<
    K extends Exclude<keyof DesktopConfig, "windowState" | "serverUrl">,
  >(key: K, icon: string, label: string, description: string) {
    return (
      <CategoryButton
        action={<Checkbox checked={config()[key]} />}
        onClick={toggles[key]}
        icon={<Symbol>{icon}</Symbol>}
        description={description}
      >
        {label}
      </CategoryButton>
    );
  }

  return (
    <Column gap="lg">
      <CategoryButton.Group>
        <CategoryButton
          action={<Checkbox checked={autostart()} />}
          onClick={toggleAutostart}
          icon={<Symbol>exit_to_app</Symbol>}
          description={
            <Trans>Launch AnyTalk when you log into your computer.</Trans>
          }
        >
          <Trans>Start with Computer</Trans>
        </CategoryButton>
        {autostart() &&
          CheckboxButton(
            "startMinimisedToTray",
            "minimize",
            t`Start Minimised to Tray`,
            t`AnyTalk will start in the system tray.`,
          )}
        {CheckboxButton(
          "minimiseToTray",
          "cancel_presentation",
          t`Keep AnyTalk running in the tray when closing the window`,
          t`Turn this off and closing the window quits AnyTalk right away.`,
        )}
        {CheckboxButton(
          "customFrame",
          "web_asset",
          t`Custom window frame`,
          t`Let AnyTalk use its own custom titlebar. Takes effect after you restart AnyTalk.`,
        )}
      </CategoryButton.Group>

      <CategoryButton.Group>
        {CheckboxButton(
          "spellchecker",
          "spellcheck",
          t`Spellchecker`,
          t`Show corrections and suggestions as you type.`,
        )}
        {CheckboxButton(
          "hardwareAcceleration",
          "speed",
          t`Hardware Acceleration`,
          t`Use the graphics card to improve performance. Takes effect after you restart AnyTalk.`,
        )}
      </CategoryButton.Group>

      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>dns</Symbol>}
          description={
            <Trans>Only change this if you run your own AnyTalk server.</Trans>
          }
        >
          <Trans>Advanced</Trans>
        </CategoryButton>
      </CategoryButton.Group>
      <Column>
        <TextField
          type="url"
          label={t`Server address`}
          aria-label={t`Server address`}
          placeholder={defaultServer()}
          value={serverDraft()}
          onInput={(e) => setServerDraft(e.currentTarget.value)}
        />
        <Show when={serverError()}>
          <div role="alert">
            <Text class="label">{serverError()}</Text>
          </div>
        </Show>
        <Text class="label">
          <Trans>
            Leave empty to use the default server. AnyTalk reloads when you
            save.
          </Trans>
        </Text>
        <Button
          onPress={saveServer}
          isDisabled={serverDraft().trim() === config().serverUrl}
        >
          <Trans>Save</Trans>
        </Button>
        <Show when={config().serverUrl}>
          <Button variant="tonal" onPress={() => setPendingServer("")}>
            <Trans>Reset to default</Trans>
          </Button>
        </Show>
      </Column>

      <Show when={saveError()}>
        <div role="alert">
          <Text class="label">{saveError()}</Text>
        </div>
      </Show>

      <CategoryButton.Group>
        <CategoryButton
          icon={<Symbol>desktop_windows</Symbol>}
          description={
            <>
              <Trans>Version:</Trans> {window.native.versions.desktop()}
            </>
          }
        >
          <Trans>AnyTalk for Desktop</Trans>
        </CategoryButton>
      </CategoryButton.Group>

      {/* only mount while open: a closed Dialog still covers the window and swallows clicks */}
      <Show when={pendingServer() !== undefined}>
        <Dialog
          show
          onClose={() => setPendingServer()}
          title={<Trans>Switch server?</Trans>}
          actions={[
            { text: <Trans>Cancel</Trans> },
            { text: <Trans>Switch and reload</Trans>, onClick: applyServer },
          ]}
        >
          <Show
            when={pendingServer()}
            fallback={
              <Trans>
                AnyTalk will reload and use the default server. You may need to
                sign in again.
              </Trans>
            }
          >
            <Trans>
              AnyTalk will reload and connect to {pendingServer()}. You may need
              to sign in again.
            </Trans>
          </Show>
        </Dialog>
      </Show>
    </Column>
  );
}
