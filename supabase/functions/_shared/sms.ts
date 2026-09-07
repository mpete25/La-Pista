/**
 * Pure helpers for the SMS gateway. Kept free of Deno and network calls so
 * the awkward parts — Danish number formats, provider payloads — can be unit
 * tested with the rest of the front end.
 */

export type SmsMessage = {
  id: string;
  phone: string;
  body: string;
};

export type SendResult = {
  id: string;
  ok: boolean;
  providerMessageId?: string;
  error?: string;
};

/**
 * Danish mobile numbers as an msisdn: country code, then eight digits, no
 * plus and no separators. Players type these by hand, so "+45 20 12 34 56",
 * "0045 20123456" and "20123456" all have to land on 4520123456.
 *
 * Returns null when the number cannot be a Danish mobile — the caller skips
 * the send rather than paying the gateway to reject it.
 */
export function toDanishMsisdn(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let digits = String(raw).replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);

  if (!/^\d+$/.test(digits)) return null;

  // Bare eight-digit numbers are local: assume Denmark.
  if (digits.length === 8) digits = "45" + digits;

  if (!/^45\d{8}$/.test(digits)) return null;

  // Danish mobile numbers never start with 0 or 1 after the country code.
  if (/^45[01]/.test(digits)) return null;

  return digits;
}

/** GatewayAPI rejects a body over 10 concatenated parts; ours are far shorter. */
export const MAX_SMS_LENGTH = 918;

export function isSendableBody(body: string | null | undefined): boolean {
  return typeof body === "string" && body.trim().length > 0 && body.length <= MAX_SMS_LENGTH;
}

export type GatewayApiPayload = {
  sender: string;
  message: string;
  recipients: { msisdn: number }[];
};

export function gatewayApiPayload(sender: string, msisdn: string, body: string): GatewayApiPayload {
  return {
    sender,
    message: body,
    recipients: [{ msisdn: Number(msisdn) }],
  };
}

/** GatewayAPI answers { ids: [12345] } on success. */
export function gatewayApiMessageId(response: unknown): string | undefined {
  const ids = (response as { ids?: unknown })?.ids;
  if (Array.isArray(ids) && ids.length > 0) return String(ids[0]);
  return undefined;
}

export type InMobilePayload = {
  messages: { to: string; text: string; from: string }[];
};

export function inMobilePayload(sender: string, msisdn: string, body: string): InMobilePayload {
  return {
    messages: [{ to: msisdn, text: body, from: sender }],
  };
}

export function inMobileMessageId(response: unknown): string | undefined {
  const results = (response as { results?: unknown })?.results;
  if (Array.isArray(results) && results.length > 0) {
    const id = (results[0] as { messageId?: unknown })?.messageId;
    if (id != null) return String(id);
  }
  return undefined;
}
