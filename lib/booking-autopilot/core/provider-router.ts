import { isBookingComUrl } from "../providers/booking-com";

export type ProviderId = "booking-com" | "generic-ai";

export function resolveProviderIdForUrl(url: string): ProviderId {
  return isBookingComUrl(url) ? "booking-com" : "generic-ai";
}

export function isProviderContext(params: {
  providerId: ProviderId;
  urls: Array<string | undefined | null>;
}): boolean {
  const urls = params.urls.filter((value): value is string => !!value);

  switch (params.providerId) {
    case "booking-com":
      return urls.some((url) => isBookingComUrl(url));
    case "generic-ai":
    default:
      return false;
  }
}

export function resolveProviderContext(params: {
  startUrl?: string;
  currentUrl?: string;
  rawPageUrl?: string;
  openPageUrls?: Array<string | undefined | null>;
}): {
  providerId: ProviderId;
  bookingComContext: boolean;
} {
  const urls = [
    params.startUrl,
    params.currentUrl,
    params.rawPageUrl,
    ...(params.openPageUrls ?? []),
  ];
  const bookingComContext = isProviderContext({
    providerId: "booking-com",
    urls,
  });

  return {
    providerId: bookingComContext ? "booking-com" : "generic-ai",
    bookingComContext,
  };
}
