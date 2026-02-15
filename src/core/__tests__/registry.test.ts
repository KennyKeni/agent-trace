import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  _resetRegistries,
  activeExtensions,
  getProvider,
  registerExtension,
  registeredProviderNames,
  registerProvider,
} from "../registry";
import type { Extension, ProviderAdapter } from "../types";

let errSpy: ReturnType<typeof spyOn>;

afterEach(() => {
  _resetRegistries();
  errSpy?.mockRestore();
});

function stubAdapter(): ProviderAdapter {
  return {
    adapt: () => undefined,
    sessionIdFor: () => undefined,
  };
}

function stubExtension(name: string): Extension {
  return { name };
}

describe("provider registry", () => {
  test("registerProvider + getProvider round-trips", () => {
    const adapter = stubAdapter();
    registerProvider("test-provider", adapter);
    expect(getProvider("test-provider")).toBe(adapter);
  });

  test("getProvider returns undefined for unknown name", () => {
    expect(getProvider("nonexistent")).toBeUndefined();
  });

  test("registeredProviderNames returns all registered names", () => {
    registerProvider("alpha", stubAdapter());
    registerProvider("beta", stubAdapter());
    expect(registeredProviderNames()).toEqual(["alpha", "beta"]);
  });

  test("registeredProviderNames returns empty array when none registered", () => {
    expect(registeredProviderNames()).toEqual([]);
  });

  test("duplicate registerProvider overwrites previous adapter", () => {
    const first = stubAdapter();
    const second = stubAdapter();
    registerProvider("dup", first);
    registerProvider("dup", second);
    expect(getProvider("dup")).toBe(second);
    expect(registeredProviderNames()).toEqual(["dup"]);
  });
});

describe("extension registry", () => {
  test("activeExtensions(null) returns all registered extensions", () => {
    const ext1 = stubExtension("ext-a");
    const ext2 = stubExtension("ext-b");
    registerExtension(ext1);
    registerExtension(ext2);

    const result = activeExtensions(null);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(ext1);
    expect(result[1]).toBe(ext2);
  });

  test("activeExtensions with specific names returns matching subset", () => {
    const ext1 = stubExtension("diffs");
    const ext2 = stubExtension("messages");
    const ext3 = stubExtension("line-hashes");
    registerExtension(ext1);
    registerExtension(ext2);
    registerExtension(ext3);

    const result = activeExtensions(["messages", "diffs"]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(ext2);
    expect(result[1]).toBe(ext1);
  });

  test("activeExtensions with unknown name logs error and skips", () => {
    const ext1 = stubExtension("diffs");
    registerExtension(ext1);

    errSpy = spyOn(console, "error").mockImplementation(() => {});
    const result = activeExtensions(["diffs", "nonexistent"]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(ext1);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0]?.[0])).toMatch(
      /unknown extension "nonexistent"/,
    );
  });

  test("activeExtensions with all unknown names returns empty and logs for each", () => {
    errSpy = spyOn(console, "error").mockImplementation(() => {});
    const names = ["nope1", "nope2", "nope3"];
    const result = activeExtensions(names);

    expect(result).toEqual([]);
    expect(errSpy).toHaveBeenCalledTimes(3);
    for (let i = 0; i < names.length; i++) {
      expect(String(errSpy.mock.calls[i]?.[0])).toContain(names[i] as string);
    }
  });

  test("activeExtensions with empty array returns empty", () => {
    registerExtension(stubExtension("diffs"));
    expect(activeExtensions([])).toEqual([]);
  });

  test("duplicate registerExtension overwrites previous extension", () => {
    const first = stubExtension("diffs");
    const second = stubExtension("diffs");
    registerExtension(first);
    registerExtension(second);

    const result = activeExtensions(null);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(second);
  });

  test("duplicate requested extension names returns duplicates", () => {
    const ext = stubExtension("diffs");
    registerExtension(ext);

    const result = activeExtensions(["diffs", "diffs"]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(ext);
    expect(result[1]).toBe(ext);
  });
});

describe("_resetRegistries", () => {
  test("clears both registries", () => {
    registerProvider("test", stubAdapter());
    registerExtension(stubExtension("ext"));

    _resetRegistries();

    expect(getProvider("test")).toBeUndefined();
    expect(registeredProviderNames()).toEqual([]);
    expect(activeExtensions(null)).toEqual([]);
  });
});
