import { PassThrough } from "stream";
import type { Client } from "ssh2";
import { describe, expect, it, vi } from "vitest";

const openCloudflareTunnel = vi.hoisted(() => vi.fn());
vi.mock("../../../hosts/cloudflare-tunnel.js", () => ({
  openCloudflareTunnel,
}));

import {
  cloudflareTunnelPing,
  tcpPingThroughJumpHost,
} from "../../../hosts/status/tcp-ping.js";

describe("cloudflareTunnelPing", () => {
  it("is online once sshd answers through the tunnel, and replies to it", async () => {
    const stream = new PassThrough();
    const end = vi.spyOn(stream, "end");
    openCloudflareTunnel.mockResolvedValueOnce(stream);
    const result = cloudflareTunnelPing("ssh.example.com");
    await vi.waitFor(() => expect(stream.listenerCount("data")).toBe(1));
    stream.emit("data", Buffer.from("SSH-2.0-OpenSSH_9.6\r\n"));
    await expect(result).resolves.toBe(true);
    expect(end).toHaveBeenCalledWith("SSH-2.0-TermixHealthCheck\r\n");
  });

  it("is offline when the tunnel closes before sshd answers", async () => {
    const stream = new PassThrough();
    openCloudflareTunnel.mockResolvedValueOnce(stream);
    const result = cloudflareTunnelPing("ssh.example.com");
    await vi.waitFor(() => expect(stream.listenerCount("close")).toBe(1));
    stream.emit("close");
    await expect(result).resolves.toBe(false);
  });

  it("is offline when the tunnel cannot be opened", async () => {
    openCloudflareTunnel.mockRejectedValueOnce(new Error("502"));
    await expect(cloudflareTunnelPing("ssh.example.com")).resolves.toBe(false);
  });
});

describe("tcpPingThroughJumpHost", () => {
  it("reports the final destination online when forwarding succeeds", async () => {
    const stream = { destroy: vi.fn() };
    const jumpClient = {
      end: vi.fn(),
      forwardOut: vi.fn((_src, _srcPort, host, port, callback) => {
        expect(host).toBe("private.example");
        expect(port).toBe(22);
        callback(undefined, stream);
      }),
    } as unknown as Pick<Client, "forwardOut" | "end">;

    await expect(
      tcpPingThroughJumpHost(jumpClient, "private.example", 22),
    ).resolves.toBe(true);
    expect(stream.destroy).toHaveBeenCalledOnce();
    expect(jumpClient.end).toHaveBeenCalledOnce();
  });

  it("reports the final destination offline when forwarding fails", async () => {
    const jumpClient = {
      end: vi.fn(),
      forwardOut: vi.fn((_src, _srcPort, _host, _port, callback) => {
        callback(new Error("Connection refused"));
      }),
    } as unknown as Pick<Client, "forwardOut" | "end">;

    await expect(
      tcpPingThroughJumpHost(jumpClient, "private.example", 22),
    ).resolves.toBe(false);
    expect(jumpClient.end).toHaveBeenCalledOnce();
  });

  it("reports the final destination offline when forwarding times out", async () => {
    vi.useFakeTimers();
    const jumpClient = {
      end: vi.fn(),
      forwardOut: vi.fn(),
    } as unknown as Pick<Client, "forwardOut" | "end">;

    const result = tcpPingThroughJumpHost(
      jumpClient,
      "private.example",
      22,
      5000,
    );
    await vi.advanceTimersByTimeAsync(5000);

    await expect(result).resolves.toBe(false);
    expect(jumpClient.end).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
