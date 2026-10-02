import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveHostById: vi.fn(),
  openCloudflareTunnel: vi.fn(),
  createSocks5Connection: vi.fn(),
  buildConnectConfig: vi.fn(),
}));

vi.mock("ssh2", () => ({
  Client: class extends EventEmitter {
    connectConfig?: Record<string, unknown>;
    connect(config: Record<string, unknown>) {
      this.connectConfig = config;
      setImmediate(() => this.emit("ready"));
    }
    forwardOut(
      _src: string,
      _srcPort: number,
      host: string,
      port: number,
      callback: (err: Error | undefined, stream: unknown) => void,
    ) {
      callback(undefined, { forwardedTo: `${host}:${port}` });
    }
    end() {}
  },
}));
vi.mock("../../hosts/host-resolver.js", () => ({
  resolveHostById: mocks.resolveHostById,
}));
vi.mock("../../hosts/cloudflare-tunnel.js", () => ({
  openCloudflareTunnel: mocks.openCloudflareTunnel,
}));
vi.mock("../../utils/socks5-helper.js", () => ({
  createSocks5Connection: mocks.createSocks5Connection,
}));
vi.mock("../../hosts/connect/build-connect-config.js", () => ({
  buildConnectConfig: async () => mocks.buildConnectConfig(),
}));

import { createJumpHostChain } from "../../hosts/jump-host-chain.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildConnectConfig.mockReturnValue({
    outcome: { status: "ready" },
    config: {},
  });
});

describe("createJumpHostChain", () => {
  it("reaches a first hop through its Cloudflare Tunnel", async () => {
    mocks.resolveHostById.mockResolvedValueOnce({
      id: 2,
      ip: "ssh-a.example.com",
      port: 22,
      username: "root",
      sshOptions: { cloudflareTunnel: true },
      useSocks5: true,
      socks5Host: "proxy",
      socks5Port: 1080,
    });
    mocks.openCloudflareTunnel.mockResolvedValueOnce({ tunneled: true });

    const client = (await createJumpHostChain([{ hostId: 2 }], "owner-1")) as
      (EventEmitter & { connectConfig?: Record<string, unknown> }) | null;

    expect(mocks.openCloudflareTunnel).toHaveBeenCalledWith(
      "ssh-a.example.com",
    );
    expect(mocks.createSocks5Connection).not.toHaveBeenCalled();
    expect(client?.connectConfig?.sock).toEqual({ tunneled: true });
  });

  it("reaches a later tunnel hop on 443 through the hop before it", async () => {
    mocks.resolveHostById
      .mockResolvedValueOnce({
        id: 1,
        ip: "10.0.0.1",
        port: 22,
        username: "root",
      })
      .mockResolvedValueOnce({
        id: 2,
        ip: "ssh-b.example.com",
        port: 22,
        username: "root",
        sshOptions: { cloudflareTunnel: true },
      });
    mocks.openCloudflareTunnel.mockResolvedValueOnce({ tunneled: true });

    const client = (await createJumpHostChain(
      [{ hostId: 1 }, { hostId: 2 }],
      "owner-1",
    )) as (EventEmitter & { connectConfig?: Record<string, unknown> }) | null;

    expect(mocks.openCloudflareTunnel).toHaveBeenCalledWith(
      "ssh-b.example.com",
      undefined,
      { forwardedTo: "ssh-b.example.com:443" },
    );
    expect(client?.connectConfig?.sock).toEqual({ tunneled: true });
  });

  it("closes a first hop's tunnel when the hop fails before connecting", async () => {
    mocks.resolveHostById.mockResolvedValueOnce({
      id: 2,
      ip: "ssh-a.example.com",
      port: 22,
      username: "root",
      sshOptions: { cloudflareTunnel: true },
    });
    const tunnel = { destroy: vi.fn() };
    mocks.openCloudflareTunnel.mockResolvedValueOnce(tunnel);
    mocks.buildConnectConfig.mockReturnValueOnce({
      outcome: { status: "error", message: "no credentials" },
      config: {},
    });

    await expect(
      createJumpHostChain([{ hostId: 2 }], "owner-1"),
    ).rejects.toThrow("no credentials");
    expect(tunnel.destroy).toHaveBeenCalledOnce();
  });
});
