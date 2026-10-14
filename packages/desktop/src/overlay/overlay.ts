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

  row.append(avatar, name, live);
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
) {
  const avatar = row.children[0] as HTMLElement;
  const name = row.children[1] as HTMLElement;
  const live = row.children[2] as HTMLElement;

  row.classList.toggle("speaking", person.speaking);
  name.textContent = person.name;
  live.textContent = liveLabel;
  live.hidden = !person.streaming;
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
    updateRow(row, person, state.liveLabel || "LIVE");
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
