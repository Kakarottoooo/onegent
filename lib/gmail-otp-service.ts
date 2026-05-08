import {
  getGmailConnectionWithSecrets,
  markGmailConnectionUsed,
  upsertGmailConnection,
} from "@/lib/gmail-db";
import {
  fetchGoogleGmailMessage,
  isGoogleGmailTokenFresh,
  refreshGoogleGmailAccessToken,
  searchGoogleGmailMessages,
} from "@/lib/google-gmail";
import {
  buildProviderOtpGmailQuery,
  findProviderOtpInGmailMessages,
  type GmailOtpExtractionResult,
  type ProviderOtpSource,
} from "@/lib/gmail-otp";

export type GmailOtpAssistResult =
  | (GmailOtpExtractionResult & { connected: true })
  | {
      status: "not_connected";
      connected: false;
      provider: ProviderOtpSource;
      reason: "missing_gmail_connection" | "missing_refresh_token";
    }
  | {
      status: "auth_error";
      connected: true;
      provider: ProviderOtpSource;
      reason: string;
    };

export async function findGmailOtpForProviderLogin(params: {
  userId: string;
  provider: ProviderOtpSource;
  requestedAt?: Date;
  windowMinutes?: number;
  maxResults?: number;
}): Promise<GmailOtpAssistResult> {
  const connection = await getGmailConnectionWithSecrets(params.userId, "google");
  if (!connection) {
    return {
      status: "not_connected",
      connected: false,
      provider: params.provider,
      reason: "missing_gmail_connection",
    };
  }
  if (!connection.refreshToken) {
    return {
      status: "not_connected",
      connected: false,
      provider: params.provider,
      reason: "missing_refresh_token",
    };
  }

  try {
    let accessToken = connection.accessToken;
    if (!accessToken || !isGoogleGmailTokenFresh(connection)) {
      const refreshed = await refreshGoogleGmailAccessToken(connection.refreshToken);
      accessToken = refreshed.accessToken;
      await upsertGmailConnection({
        userId: params.userId,
        provider: "google",
        accessToken,
        refreshToken: connection.refreshToken,
        accessTokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
        scope: refreshed.scope ?? connection.scope,
        tokenType: refreshed.tokenType ?? connection.token_type,
        externalAccountEmail: connection.external_account_email,
        externalAccountId: connection.external_account_id,
      });
    }

    const query = buildProviderOtpGmailQuery({
      provider: params.provider,
      windowMinutes: params.windowMinutes,
    });
    const items = await searchGoogleGmailMessages({
      accessToken,
      query,
      maxResults: params.maxResults ?? 5,
    });
    const messages = await Promise.all(
      items.map((item) => fetchGoogleGmailMessage({ accessToken, id: item.id })),
    );
    const result = findProviderOtpInGmailMessages({
      provider: params.provider,
      query,
      messages,
      requestedAt: params.requestedAt,
      windowMinutes: params.windowMinutes,
    });
    await markGmailConnectionUsed(params.userId, "google");
    return { ...result, connected: true };
  } catch (error) {
    return {
      status: "auth_error",
      connected: true,
      provider: params.provider,
      reason: error instanceof Error ? error.message : "Gmail OTP assist failed",
    };
  }
}
