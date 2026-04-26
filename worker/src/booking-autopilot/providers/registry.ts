import type { BrowserProvider } from "./types";

const providers: BrowserProvider[] = [];

export function registerProvider(provider: BrowserProvider): void {
  providers.push(provider);
}

export function getProvider(url: string): BrowserProvider | null {
  return providers.find((p) => p.matchesUrl(url)) ?? null;
}

export function requireProvider(url: string): BrowserProvider {
  const provider = getProvider(url);
  if (!provider) {
    throw new Error(`No provider found for URL: ${url}`);
  }
  return provider;
}
