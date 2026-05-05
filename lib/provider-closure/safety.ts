import { ProviderClosureError } from "./schema";

export type ProviderClosureSafetyFindingKind =
  | "email"
  | "phone"
  | "payment_card"
  | "cvv_secret"
  | "otp_secret"
  | "captcha_secret";

export interface ProviderClosureSafetyFinding {
  kind: ProviderClosureSafetyFindingKind;
  excerpt: string;
}

export function assertProviderClosureArtifactIsSafe(raw: string): void {
  const findings = findProviderClosureSafetyFindings(raw);
  if (findings.length === 0) return;

  throw new ProviderClosureError(
    "unsafe_artifact",
    `Provider closure artifact contains unsafe data: ${findings
      .map((finding) => `${finding.kind} (${finding.excerpt})`)
      .join(", ")}`,
  );
}

export function findProviderClosureSafetyFindings(
  raw: string,
): ProviderClosureSafetyFinding[] {
  return [
    ...findUnexpectedEmails(raw),
    ...findUnexpectedPhones(raw),
    ...findPaymentCards(raw),
    ...findCvvSecretValues(raw),
    ...findOtpSecretValues(raw),
    ...findCaptchaSecretValues(raw),
  ];
}

function findUnexpectedEmails(raw: string): ProviderClosureSafetyFinding[] {
  const matches =
    raw.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) ?? [];
  return unique(matches)
    .filter((email) => {
      const domain = email.split("@")[1]?.toLowerCase();
      return domain !== "example.com" && domain !== "example.test";
    })
    .map((email) => ({ kind: "email", excerpt: email }));
}

function findUnexpectedPhones(raw: string): ProviderClosureSafetyFinding[] {
  const matches = raw.match(/\+\d[\d().\-\s]{7,}\d/g) ?? [];
  return unique(matches)
    .filter((phone) => phone.replace(/[^\d+]/g, "") !== "+10000000000")
    .map((phone) => ({ kind: "phone", excerpt: phone }));
}

function findPaymentCards(raw: string): ProviderClosureSafetyFinding[] {
  const matches = raw.match(/\b(?:\d[ -]?){13,19}\b/g) ?? [];
  return unique(matches)
    .filter((candidate) => {
      const digits = candidate.replace(/\D/g, "");
      return (
        digits.length >= 13 &&
        digits.length <= 19 &&
        !/^(\d)\1+$/.test(digits)
      );
    })
    .map((card) => ({ kind: "payment_card", excerpt: redactDigits(card) }));
}

function findCvvSecretValues(raw: string): ProviderClosureSafetyFinding[] {
  const matches =
    raw.match(
      /\b(?:cvv|cvc|security code|security-code)\b[^"\n\r]{0,40}[:=]\s*"?\d{3,4}"?/gi,
    ) ?? [];
  return unique(matches).map((excerpt) => ({
    kind: "cvv_secret",
    excerpt: redactDigits(excerpt),
  }));
}

function findOtpSecretValues(raw: string): ProviderClosureSafetyFinding[] {
  const matches =
    raw.match(
      /\b(?:otp|one[-\s]?time code|verification code|sms code|challenge-code)\b[^"\n\r]{0,40}[:=]\s*"?\d{4,8}"?/gi,
    ) ?? [];
  return unique(matches).map((excerpt) => ({
    kind: "otp_secret",
    excerpt: redactDigits(excerpt),
  }));
}

function findCaptchaSecretValues(raw: string): ProviderClosureSafetyFinding[] {
  const matches =
    raw.match(/\b(?:captcha)\b[^"\n\r]{0,40}[:=]\s*"?[A-Z0-9]{4,12}"?/gi) ??
    [];
  return unique(matches).map((excerpt) => ({
    kind: "captcha_secret",
    excerpt: redactDigits(excerpt),
  }));
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function redactDigits(value: string): string {
  return value.replace(/\d/g, "x");
}
