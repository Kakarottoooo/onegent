import type { Page } from "playwright";

export interface ProviderStageSignals {
  searchResults: boolean;
  hotelDetail: boolean;
  guestDetailsStep: boolean;
  paymentStep: boolean;
}

export interface PaymentFillResult {
  name?: boolean;
  number?: boolean;
  expiry?: boolean;
  zip?: boolean;
  agreed?: boolean;
}

export interface BrowserProvider {
  id: string;
  matchesUrl(url: string): boolean;
  setup?(page: Page, context: unknown, trace: (msg: string) => void): Promise<void>;
  getStageSignals(page: Page, url: string, text: string): Promise<ProviderStageSignals>;
  fillGuestForm?(page: Page, profile: unknown, helpers: unknown, trace: (msg: string) => void): Promise<void>;
  fillPaymentForm?(page: Page, profile: unknown, helpers: unknown, trace: (msg: string) => void): Promise<void | PaymentFillResult>;
  getBotPatterns?(): string[];
}
