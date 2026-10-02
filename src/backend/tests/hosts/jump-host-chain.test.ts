import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveHostById: vi.fn(),
  openCloudflareTunnel: vi.fn(),
  createSocks5Connection: vi.fn(),
}));

vi.mock("ssh2", () => ({
  Client: class extends EventEmitter {
    connectConfig?: Record<string, unknown>;
    connect(config: Record<string, unknown>) {
      this.connectConfig = config;
      setImmediate(() => this.emit("ready"));
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
  buildConnectConfig: async () => ({
    outcome: { status: "ready" },
    config: {},
  }),
}));

import { createJumpHostChain } from "../../hosts/jump-host-chain.js";

beforeEach(() => vi.clearAllMocks());

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
});
