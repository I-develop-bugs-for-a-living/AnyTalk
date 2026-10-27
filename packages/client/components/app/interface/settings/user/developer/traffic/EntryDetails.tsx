import { For, createSignal, onCleanup } from "solid-js";

import { useLingui } from "@lingui/solid/macro";
import { styled } from "styled-system/jsx";

import type { BodySummary, HeaderList } from "@revolt/traffic";
import {
  type TrafficEntry,
  formatBytes,
  formatClock,
  formatDuration,
  remoteOf,
  tlsVersionName,
} from "@revolt/traffic";

import { Pill } from "./controls";

/** One line of the overview: a label and its value. */
type Field = { label: string; value: string; mono?: boolean };

/** A block of monospace text under its own heading. */
type Block = { title: string; text: string };

/**
 * Details of one entry: the readable fields, headers and a body or preview.
 * Uses native listeners (`on:click`), so it also works in the inspector's
 * window.
 */
export function EntryDetails(props: { entry: TrafficEntry }) {
  const { t } = useLingui();
  const [copied, setCopied] = createSignal(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(resetTimer));

  /** Size line, empty when the size is unknown. */
  const size = (bytes: number | undefined) => formatBytes(bytes);

  /** Fields of the overview, depending on what the entry is. */
  const fields = (): Field[] => {
    const e = props.entry;
    const out: (Field | undefined)[] = [];
    const add = (label: string, value: unknown, mono = false) => {
      if (value === undefined || value === null || value === "") return;
      out.push({ label, value: String(value), mono });
    };

    switch (e.kind) {
      case "http":
        add(t`Method`, e.method, true);
        add(t`URL`, e.url, true);
        add(
          t`Status`,
          e.error
            ? e.error
            : [e.status, e.statusText].filter(Boolean).join(" "),
        );
        add(t`Started`, formatClock(e.start));
        add(t`Duration`, formatDuration(e.durationMs ?? e.end - e.start));
        add(t`Protocol`, e.protocol);
        add(t`Response size`, size(e.responseSize));
        add(t`Transferred`, size(e.transferSize));
        add(t`Compressed size`, size(e.encodedBodySize));
        add(t`Decoded size`, size(e.decodedBodySize));
        add(
          t`Made with`,
          e.source === "desktop"
            ? e.background
              ? t`Desktop app (not tied to a page)`
              : t`Desktop app`
            : e.source === "xhr"
              ? "XMLHttpRequest"
              : "fetch",
        );
        add(t`Type`, e.resourceType);
        add(t`From cache`, e.fromCache ? t`Yes` : undefined);
        add(t`Server address`, e.remoteAddress, true);
        break;
      case "resource":
        add(t`URL`, e.url, true);
        add(t`Type`, e.initiatorType);
        add(t`Status`, e.status);
        add(t`Started`, formatClock(e.start));
        add(t`Duration`, formatDuration(e.durationMs));
        add(t`Protocol`, e.protocol);
        add(t`Transferred`, size(e.transferSize));
        add(t`Compressed size`, size(e.encodedBodySize));
        add(t`Decoded size`, size(e.decodedBodySize));
        break;
      case "ws":
        add(t`URL`, e.url, true);
        add(t`Event`, e.event);
        add(t`Time`, formatClock(e.time));
        add(
          t`Direction`,
          e.direction === "in"
            ? t`Received`
            : e.direction === "out"
              ? t`Sent`
              : undefined,
        );
        add(t`Size`, size(e.size));
        add(t`Close code`, e.code);
        add(t`Reason`, e.reason);
        break;
      case "call-info":
        add(t`Room`, e.room);
        add(t`Media server`, e.url, true);
        add(t`Time`, formatClock(e.time));
        add(t`End-to-end encrypted`, e.e2ee ? t`Yes` : t`No`);
        break;
      case "call-connection":
        add(t`Connection`, e.pc);
        add(t`Time`, formatClock(e.time));
        add(t`Route`, e.relayed ? t`Through a relay (TURN)` : t`Direct`);
        add(t`Remote address`, remoteOf(e), true);
        add(t`Transport`, e.protocol);
        add(t`Relay protocol`, e.relayProtocol);
        add(t`Relay server`, e.relayUrl, true);
        add(t`Local candidate`, e.localType);
        add(t`Remote candidate`, e.remoteType);
        add(t`Network type`, e.networkType);
        add(t`DTLS state`, e.dtlsState);
        add(
          t`DTLS version`,
          e.tlsVersion
            ? `${tlsVersionName(e.tlsVersion)}${
                tlsVersionName(e.tlsVersion) === e.tlsVersion
                  ? ""
                  : ` (${e.tlsVersion})`
              }`
            : undefined,
        );
        add(t`DTLS cipher`, e.dtlsCipher, true);
        add(t`SRTP cipher`, e.srtpCipher, true);
        break;
      case "call-bytes":
        add(t`Connection`, e.pc);
        add(t`Time`, formatClock(e.time));
        add(t`Sent`, size(e.bytesSent));
        add(t`Received`, size(e.bytesReceived));
        break;
      case "call-data":
        add(t`Direction`, e.direction === "in" ? t`Received` : t`Sent`);
        add(t`Topic`, e.topic, true);
        add(t`Time`, formatClock(e.time));
        add(t`From`, e.identity, true);
        // only known for messages we sent
        add(
          t`To`,
          e.destination === undefined
            ? undefined
            : e.destination === "all"
              ? t`Everyone in the call`
              : e.destination.join(", "),
        );
        add(
          t`Delivery`,
          e.reliable === undefined
            ? undefined
            : e.reliable
              ? t`Reliable`
              : t`Lossy`,
        );
        add(t`Size`, size(e.size));
        break;
      case "call-attribute":
        add(t`Time`, formatClock(e.time));
        break;
    }
    return out.filter((f): f is Field => !!f);
  };

  /** Header list as text, one `name: value` per line. */
  const headerText = (headers: HeaderList) =>
    headers.map(([name, value]) => `${name}: ${value}`).join("\n");

  /** Request body as text, or nothing when there is none. */
  const bodyText = (body: BodySummary): string => {
    switch (body.kind) {
      case "text":
        return body.text + (body.truncated ? "…" : "");
      case "form":
        return body.fields
          .map((f) =>
            f.file
              ? `${f.name}: ${f.file.name} (${formatBytes(f.file.size)}, ${f.file.type})`
              : f.name,
          )
          .join("\n");
      case "binary":
        return `${formatBytes(body.size)}${body.type ? ` ${body.type}` : ""}`;
      case "stream":
        return t`Stream`;
      case "other":
        return body.description;
      default:
        return "";
    }
  };

  /** Blocks of monospace text under the overview. */
  const blocks = (): Block[] => {
    const e = props.entry;
    const out: Block[] = [];
    const add = (title: string, text: string | undefined) => {
      if (text) out.push({ title, text });
    };
    switch (e.kind) {
      case "http":
        add(t`Request headers`, headerText(e.requestHeaders));
        add(t`Request body`, bodyText(e.requestBody));
        add(t`Response headers`, headerText(e.responseHeaders));
        add(t`Response preview`, e.responsePreview);
        break;
      case "ws":
        add(t`Text`, e.text);
        add(t`First bytes`, e.hex);
        break;
      case "call-bytes":
        add(
          t`Media streams`,
          e.tracks
            .map(
              (tr) =>
                `${tr.direction === "out" ? "↑" : "↓"} ${tr.kind} ${tr.id}: ${formatBytes(tr.bytes)}`,
            )
            .join("\n"),
        );
        break;
      case "call-data":
        add(t`Content`, e.preview + (e.truncated ? "…" : ""));
        break;
      case "call-attribute":
        add(
          t`Attributes`,
          e.attributes.map((a) => `${a.key}: ${a.value}`).join("\n"),
        );
        break;
      default:
        break;
    }
    return out;
  };

  /** Copy the entry as JSON with the clipboard of the window it is shown in. */
  const copy = async (event: Event) => {
    const view = (event.currentTarget as HTMLElement).ownerDocument.defaultView;
    try {
      await (view?.navigator ?? navigator).clipboard.writeText(
        JSON.stringify(props.entry, null, 2),
      );
      setCopied(true);
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available here
    }
  };

  return (
    <Wrap>
      <Fields>
        <For each={fields()}>
          {(field) => (
            <>
              <dt>{field.label}</dt>
              <Value mono={field.mono}>{field.value}</Value>
            </>
          )}
        </For>
      </Fields>
      <For each={blocks()}>
        {(block) => (
          <section>
            <BlockTitle>{block.title}</BlockTitle>
            <Mono tabIndex={0}>{block.text}</Mono>
          </section>
        )}
      </For>
      <div>
        <Pill type="button" kind="tonal" on:click={copy}>
          {copied() ? t`Copied` : t`Copy JSON`}
        </Pill>
      </div>
    </Wrap>
  );
}

/** Stacks the overview, blocks and the copy button */
const Wrap = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    minWidth: 0,
    fontSize: "13px",
    color: "var(--md-sys-color-on-surface)",
  },
});

/** Label and value pairs */
const Fields = styled("dl", {
  base: {
    display: "grid",
    gridTemplateColumns: "minmax(90px, max-content) 1fr",
    columnGap: "12px",
    rowGap: "6px",
    margin: 0,

    "& dt": { color: "var(--md-sys-color-on-surface-variant)" },
  },
});

/** A value, breaking long URLs and keys instead of overflowing */
const Value = styled("dd", {
  base: { margin: 0, minWidth: 0, overflowWrap: "anywhere" },
  variants: {
    mono: {
      true: {
        fontFamily: "var(--fonts-monospace, monospace)",
        fontSize: "12px",
      },
    },
  },
});

/** Heading of a block */
const BlockTitle = styled("h3", {
  base: {
    margin: "0 0 6px",
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

/** Monospace text that keeps its line breaks and scrolls when too long */
const Mono = styled("pre", {
  base: {
    margin: 0,
    padding: "10px 12px",
    maxHeight: "260px",
    overflow: "auto",
    borderRadius: "var(--borderRadius-sm)",
    background: "var(--md-sys-color-surface-container-highest)",
    fontFamily: "var(--fonts-monospace, monospace)",
    fontSize: "12px",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",

    "&:focus-visible": { outline: "2px solid var(--md-sys-color-primary)" },
  },
});
