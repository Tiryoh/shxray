/** Byte-oriented view of a shell script. Parser offsets are UTF-8 bytes. */
export class SourceMap {
  readonly bytes: Uint8Array;
  private readonly lineStarts: number[];

  constructor(readonly text: string) {
    this.bytes = new TextEncoder().encode(text);
    const starts = [0];
    for (let index = 0; index < this.bytes.length; index++) {
      if (this.bytes[index] === 10) starts.push(index + 1);
    }
    this.lineStarts = starts;
  }

  lineCount(): number {
    if (this.bytes.length === 0) return 0;
    const endsWithNewline = this.bytes[this.bytes.length - 1] === 10;
    return endsWithNewline
      ? this.lineStarts.length - 1
      : this.lineStarts.length;
  }

  slice(start: number, end: number): string {
    const from = clamp(start, 0, this.bytes.length);
    const to = clamp(end, from, this.bytes.length);
    return new TextDecoder().decode(this.bytes.subarray(from, to));
  }

  location(offset: number): { line: number; column: number } {
    const clamped = clamp(offset, 0, this.bytes.length);
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      const start = this.lineStarts[mid] ?? 0;
      if (start <= clamped) low = mid;
      else high = mid - 1;
    }
    const lineStart = this.lineStarts[low] ?? 0;
    return { line: low + 1, column: clamped - lineStart + 1 };
  }

  lineText(line: number): string {
    if (line < 1 || line > this.lineStarts.length) return "";
    const start = this.lineStarts[line - 1] ?? 0;
    const next = this.lineStarts[line];
    const end = next === undefined
      ? this.bytes.length
      : Math.max(start, next - 1);
    const text = new TextDecoder().decode(this.bytes.subarray(start, end))
      .replace(
        /\r$/,
        "",
      );
    return clip(text.trimEnd(), 200);
  }
}

export function oneLine(source: SourceMap, start: number, end: number): string {
  return clip(source.slice(start, end).replace(/\s+/g, " ").trim(), 200);
}

export function shebangOf(text: string): string | null {
  if (!text.startsWith("#!")) return null;
  const line = text.split("\n", 1)[0] ?? "";
  return clip(line, 200);
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
