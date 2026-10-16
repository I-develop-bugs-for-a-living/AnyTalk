// Draws the voice overlay. Plain DOM, no framework: the page only receives
// snapshots from the shell through `window.anytalkOverlay`.
import type { OverlayParticipant, OverlayRender } from "../shared/ipc";

declare global {
  interface Window {
    anytalkOverlay: { onState(callback: (state: OverlayRender) => void): void };
  }
}

const list = document.getElementById("list") as HTMLElement;
/** Rows currently on screen, by participant id. */
const rows = new Map<string, HTMLElement>();

/**
 * Pick a stable background colour for the letter fallback.
 *
 * @param id Participant id
 * @returns A CSS colour
 */
function colourFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360} 45% 42%)`;
}

/** Material "mic_off" icon path (24x24) */
const MIC_OFF_PATH =
  "M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z";
/** Material "headset" icon path (24x24); a slash is drawn over it */
const HEADSET_PATH =
  "M12 1a9 9 0 0 0-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7a9 9 0 0 0-9-9z";

/**
 * Build the SVG of a status badge icon.
 *
 * @param deafened Headset with a slash instead of the crossed microphone
 * @returns The icon element
 */
function statusIcon(deafened: boolean): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", deafened ? HEADSET_PATH : MIC_OFF_PATH);
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  if (deafened) {
    // slash drawn twice: a red outline first, then a white line on top
    for (const [stroke, width] of [
      ["#c0222f", "6"],
      ["#ffffff", "2.5"],
    ]) {
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", "3");
      line.setAttribute("y1", "3");
      line.setAttribute("x2", "21");
      line.setAttribute("y2", "21");
      line.setAttribute("stroke", stroke);
      line.setAttribute("stroke-width", width);
      line.setAttribute("stroke-linecap", "round");
      svg.append(line);
    }
  }
  return svg;
}

/**
 * Build the row of a new participant.
 *
 * @param person The participant
 * @returns The row element, filled by `updateRow`
 */
function createRow(person: OverlayParticipant): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.style.background = colourFor(person.id);
  const letter = document.createElement("span");
  avatar.append(letter);

  const name = document.createElement("span");
  name.className = "name";

  const live = document.createElement("span");
  live.className = "live";
  live.textContent = "LIVE";

  const status = document.createElement("span");
  status.className = "status";
  status.setAttribute("role", "img");

  row.append(avatar, name, live, status);
  return row;
}

/**
 * Bring an existing row in line with the participant.
 *
 * @param row The row from `createRow`
 * @param person The participant's latest data
 */
function updateRow(
  row: HTMLElement,
  person: OverlayParticipant,
  liveLabel: string,
  labels: { muted: string; deafened: string },
) {
  const avatar = row.children[0] as HTMLElement;
  const name = row.children[1] as HTMLElement;
  const live = row.children[2] as HTMLElement;
  const status = row.children[3] as HTMLElement;

  row.classList.toggle("speaking", person.speaking);
  name.textContent = person.name;
  live.textContent = liveLabel;
  live.hidden = !person.streaming;

  // deafened wins: it implies muted
  const state = person.deafened ? "deafened" : person.muted ? "muted" : "";
  if (status.dataset.state !== state) {
    status.dataset.state = state;
    status.replaceChildren();
    if (state) status.append(statusIcon(state === "deafened"));
  }
  status.hidden = !state;
  if (state) status.setAttribute("aria-label", labels[state]);
  (avatar.firstElementChild as HTMLElement).textContent = (
    Array.from(person.name)[0] ?? "?"
  ).toUpperCase();

  let img = avatar.querySelector("img");
  if (person.avatar) {
    if (!img) {
      img = document.createElement("img");
      img.alt = "";
      // A broken image falls back to the letter underneath
      img.addEventListener("error", () => img?.remove());
      avatar.append(img);
    }
    if (img.getAttribute("src") !== person.avatar) img.src = person.avatar;
  } else img?.remove();
}

/**
 * Draw a snapshot, reusing rows so the opacity transitions can run.
 *
 * @param state What to draw and how
 */
function render(state: OverlayRender) {
  document.body.dataset.corner = state.corner;
  document.body.dataset.style = state.style;

  const seen = new Set<string>();
  state.participants.forEach((person, index) => {
    seen.add(person.id);
    let row = rows.get(person.id);
    if (!row) {
      row = createRow(person);
      rows.set(person.id, row);
    }
    updateRow(row, person, state.liveLabel || "LIVE", {
      muted: state.mutedLabel || "Muted",
      deafened: state.deafenedLabel || "Deafened",
    });
    // Keeps order without touching rows that are already in place
    if (list.children[index] !== row)
      list.insertBefore(row, list.children[index] ?? null);
  });
  for (const [id, row] of rows) {
    if (seen.has(id)) continue;
    row.remove();
    rows.delete(id);
  }
}

window.anytalkOverlay.onState(render);
