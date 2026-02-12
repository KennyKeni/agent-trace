export const PROVIDERS = ["cursor", "claude", "opencode"] as const;
export type Provider = (typeof PROVIDERS)[number];

export function isProvider(value: string): value is Provider {
  return PROVIDERS.includes(value as Provider);
}
