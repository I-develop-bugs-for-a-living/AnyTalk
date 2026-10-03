import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

import { neededExtras } from "./extras";

// parses like the message pipeline in ./index.tsx
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath, { singleDollarTextMath: false });

const needs = (text: string) => neededExtras(parser.parse(text) as never);

describe("neededExtras", () => {
  it("needs nothing for plain messages", () => {
    expect(needs("hello **world** `inline code`")).toEqual({
      katex: false,
      highlight: false,
    });
  });

  it("needs highlighting only for code blocks naming a language", () => {
    expect(needs("```\nplain\n```").highlight).toBe(false);
    expect(needs("```ts\nconst a = 1;\n```").highlight).toBe(true);
  });

  it("needs maths for $$ blocks and inline maths", () => {
    expect(needs("$$\nx^2\n$$")).toEqual({ katex: true, highlight: false });
    expect(needs("area $$\\pi r^2$$ here").katex).toBe(true);
  });
});
