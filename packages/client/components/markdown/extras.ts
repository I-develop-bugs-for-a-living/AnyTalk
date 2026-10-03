import { createSignal } from "solid-js";

import type { Pluggable } from "unified";

/**
 * Markdown plugins that are only downloaded once a message needs them:
 * code highlighting (highlight.js with every language, ~900 KB) and maths
 * (KaTeX, ~250 KB). Messages rendered before they arrive show the code or
 * maths as plain text and are rendered again once loaded.
 */
export type MarkdownExtras = {
  katex?: Pluggable;
  highlight?: Pluggable;
};

const [extras, setExtras] = createSignal<MarkdownExtras>({});

/** Plugins loaded so far */
export const markdownExtras = extras;

const loading = { katex: false, highlight: false };

/** Download KaTeX for maths, if not already */
export function loadKatex() {
  if (extras().katex || loading.katex) return;
  loading.katex = true;

  Promise.all([import("rehype-katex"), import("katex/dist/katex.min.css")])
    .then(([katex]) =>
      setExtras((e) => ({
        ...e,
        katex: [
          katex.default,
          {
            maxSize: 10,
            maxExpand: 2,
            trust: false,
            strict: false,
            output: "html",
            errorColor: "var(--md-sys-color-error)",
          },
        ],
      })),
    )
    .catch((err) => {
      // try again with the next message that has maths
      loading.katex = false;
      console.error("[markdown] could not load maths", err);
    });
}

/** Download highlight.js for code blocks, if not already */
export function loadHighlight() {
  if (extras().highlight || loading.highlight) return;
  loading.highlight = true;

  Promise.all([import("rehype-highlight"), import("lowlight")])
    .then(([highlight, lowlight]) =>
      setExtras((e) => ({
        ...e,
        highlight: [highlight.default, { languages: lowlight.all }],
      })),
    )
    .catch((err) => {
      loading.highlight = false;
      console.error("[markdown] could not load code highlighting", err);
    });
}

type Node = { type: string; lang?: string | null; children?: Node[] };

/**
 * Which plugins a parsed Markdown tree needs
 * @param tree Markdown syntax tree (mdast)
 * @returns Whether it has code blocks with a language and/or maths
 */
export function neededExtras(tree: Node) {
  const needs = { katex: false, highlight: false };

  const walk = (node: Node) => {
    if (node.type === "math" || node.type === "inlineMath") needs.katex = true;
    // rehype-highlight only highlights blocks that name their language
    else if (node.type === "code" && node.lang) needs.highlight = true;
    node.children?.forEach(walk);
  };

  walk(tree);
  return needs;
}
