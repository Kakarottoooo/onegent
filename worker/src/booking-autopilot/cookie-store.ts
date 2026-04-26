/**
 * Persistent cookie store for booking autopilot.
 *
 * Cookies are saved per-service to .booking-cookies/<service>.json
 * and injected into Playwright contexts before each autopilot run.
 * The directory is gitignored — cookies never leave the local machine.
 */
import fs from "fs";
import path from "path";
import type { BrowserContext } from "playwright";

const COOKIE_DIR = path.join(process.cwd(), ".booking-cookies");

export const SERVICES = [
  "expedia",
  "booking_com",
  "opentable",
  "kayak",
] as const;
export type ServiceName = (typeof SERVICES)[number];

export const SERVICE_META: Record<
  ServiceName,
  {
    label: string;
    loginUrl: string;
    /** CSS selector that only appears when the user is signed in */
    signedInSelector: string;
    /** Domains whose cookies matter for this service */
    domains: string[];
  }
> = {
  expedia: {
    label: "Expedia",
    loginUrl: "https://www.expedia.com/user/login",
    signedInSelector: '[data-stid="header-account-popover"], [data-stid="open-account-menu"]',
    domains: ["expedia.com", ".expedia.com"],
  },
  booking_com: {
    label: "Booking.com",
    loginUrl: "https://account.booking.com/sign-in",
    signedInSelector: '[data-testid="header-user-profile-button"], [data-testid="account-menu"]',
    domains: ["booking.com", ".booking.com", "account.booking.com"],
  },
  opentable: {
    label: "OpenTable",
    loginUrl: "https://www.opentable.com/login",
    signedInSelector: '[data-test="profile-link"], [class*="UserAccount"], [aria-label*="Account"]',
    domains: ["opentable.com", ".opentable.com"],
  },
  kayak: {
    label: "Kayak",
    loginUrl: "https://www.kayak.com/user/login",
    signedInSelector: '[class*="UserMenu"], [class*="userAccount"]',
    domains: ["kayak.com", ".kayak.com"],
  },
};

interface StoredCookies {
  cookies: PlaywrightCookie[];
  savedAt: string;
}

// Playwright cookie type (simplified — full type is in playwright package)
interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

function cookieFilePath(service: ServiceName): string {
  return path.join(COOKIE_DIR, `${service}.json`);
}

export function saveCookies(service: ServiceName, cookies: PlaywrightCookie[]): void {
  fs.mkdirSync(COOKIE_DIR, { recursive: true });
  const data: StoredCookies = { cookies, savedAt: new Date().toISOString() };
  fs.writeFileSync(cookieFilePath(service), JSON.stringify(data, null, 2));
}

export function loadCookies(service: ServiceName): PlaywrightCookie[] | null {
  const file = cookieFilePath(service);
  if (!fs.existsSync(file)) return null;
  try {
    const data: StoredCookies = JSON.parse(fs.readFileSync(file, "utf8"));
    return data.cookies;
  } catch {
    return null;
  }
}

export interface ServiceStatus {
  connected: boolean;
  savedAt?: string;
}

export function getServiceStatus(service: ServiceName): ServiceStatus {
  const file = cookieFilePath(service);
  if (!fs.existsSync(file)) return { connected: false };
  try {
    const data: StoredCookies = JSON.parse(fs.readFileSync(file, "utf8"));
    return { connected: true, savedAt: data.savedAt };
  } catch {
    return { connected: false };
  }
}

export function getAllStatuses(): Record<ServiceName, ServiceStatus> {
  const result = {} as Record<ServiceName, ServiceStatus>;
  for (const svc of SERVICES) {
    result[svc] = getServiceStatus(svc);
  }
  return result;
}

export function clearCookies(service: ServiceName): void {
  const file = cookieFilePath(service);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/**
 * Inject all saved cookies for the given services into a Playwright context.
 * Call this before page.goto() so cookies are pre-loaded for every domain.
 */
export async function injectCookies(
  context: BrowserContext,
  services: ServiceName[]
): Promise<void> {
  for (const svc of services) {
    const cookies = loadCookies(svc);
    if (cookies && cookies.length > 0) {
      await context.addCookies(cookies).catch(() => {
        // Some cookies may be malformed after expiry — ignore errors
      });
    }
  }
}
