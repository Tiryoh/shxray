/** Render source text without letting it change the terminal. */
export function escapeControls(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    out += char;
  }
  return out;
}
