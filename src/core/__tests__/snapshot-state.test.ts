import { describe, expect, it } from "bun:test";
import { existsSync, utimesSync } from "node:fs";
import {
  deletePreSnapshot,
  type FifoEntry,
  fallbackSessionKey,
  fifoPop,
  fifoPush,
  gcStaleSnapshots,
  loadPreSnapshot,
  savePreSnapshot,
} from "../snapshot-state";

describe("snapshot-state", () => {
  const fakeRoot = "/tmp/test-repo-snapshot-state";

  describe("savePreSnapshot / loadPreSnapshot", () => {
    it("saves and loads pre-snapshot state", () => {
      const path = savePreSnapshot({
        repoRoot: fakeRoot,
        provider: "claude",
        sessionId: "session-1",
        toolCallId: "call-1",
        preTree: "abc123",
        vcs: "git",
      });
      expect(existsSync(path)).toBe(true);

      const state = loadPreSnapshot(fakeRoot, "claude", "session-1", "call-1");
      expect(state).toBeDefined();
      expect(state?.preTree).toBe("abc123");
      expect(state?.provider).toBe("claude");
      expect(state?.sessionId).toBe("session-1");
      expect(state?.toolCallId).toBe("call-1");
      expect(state?.vcs).toBe("git");
      expect(state?.pid).toBe(process.pid);

      deletePreSnapshot(path);
    });

    it("returns undefined for missing state", () => {
      const state = loadPreSnapshot(fakeRoot, "claude", "nonexistent", "none");
      expect(state).toBeUndefined();
    });

    it("isolates different providers", () => {
      const path1 = savePreSnapshot({
        repoRoot: fakeRoot,
        provider: "claude",
        sessionId: "session-x",
        toolCallId: "call-x",
        preTree: "tree1",
        vcs: "git",
      });
      const path2 = savePreSnapshot({
        repoRoot: fakeRoot,
        provider: "cursor",
        sessionId: "session-x",
        toolCallId: "call-x",
        preTree: "tree2",
        vcs: "git",
      });

      const state1 = loadPreSnapshot(fakeRoot, "claude", "session-x", "call-x");
      const state2 = loadPreSnapshot(fakeRoot, "cursor", "session-x", "call-x");
      expect(state1?.preTree).toBe("tree1");
      expect(state2?.preTree).toBe("tree2");

      deletePreSnapshot(path1);
      deletePreSnapshot(path2);
    });

    it("handles special characters in session/call IDs via base64url", () => {
      const path = savePreSnapshot({
        repoRoot: fakeRoot,
        provider: "claude",
        sessionId: "session/with/slashes",
        toolCallId: "call+with+plus",
        preTree: "treeSha",
        vcs: "git",
      });
      expect(existsSync(path)).toBe(true);
      expect(path).not.toContain("session/with/slashes");

      const state = loadPreSnapshot(
        fakeRoot,
        "claude",
        "session/with/slashes",
        "call+with+plus",
      );
      expect(state?.preTree).toBe("treeSha");
      expect(state?.sessionId).toBe("session/with/slashes");
      expect(state?.toolCallId).toBe("call+with+plus");

      deletePreSnapshot(path);
    });
  });

  describe("deletePreSnapshot", () => {
    it("removes the file", () => {
      const path = savePreSnapshot({
        repoRoot: fakeRoot,
        provider: "claude",
        sessionId: "del-session",
        toolCallId: "del-call",
        preTree: "tree",
        vcs: "git",
      });
      expect(existsSync(path)).toBe(true);
      deletePreSnapshot(path);
      expect(existsSync(path)).toBe(false);
    });

    it("does not throw for missing file", () => {
      expect(() => deletePreSnapshot("/nonexistent/path")).not.toThrow();
    });
  });

  describe("gcStaleSnapshots", () => {
    it("removes stale files", () => {
      const path = savePreSnapshot({
        repoRoot: fakeRoot,
        provider: "claude",
        sessionId: "gc-session",
        toolCallId: "gc-call",
        preTree: "tree",
        vcs: "git",
      });

      const oldTime = new Date(Date.now() - 200_000);
      utimesSync(path, oldTime, oldTime);
      gcStaleSnapshots(fakeRoot, 100_000);
      expect(existsSync(path)).toBe(false);
    });

    it("keeps fresh files", () => {
      const path = savePreSnapshot({
        repoRoot: fakeRoot,
        provider: "claude",
        sessionId: "fresh-session",
        toolCallId: "fresh-call",
        preTree: "tree",
        vcs: "git",
      });

      gcStaleSnapshots(fakeRoot, 86_400_000);
      expect(existsSync(path)).toBe(true);
      deletePreSnapshot(path);
    });
  });

  describe("FIFO queue", () => {
    const provider = "claude";
    const sessionId = "fifo-session";

    it("push and pop in FIFO order", async () => {
      const entry1: FifoEntry = {
        preTree: "tree1",
        executionId: "exec-1",
        createdAt: Date.now(),
        pid: process.pid,
        provider,
      };
      const entry2: FifoEntry = {
        preTree: "tree2",
        executionId: "exec-2",
        createdAt: Date.now(),
        pid: process.pid,
        provider,
      };

      expect(await fifoPush(fakeRoot, provider, sessionId, entry1)).toBe(true);
      expect(await fifoPush(fakeRoot, provider, sessionId, entry2)).toBe(true);

      const popped1 = await fifoPop(fakeRoot, provider, sessionId);
      expect(popped1).toBeDefined();
      expect(popped1?.preTree).toBe("tree1");
      expect(popped1?.executionId).toBe("exec-1");

      const popped2 = await fifoPop(fakeRoot, provider, sessionId);
      expect(popped2).toBeDefined();
      expect(popped2?.preTree).toBe("tree2");
      expect(popped2?.executionId).toBe("exec-2");

      const popped3 = await fifoPop(fakeRoot, provider, sessionId);
      expect(popped3).toBeUndefined();
    });

    it("discards stale entries on pop", async () => {
      const staleEntry: FifoEntry = {
        preTree: "stale",
        executionId: "exec-stale",
        createdAt: 0,
        pid: process.pid,
        provider,
      };
      const freshEntry: FifoEntry = {
        preTree: "fresh",
        executionId: "exec-fresh",
        createdAt: Date.now(),
        pid: process.pid,
        provider,
      };

      await fifoPush(fakeRoot, provider, "stale-session", staleEntry);
      await fifoPush(fakeRoot, provider, "stale-session", freshEntry);

      const popped = await fifoPop(fakeRoot, provider, "stale-session");
      expect(popped).toBeDefined();
      expect(popped?.preTree).toBe("fresh");
    });

    it("returns undefined for empty queue", async () => {
      expect(
        await fifoPop(fakeRoot, provider, "empty-session"),
      ).toBeUndefined();
    });
  });

  describe("fallbackSessionKey", () => {
    it("generates deterministic key", () => {
      const key1 = fallbackSessionKey("claude", "/repo");
      const key2 = fallbackSessionKey("claude", "/repo");
      expect(key1).toBe(key2);
    });

    it("differs by provider", () => {
      const key1 = fallbackSessionKey("claude", "/repo");
      const key2 = fallbackSessionKey("cursor", "/repo");
      expect(key1).not.toBe(key2);
    });

    it("differs by repo root", () => {
      const key1 = fallbackSessionKey("claude", "/repo-a");
      const key2 = fallbackSessionKey("claude", "/repo-b");
      expect(key1).not.toBe(key2);
    });

    it("does not include process.pid (stable across processes)", () => {
      const key = fallbackSessionKey("claude", "/repo");
      expect(key).not.toContain(String(process.pid));
    });
  });
});
