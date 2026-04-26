/**
 * REST client for the Onegent /api/v1 surface. This file is the only
 * place in @onegent/mcp-server that knows about HTTP — all tool handlers
 * should go through the typed helpers here so auth, timeouts, and error
 * mapping stay consistent.
 *
 * Env:
 *   ONEGENT_API_KEY       required, format ogk_(live|test)_...
 *   ONEGENT_API_BASE_URL  optional, defaults to https://onegent.one/api/v1
 *
 * Types below mirror docs/api/v1.md; kept hand-written (not imported
 * from @/lib/api-v1) so this package can publish standalone without
 * pulling in the Next.js app.
 */

const DEFAULT_BASE_URL = "https://onegent.one/api/v1";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface OnegentClientConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

export interface BookingProfile {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

export interface RestaurantParams {
  scenario: "restaurant";
  params: {
    restaurant_name: string;
    city: string;
    date: string;
    time: string;
    covers: number;
  };
}

export interface HotelParams {
  scenario: "hotel";
  params: {
    destination: string;
    check_in: string;
    check_out: string;
    guests: number;
    rooms?: number;
  };
}

export interface FlightParams {
  scenario: "flight";
  params: {
    origin: string;
    destination: string;
    depart_date: string;
    return_date?: string;
    passengers: number;
    cabin?: "economy" | "premium_economy" | "business" | "first";
  };
}

export interface ActivityParams {
  scenario: "activity";
  params: {
    city: string;
    date: string;
    activity_name?: string;
    participants: number;
  };
}

export type ExecutionRequest =
  | RestaurantParams
  | HotelParams
  | FlightParams
  | ActivityParams;

export interface CreateExecutionJobBody {
  request: ExecutionRequest;
  profileId?: number;
  profile?: BookingProfile;
  consentPolicy?: {
    allowTimeAdjustment?: boolean;
    maxRetries?: number;
    paymentPolicy?: "stop_before_cvc" | "auto_submit";
    allowedProviders?: string[];
    blockedProviders?: string[];
  };
  clientMetadata?: Record<string, string>;
}

export interface CreateExecutionJobResponse {
  jobId: string;
  status: string;
  _links?: { self?: string; audit?: string };
}

export interface ExecutionJobResult {
  jobId: string;
  status:
    | "queued"
    | "running"
    | "done"
    | "error"
    | "paused_payment"
    | "captcha"
    | "needs_login";
  scenario: string;
  provider?: string;
  confirmationCode?: string;
  error?: { code: string; message: string };
  updatedAt: string;
}

export interface AuditEvent {
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
  data?: unknown;
}

export interface AuditResponse {
  jobId: string;
  events: AuditEvent[];
}

/** Thrown when the API returns a structured error response. */
export class OnegentApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: unknown;

  constructor(status: number, code: string | undefined, message: string, body: unknown) {
    super(message);
    this.name = "OnegentApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export function loadConfig(): OnegentClientConfig {
  const apiKey = process.env.ONEGENT_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "ONEGENT_API_KEY env var is required. Get one at https://onegent.one/developers " +
        "and set it in your MCP client config (e.g. Claude Desktop's env block).",
    );
  }
  return configFromApiKey(apiKey);
}

/**
 * Build a config from an explicit apiKey (e.g. one received per-request via
 * an HTTP Authorization header). Honors ONEGENT_API_BASE_URL env override
 * the same way loadConfig() does.
 */
export function configFromApiKey(apiKey: string): OnegentClientConfig {
  const baseUrl = (process.env.ONEGENT_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { apiKey, baseUrl, timeoutMs: DEFAULT_TIMEOUT_MS };
}

async function request<T>(
  cfg: OnegentClientConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${cfg.baseUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": `@onegent/mcp-server/${process.env.npm_package_version ?? "dev"}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new OnegentApiError(0, "timeout", `Request to ${path} timed out after ${cfg.timeoutMs}ms`, null);
    }
    throw new OnegentApiError(0, "network_error", `Network error calling ${path}: ${(err as Error).message}`, null);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // fall through — non-JSON error body (HTML from a misconfigured edge, etc.)
    }
  }

  if (!res.ok) {
    const errObj = (parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}) ?? {};
    const code = typeof errObj.error === "string" ? errObj.error : undefined;
    const message =
      typeof errObj.message === "string" ? errObj.message : `HTTP ${res.status} from ${path}`;
    throw new OnegentApiError(res.status, code, message, parsed ?? text);
  }

  return parsed as T;
}

export function createClient(cfg: OnegentClientConfig = loadConfig()) {
  return {
    config: cfg,

    createExecutionJob(body: CreateExecutionJobBody): Promise<CreateExecutionJobResponse> {
      return request<CreateExecutionJobResponse>(cfg, "POST", "/execution-jobs", body);
    },

    getExecutionJob(jobId: string): Promise<ExecutionJobResult> {
      return request<ExecutionJobResult>(cfg, "GET", `/execution-jobs/${encodeURIComponent(jobId)}`);
    },

    getExecutionJobAudit(jobId: string, limit?: number): Promise<AuditResponse> {
      const query = limit ? `?limit=${limit}` : "";
      return request<AuditResponse>(
        cfg,
        "GET",
        `/execution-jobs/${encodeURIComponent(jobId)}/audit${query}`,
      );
    },
  };
}

export type OnegentClient = ReturnType<typeof createClient>;
