/** Frame name of the fallback popup, the desktop app recognises it by this prefix */
export const POPOUT_FRAME_PREFIX = "anytalk-stream-popout";

/** How a stream gets its own window */
export type PopoutKind = "pip" | "popup";

/** The parts of the window object the API choice looks at */
type PopoutHost = { documentPictureInPicture?: unknown };

/**
 * Pick the way to open a stream window.
 *
 * Document Picture-in-Picture (Chromium 116+) gives an always-on-top window.
 * Without it a same-origin popup is used, except on touch-only devices where
 * neither is useful.
 * @param host The window object
 * @param touchOnly Whether the device has no mouse to hover with
 * @param canOpen Whether `window.open` exists
 * @param desktop Whether this is the desktop app, where the stream gets a
 * normal app window instead of a floating one
 * @returns The API to use, or undefined when popping out isn't possible
 */
export function pickPopoutApi(
  host: PopoutHost,
  touchOnly: boolean,
  canOpen = true,
  desktop = false,
): PopoutKind | undefined {
  if (touchOnly) return undefined;
  if (desktop) return canOpen ? "popup" : undefined;
  if (host.documentPictureInPicture) return "pip";
  return canOpen ? "popup" : undefined;
}

/** Widest and tallest starting size of a stream window, in CSS pixels */
export const POPOUT_MAX = { width: 960, height: 720 };

/**
 * Starting size of a stream window, following the stream's aspect ratio.
 * @param dimensions Size of the video, if known
 * @returns Width and height of the window
 */
export function popoutSize(dimensions?: { width: number; height: number }): {
  width: number;
  height: number;
} {
  const valid =
    dimensions &&
    dimensions.width > 0 &&
    dimensions.height > 0 &&
    Number.isFinite(dimensions.width) &&
    Number.isFinite(dimensions.height);
  // keep absurd shapes usable
  const ratio = valid
    ? Math.min(3, Math.max(0.5, dimensions.width / dimensions.height))
    : 16 / 9;

  let width = POPOUT_MAX.width;
  let height = Math.round(width / ratio);
  if (height > POPOUT_MAX.height) {
    height = POPOUT_MAX.height;
    width = Math.round(height * ratio);
  }
  return { width, height };
}

/**
 * Copy the app's styles into the document of a stream window, so the classes
 * and colours of the app work there.
 *
 * Stylesheet links are cloned with their absolute address (an about:blank
 * popup can't resolve relative ones); style elements whose rules were added
 * through the CSS object model are copied rule by rule.
 * @param from The app's document
 * @param to The document of the stream window
 */
export function copyDocumentStyles(from: Document, to: Document) {
  for (const sheet of Array.from(from.styleSheets)) {
    if (sheet.href) {
      const link = to.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      to.head.appendChild(link);
      continue;
    }

    try {
      const style = to.createElement("style");
      style.textContent = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      to.head.appendChild(style);
    } catch {
      // rules of a sheet from another origin can't be read
    }
  }
}

/**
 * Copy the attributes the app sets on its root elements (theme variables on
 * the body, direction and language on the html element) to the stream window
 * @param from The app's document
 * @param to The document of the stream window
 */
export function copyRootAttributes(from: Document, to: Document) {
  for (const [source, target] of [
    [from.documentElement, to.documentElement],
    [from.body, to.body],
  ] as const) {
    for (const attr of Array.from(source.attributes)) {
      target.setAttribute(attr.name, attr.value);
    }
  }
}

/** Whether a node of the document head carries styles */
function isStyleNode(node: Node): node is HTMLStyleElement | HTMLLinkElement {
  return (
    node.nodeName === "STYLE" ||
    (node.nodeName === "LINK" && (node as HTMLLinkElement).rel === "stylesheet")
  );
}

/**
 * Keep a stream window in step with the app while it is open: theme changes
 * on the root elements, and styles added to (or changed in) the head later,
 * such as a font that loads or a lazily loaded stylesheet.
 * @param from The app's document
 * @param to The document of the stream window
 * @returns Function that stops following
 */
export function followDocument(from: Document, to: Document) {
  const roots = new MutationObserver(() => copyRootAttributes(from, to));
  const options = { attributes: true };
  roots.observe(from.documentElement, options);
  roots.observe(from.body, options);

  /** Copies in the stream window, by the app's style node */
  const copies = new Map<Node, Node>();
  const head = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList" && record.target === from.head) {
        for (const node of Array.from(record.addedNodes)) {
          if (!isStyleNode(node)) continue;
          const copy = to.importNode(node, true);
          copies.set(node, copy);
          to.head.appendChild(copy);
        }
        for (const node of Array.from(record.removedNodes)) {
          copies.get(node)?.parentNode?.removeChild(copies.get(node)!);
          copies.delete(node);
        }
      } else {
        // the text of a style element changed
        const style = (
          record.target.nodeType === Node.ELEMENT_NODE
            ? (record.target as Element)
            : record.target.parentElement
        )?.closest("style");
        const copy = style && copies.get(style);
        if (style && copy) copy.textContent = style.textContent;
      }
    }
  });
  head.observe(from.head, {
    childList: true,
    characterData: true,
    subtree: true,
  });

  return () => {
    roots.disconnect();
    head.disconnect();
    copies.clear();
  };
}

/**
 * Open a window for a stream and prepare its document: title, styles, theme
 * and a black, scroll-free page.
 * @param kind Which API to open it with
 * @param options Title, starting size and a name for the popup frame
 * @returns The window, it is ready to get content
 */
export async function openPopoutWindow(
  kind: PopoutKind,
  options: { title: string; width: number; height: number; name: string },
): Promise<{ win: Window; stopFollowing: () => void }> {
  let win: Window | null = null;

  if (kind === "pip") {
    win = await window.documentPictureInPicture!.requestWindow({
      width: options.width,
      height: options.height,
    });
  } else {
    win = window.open(
      "about:blank",
      `${POPOUT_FRAME_PREFIX}-${options.name}`,
      `popup=yes,width=${options.width},height=${options.height}`,
    );
  }
  if (!win) throw new Error("The window was blocked");

  try {
    const doc = win.document;
    doc.title = options.title;
    copyDocumentStyles(document, doc);
    copyRootAttributes(document, doc);

    const base = doc.createElement("style");
    base.textContent =
      "html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}";
    doc.head.appendChild(base);

    return { win, stopFollowing: followDocument(document, doc) };
  } catch (e) {
    // don't leave an empty window behind
    win.close();
    throw e;
  }
}

/** Document Picture-in-Picture (Chromium 116+), not in the TypeScript DOM types */
declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options?: {
        width?: number;
        height?: number;
      }): Promise<Window>;
    };
  }
}
