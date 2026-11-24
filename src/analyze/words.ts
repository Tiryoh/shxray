import type { Node, Word } from "sh-syntax";

import { type SourceMap } from "./source.ts";

export function displayWord(
  source: SourceMap,
  word: { start: number; end: number },
): string {
  const text = source.slice(word.start, word.end);
  if (text.length >= 2) {
    const quote = text[0];
    if ((quote === '"' || quote === "'") && text.endsWith(quote)) {
      return text.slice(1, -1);
    }
  }
  return text;
}

/** Text of a word when it contains no expansions. */
export function staticText(node: Node | null | undefined): string | null {
  if (!node) return null;
  switch (node.type) {
    case "Lit":
    case "SglQuoted":
      return node.value;
    case "DblQuoted": {
      let value = "";
      for (const part of node.parts) {
        const text = staticText(part);
        if (text === null) return null;
        value += text;
      }
      return value;
    }
    case "Word": {
      let value = "";
      for (const part of node.parts) {
        const text = staticText(part);
        if (text === null) return null;
        value += text;
      }
      return value;
    }
    default:
      return null;
  }
}

export function argvOf(source: SourceMap, words: Word[]): string[] {
  return words.map((word) => displayWord(source, word));
}
