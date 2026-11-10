import { createSignal } from "solid-js";

const [bottom, setBottom] = createSignal(0);

/**
 * Where the app title bar ends, in pixels from the top of the viewport (0
 * while there is none). Lets floating UI keep clear of it.
 */
export const titlebarBottom = bottom;

/**
 * Report where the app title bar ends. Only the title bar calls this.
 * @param value Pixels from the top of the viewport
 */
export const setTitlebarBottom = setBottom;
