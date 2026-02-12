import { describe, expect, it } from "bun:test";
import { streamLines } from "../stream";

function makeStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function makeChunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("streamLines", () => {
  it("processes complete lines", async () => {
    const lines: string[] = [];
    await streamLines(makeStream("line1\nline2\nline3\n"), (l) =>
      lines.push(l),
    );
    expect(lines).toEqual(["line1", "line2", "line3"]);
  });

  it("handles trailing content without newline", async () => {
    const lines: string[] = [];
    await streamLines(makeStream("line1\nline2"), (l) => lines.push(l));
    expect(lines).toEqual(["line1", "line2"]);
  });

  it("handles lines split across chunks", async () => {
    const lines: string[] = [];
    await streamLines(makeChunkedStream(["hel", "lo\nwor", "ld\n"]), (l) =>
      lines.push(l),
    );
    expect(lines).toEqual(["hello", "world"]);
  });

  it("skips empty lines", async () => {
    const lines: string[] = [];
    await streamLines(makeStream("a\n\n\nb\n"), (l) => lines.push(l));
    expect(lines).toEqual(["a", "b"]);
  });

  it("handles empty stream", async () => {
    const lines: string[] = [];
    await streamLines(makeStream(""), (l) => lines.push(l));
    expect(lines).toEqual([]);
  });
});
