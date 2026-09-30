import { Readable, Transform, type Writable } from "node:stream";
import { finished } from "node:stream/promises";

export type CaptureStream = "stdout" | "stderr";

export type CaptureChunk = {
  // Milliseconds since `startAt` when the chunk was received.
  elapse: number;
  stream: CaptureStream;
  // The raw bytes of the chunk, one number (0-255) per byte.
  buffer: number[];
};

export type Capture = {
  // Epoch milliseconds when the capture started.
  startAt: number;
  chunks: CaptureChunk[];
};

// Records everything the scripts of one case write to the console, byte by
// byte and with timing, while still forwarding it untouched.
export class ConsoleCapture {
  readonly startAt = Date.now();
  readonly chunks: CaptureChunk[] = [];
  private readonly startedAt = performance.now();

  // A transform that records each chunk it sees and passes it through.
  transform(stream: CaptureStream): Transform {
    return new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        this.chunks.push({
          elapse: Math.round((performance.now() - this.startedAt) * 1000) / 1000,
          stream,
          buffer: [...chunk],
        });
        callback(null, chunk);
      },
    });
  }

  // `readable.pipe(transform).pipe(destination)`; resolves once the readable
  // has been fully written to `destination` (which is left open).
  async pipe(source: ReadableStream<Uint8Array>, stream: CaptureStream, destination: Writable) {
    const transform = this.transform(stream);
    Readable.fromWeb(source as import("node:stream/web").ReadableStream)
      .pipe(transform)
      .pipe(destination, { end: false });
    await finished(transform);
  }

  toJSON(): Capture {
    return { startAt: this.startAt, chunks: this.chunks };
  }
}
