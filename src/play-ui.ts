// `type: "text"` makes this the file's contents; bun-types types `*.html` as a bundle.
import playerBundle from "./player.html" with { type: "text" };
import { parsePlayableCases } from "./play.ts";

const playerHtml = playerBundle as unknown as string;

// Serves the browser player and one report on localhost. `/` redirects to the
// player with the report preloaded (`/?report=/report.json`).
export const serveReportUI = (reportText: string, { port = 0 }: { port?: number } = {}) => {
  parsePlayableCases(reportText); // fail early, before opening a port
  return Bun.serve({
    hostname: "localhost",
    port,
    routes: {
      "/": (req) => {
        const url = new URL(req.url);
        if (url.searchParams.has("report")) {
          return new Response(playerHtml, {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        return Response.redirect(`${url.origin}/?report=/report.json`, 302);
      },
      "/report.json": () =>
        new Response(reportText, { headers: { "content-type": "application/json" } }),
    },
  });
};
