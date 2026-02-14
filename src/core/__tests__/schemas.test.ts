import { describe, expect, test } from "bun:test";
import {
  ContributorTypeSchema,
  RangeSchema,
  SPEC_VERSION,
  TraceRecordSchema,
} from "../schemas";

describe("SPEC_VERSION", () => {
  test("is two-part semver per spec regex", () => {
    expect(SPEC_VERSION).toMatch(/^\d+\.\d+$/);
  });

  test("is 0.1", () => {
    expect(SPEC_VERSION).toBe("0.1");
  });
});

describe("TraceRecordSchema version field", () => {
  test("accepts two-part version", () => {
    const base = {
      version: "0.1",
      id: "550e8400-e29b-41d4-a716-446655440000",
      timestamp: new Date().toISOString(),
      files: [],
    };
    const result = TraceRecordSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  test("rejects three-part version", () => {
    const base = {
      version: "0.1.0",
      id: "550e8400-e29b-41d4-a716-446655440000",
      timestamp: new Date().toISOString(),
      files: [],
    };
    const result = TraceRecordSchema.safeParse(base);
    expect(result.success).toBe(false);
  });
});

describe("RangeSchema", () => {
  test("accepts valid range", () => {
    const result = RangeSchema.safeParse({ start_line: 1, end_line: 5 });
    expect(result.success).toBe(true);
  });

  test("accepts start_line === end_line", () => {
    const result = RangeSchema.safeParse({ start_line: 3, end_line: 3 });
    expect(result.success).toBe(true);
  });

  test("rejects start_line > end_line", () => {
    const result = RangeSchema.safeParse({ start_line: 5, end_line: 3 });
    expect(result.success).toBe(false);
  });

  test("rejects start_line < 1", () => {
    const result = RangeSchema.safeParse({ start_line: 0, end_line: 5 });
    expect(result.success).toBe(false);
  });

  test("rejects end_line < 1", () => {
    const result = RangeSchema.safeParse({ start_line: 1, end_line: 0 });
    expect(result.success).toBe(false);
  });
});

describe("spec compliance — trace record structure", () => {
  function makeTraceRecord(overrides: Record<string, unknown> = {}) {
    return {
      version: SPEC_VERSION,
      id: "550e8400-e29b-41d4-a716-446655440000",
      timestamp: new Date().toISOString(),
      files: [],
      ...overrides,
    };
  }

  test("minimal valid record passes schema", () => {
    const result = TraceRecordSchema.safeParse(makeTraceRecord());
    expect(result.success).toBe(true);
  });

  test("record with vcs.revision and vcs.type passes", () => {
    const result = TraceRecordSchema.safeParse(
      makeTraceRecord({
        vcs: { type: "git", revision: "abc123def456" },
      }),
    );
    expect(result.success).toBe(true);
  });

  test("record with tool info passes", () => {
    const result = TraceRecordSchema.safeParse(
      makeTraceRecord({
        tool: { name: "claude-code", version: "1.0.0" },
      }),
    );
    expect(result.success).toBe(true);
  });

  test("record with file attribution and ranges passes", () => {
    const result = TraceRecordSchema.safeParse(
      makeTraceRecord({
        files: [
          {
            path: "src/index.ts",
            conversations: [
              {
                contributor: {
                  type: "ai",
                  model_id: "anthropic/claude-opus-4-5-20251101",
                },
                ranges: [
                  {
                    start_line: 1,
                    end_line: 10,
                    content_hash: "murmur3:abcd1234",
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  test("record with metadata passes", () => {
    const result = TraceRecordSchema.safeParse(
      makeTraceRecord({
        metadata: {
          "dev.agent-trace.source": "vcs_snapshot",
          "dev.agent-trace.attribution_confidence": "correlated",
          session_id: "sess-1",
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  test("contributor type must be valid enum", () => {
    expect(ContributorTypeSchema.safeParse("ai").success).toBe(true);
    expect(ContributorTypeSchema.safeParse("human").success).toBe(true);
    expect(ContributorTypeSchema.safeParse("mixed").success).toBe(true);
    expect(ContributorTypeSchema.safeParse("unknown").success).toBe(true);
    expect(ContributorTypeSchema.safeParse("bot").success).toBe(false);
  });

  test("range with contributor override passes", () => {
    const result = RangeSchema.safeParse({
      start_line: 1,
      end_line: 5,
      contributor: { type: "ai", model_id: "anthropic/claude-opus-4-6" },
    });
    expect(result.success).toBe(true);
  });

  test("file path must be a string (repo-relative)", () => {
    const result = TraceRecordSchema.safeParse(
      makeTraceRecord({
        files: [
          {
            path: "src/index.ts",
            conversations: [{ ranges: [] }],
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  test("rejects invalid UUID for id", () => {
    const result = TraceRecordSchema.safeParse(
      makeTraceRecord({ id: "not-a-uuid" }),
    );
    expect(result.success).toBe(false);
  });

  test("rejects invalid timestamp", () => {
    const result = TraceRecordSchema.safeParse(
      makeTraceRecord({ timestamp: "not-a-timestamp" }),
    );
    expect(result.success).toBe(false);
  });
});
