import type { Extension, ProviderAdapter } from "./types";

const providerRegistry = new Map<string, ProviderAdapter>();

export function registerProvider(name: string, adapter: ProviderAdapter): void {
  providerRegistry.set(name, adapter);
}

export function getProvider(name: string): ProviderAdapter | undefined {
  return providerRegistry.get(name);
}

export function registeredProviderNames(): string[] {
  return [...providerRegistry.keys()];
}

const extensionRegistry = new Map<string, Extension>();

export function registerExtension(ext: Extension): void {
  extensionRegistry.set(ext.name, ext);
}

export function activeExtensions(extensionNames: string[] | null): Extension[] {
  if (extensionNames === null) return [...extensionRegistry.values()];

  const active: Extension[] = [];
  for (const name of extensionNames) {
    const ext = extensionRegistry.get(name);
    if (ext) {
      active.push(ext);
    } else {
      console.error(`agent-trace: unknown extension "${name}", skipping`);
    }
  }
  return active;
}

export function _resetRegistries(): void {
  providerRegistry.clear();
  extensionRegistry.clear();
}
