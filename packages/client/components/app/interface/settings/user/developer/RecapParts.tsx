import { For, JSX, Show, createMemo, createSignal } from "solid-js";

import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import { zipFiles } from "@revolt/rtc/zip";
import { Button, CategoryButton, Checkbox, Row, Text } from "@revolt/ui";

/**
 * Building blocks shared by stream and call recaps
 */

export type RecapCsv = { name: string; text: string };

/**
 * Save a file to the viewer's device
 * @param data Contents
 * @param type Media type
 * @param name File name
 */
export function downloadFile(data: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download recap CSVs: one as a CSV file, several packed in a zip
 * @param files CSV files
 * @param zipName Name of the zip file
 */
export function downloadRecapCsvs(files: RecapCsv[], zipName: string) {
  if (files.length === 1) {
    downloadFile(files[0].text, "text/csv", files[0].name);
    return;
  }

  // recaps started in the same millisecond would share a name
  const seen = new Map<string, number>();
  const unique = files.map((file) => {
    const n = seen.get(file.name) ?? 0;
    seen.set(file.name, n + 1);
    return n
      ? { ...file, name: file.name.replace(/\.csv$/, `-${n}.csv`) }
      : file;
  });

  downloadFile(
    zipFiles(unique) as Uint8Array<ArrayBuffer>,
    "application/zip",
    zipName,
  );
}

/**
 * List of stored recaps that can be opened, or selected to be exported or
 * deleted together
 */
export function RecapList<Meta extends { id: string }>(props: {
  items: Meta[];
  /** What the recaps are of, for confirmations */
  noun: "call" | "stream";
  icon: (meta: Meta) => JSX.Element;
  title: (meta: Meta) => string;
  description: (meta: Meta) => string;
  onOpen: (id: string) => void;
  onExport: (ids: string[]) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
  onDeleteAll: () => void;
}) {
  const [selecting, setSelecting] = createSignal(false);
  const [chosen, setChosen] = createSignal<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = createSignal(false);

  // forget recaps that were deleted meanwhile
  const selected = createMemo(() =>
    props.items.map((m) => m.id).filter((id) => chosen().has(id)),
  );
  const allSelected = () =>
    props.items.length > 0 && selected().length === props.items.length;

  function toggle(id: string) {
    const next = new Set(chosen());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  }

  function stopSelecting() {
    setSelecting(false);
    setChosen(new Set<string>());
  }

  async function run(action: (ids: string[]) => Promise<void>) {
    setBusy(true);
    try {
      await action(selected());
    } finally {
      setBusy(false);
    }
  }

  /** "N selected" header of the selection mode */
  const selectedLabel = () => {
    const count = selected().length;
    return t`${count} selected`;
  };

  /** Question to confirm deleting the selected recaps */
  const confirmDelete = () => {
    const n = selected().length;
    return props.noun === "call"
      ? plural(n, {
          one: "Delete # call recap?",
          other: "Delete # call recaps?",
        })
      : plural(n, {
          one: "Delete # stream recap?",
          other: "Delete # stream recaps?",
        });
  };

  return (
    <>
      <Row gap="sm" align wrap>
        <Show
          when={selecting()}
          fallback={
            <Button
              size="sm"
              variant="tonal"
              onPress={() => setSelecting(true)}
            >
              <Trans>Select</Trans>
            </Button>
          }
        >
          <Text class="label">{selectedLabel()}</Text>
          <Button
            size="sm"
            variant="text"
            onPress={() =>
              setChosen(
                new Set<string>(
                  allSelected() ? [] : props.items.map((m) => m.id),
                ),
              )
            }
          >
            {allSelected() ? (
              <Trans>Select none</Trans>
            ) : (
              <Trans>Select all</Trans>
            )}
          </Button>
          <Button
            size="sm"
            variant="tonal"
            isDisabled={!selected().length || busy()}
            onPress={() => run(props.onExport)}
          >
            <Trans>Export</Trans>
          </Button>
          <Button
            size="sm"
            variant="tonal"
            isDisabled={!selected().length || busy()}
            onPress={() => {
              if (confirm(confirmDelete())) {
                run(props.onDelete).then(stopSelecting);
              }
            }}
          >
            <Trans>Delete</Trans>
          </Button>
          <Button size="sm" variant="text" onPress={stopSelecting}>
            <Trans>Cancel</Trans>
          </Button>
        </Show>
      </Row>
      <Show when={selecting() && selected().length > 1}>
        <Text class="label">
          <Trans>
            Several recaps are exported as one zip file with a CSV for each.
          </Trans>
        </Text>
      </Show>
      <CategoryButton.Group>
        <For each={props.items}>
          {(meta) => (
            <CategoryButton
              icon={props.icon(meta)}
              description={props.description(meta)}
              action={
                selecting() ? (
                  <Checkbox checked={chosen().has(meta.id)} />
                ) : (
                  "chevron"
                )
              }
              onClick={() =>
                selecting() ? toggle(meta.id) : props.onOpen(meta.id)
              }
            >
              {props.title(meta)}
            </CategoryButton>
          )}
        </For>
      </CategoryButton.Group>
      <Show when={!selecting()}>
        <Row>
          <Button variant="text" size="sm" onPress={props.onDeleteAll}>
            <Trans>Delete all recaps</Trans>
          </Button>
        </Row>
      </Show>
    </>
  );
}

export const Tiles = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
    gap: "var(--gap-md)",
  },
});

export const Tile = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-xs)",
    padding: "var(--gap-md)",
    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-surface-container)",
  },
});

export const TileLabel = styled("span", {
  base: {
    fontSize: "12px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

export const TileValue = styled("span", {
  base: {
    fontSize: "18px",
    fontWeight: 600,
    color: "var(--md-sys-color-on-surface)",
  },
});

export const InfoGrid = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    alignItems: "baseline",
    columnGap: "var(--gap-lg)",
    rowGap: "var(--gap-xs)",
    fontSize: "13px",
    color: "var(--md-sys-color-on-surface)",
  },
});

export const Charts = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: "var(--gap-md)",
  },
});
