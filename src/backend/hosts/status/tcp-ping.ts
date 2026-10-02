import net from "net";
import type { Client } from "ssh2";
import { openCloudflareTunnel } from "../cloudflare-tunnel.js";

/**
 * Opens a TCP connection and closes it again. An SSH server gets a polite
 * banner back so it does not log a failed handshake.
 */
export function tcpPing(
  host: string,
  port: number,
  timeoutMs = 5000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const cleanup = () => {
      try {
        socket.destroy();
      } catch {
        // expected
      }
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      const dataTimeout = setTimeout(() => {
        cleanup();
        finish(true);
      }, 2000);

      socket.once("data", (data) => {
        clearTimeout(dataTimeout);
        if (data.toString("utf8").startsWith("SSH-")) {
          try {
            socket.end("SSH-2.0-TermixHealthCheck\r\n");
          } catch {
            // expected
          }
          setTimeout(cleanup, 200);
        } else {
          cleanup();
        }
        finish(true);
      });
    });

    socket.once("timeout", () => {
      cleanup();
      finish(false);
    });
    socket.once("error", () => {
      cleanup();
      finish(false);
    });
    socket.connect(port, host);
  });
}

/**
 * The same check through a Cloudflare Tunnel hostname: the WebSocket only
 * opens once the tunnel has reached sshd. Answers the banner like tcpPing.
 */
export async function cloudflareTunnelPing(
  hostname: string,
  timeoutMs = 5000,
): Promise<boolean> {
  let stream: Awaited<ReturnType<typeof openCloudflareTunnel>>;
  try {
    stream = await openCloudflareTunnel(hostname, timeoutMs);
  } catch {
    return false;
  }
  stream.on("error", () => {
    // expected: the probe hangs up mid-handshake
  });
  const dataTimeout = setTimeout(() => stream.destroy(), 2000);
  stream.once("data", (data: Buffer) => {
    clearTimeout(dataTimeout);
    if (data.toString("utf8").startsWith("SSH-")) {
      stream.end("SSH-2.0-TermixHealthCheck\r\n");
    }
    setTimeout(() => stream.destroy(), 200);
  });
  return true;
}

/** The same check from the far end of a jump host chain. Ends the chain. */
export function tcpPingThroughJumpHost(
  jumpClient: Pick<Client, "forwardOut" | "end">,
  host: string,
  port: number,
  timeoutMs = 5000,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      jumpClient.end();
      resolve(result);
    };

    const timeout = setTimeout(() => finish(false), timeoutMs);

    jumpClient.forwardOut("127.0.0.1", 0, host, port, (error, stream) => {
      stream?.destroy();
      finish(!error && !!stream);
    });
  });
}
