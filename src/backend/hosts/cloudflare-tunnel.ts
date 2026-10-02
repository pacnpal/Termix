/**
 * SSH through a Cloudflare Tunnel public hostname (an `ssh://` tunnel route).
 *
 * Cloudflare's edge does not take raw TCP on port 22 for a proxied hostname,
 * so a plain connection just times out. `cloudflared access ssh` instead
 * opens a WebSocket to https://<hostname> and carries the SSH bytes in binary
 * frames; the tunnel turns them back into a TCP connection to sshd. This does
 * the same, so no cloudflared binary is needed on the Termix server.
 */

import type { Duplex } from "stream";
import WebSocket, { createWebSocketStream } from "ws";

export function openCloudflareTunnel(
  hostname: string,
  // connectHost's own default; its timer only starts once this has opened.
  timeoutMs = 30000,
): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${hostname}`, {
      handshakeTimeout: timeoutMs,
    });
    ws.once("open", () => {
      ws.off("error", onError);
      resolve(createWebSocketStream(ws));
    });
    // A failed connect to several addresses is an AggregateError with
    // only a code.
    const onError = (error: NodeJS.ErrnoException) =>
      reject(
        new Error(
          `Cloudflare Tunnel connection to ${hostname} failed: ${error.message || error.code}`,
          { cause: error },
        ),
      );
    ws.once("error", onError);
  });
}
