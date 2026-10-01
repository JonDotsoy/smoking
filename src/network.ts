import { result } from "./utils/result.ts";

// One HTTP request a script made, merged from the `Network.*` events of
// `node:inspector` (see network-preload.mjs).
export type NetworkRequest = {
  phase: "setup" | "run" | "teardown";
  // Script file path as run: inline scripts live in the scratch directory.
  script: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  // Request body; only with the bun runtime (node's inspector does not report it).
  postData?: string;
  // Epoch ms when the request started.
  startedAt?: number;
  // Ms from the start of the request until the response finished.
  duration?: number;
  status?: number;
  statusText?: string;
  mimeType?: string;
  responseHeaders?: Record<string, string>;
  // Message of the failure, when the request failed.
  error?: string;
};

type Event = { method: string; params: Record<string, any> };

// Reads the events a script recorded and merges them by request, in the order
// the requests started. Missing file (no requests) gives an empty list.
export const readNetwork = async (
  file: string,
  phase: NetworkRequest["phase"],
  script: string,
): Promise<NetworkRequest[]> => {
  const [read, , text] = await result(async () => {
    const source = Bun.file(file);
    return (await source.exists()) ? await source.text() : "";
  });
  if (!read) return [];

  const requests = new Map<string, NetworkRequest & { sentAt?: number }>();
  for (const line of text.split("\n")) {
    if (!line) continue;
    const [parsed, , event] = result(() => JSON.parse(line) as Event);
    if (!parsed) continue;
    const { requestId, request, response, timestamp, wallTime, errorText } = event.params;
    const entry = requests.get(requestId);

    if (event.method === "Network.requestWillBeSent") {
      requests.set(requestId, {
        phase,
        script,
        method: request.method,
        url: request.url,
        requestHeaders: request.headers ?? {},
        ...(request.postData === undefined ? {} : { postData: request.postData }),
        ...(wallTime === undefined ? {} : { startedAt: Math.round(wallTime * 1000) }),
        sentAt: timestamp,
      });
    } else if (!entry) {
      continue;
    } else if (event.method === "Network.responseReceived") {
      entry.status = response.status;
      entry.statusText = response.statusText;
      entry.mimeType = response.mimeType;
      entry.responseHeaders = response.headers;
    } else if (event.method === "Network.loadingFinished" && entry.sentAt !== undefined) {
      entry.duration = Math.round((timestamp - entry.sentAt) * 1000);
    } else if (event.method === "Network.loadingFailed") {
      entry.error = errorText;
    }
  }
  return [...requests.values()].map(({ sentAt: _sentAt, ...request }) => request);
};
