/**
 * Drains the SMS outbox through a Danish gateway.
 *
 * Runs on a schedule: it first releases expired waitlist offers (which
 * queues fresh offers), then sends whatever is pending. Keys live in the
 * function's environment and never reach the browser.
 *
 * Invoke with either the service-role key or the shared CRON_SECRET:
 *   curl -X POST "$SUPABASE_URL/functions/v1/send-sms" \
 *     -H "x-cron-secret: $CRON_SECRET"
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  gatewayApiMessageId,
  gatewayApiPayload,
  inMobileMessageId,
  inMobilePayload,
  isSendableBody,
  toDanishMsisdn,
  type SendResult,
  type SmsMessage,
} from "../_shared/sms.ts";

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 3;

const env = (key: string) => Deno.env.get(key) ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Only the scheduler (or an operator holding the service key) may send. */
function isAuthorised(req: Request): boolean {
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = env("CRON_SECRET");

  const header = req.headers.get("x-cron-secret");
  if (cronSecret && header && timingSafeEqual(header, cronSecret)) return true;

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (serviceKey && bearer && timingSafeEqual(bearer, serviceKey)) return true;

  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sendViaGatewayApi(msg: SmsMessage, msisdn: string, sender: string, key: string): Promise<SendResult> {
  const res = await fetch("https://gatewayapi.com/rest/mtsms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // GatewayAPI uses the API key as the basic-auth username, no password.
      authorization: "Basic " + btoa(key + ":"),
    },
    body: JSON.stringify(gatewayApiPayload(sender, msisdn, msg.body)),
  });

  const text = await res.text();
  if (!res.ok) {
    return { id: msg.id, ok: false, error: `gatewayapi ${res.status}: ${text.slice(0, 300)}` };
  }
  return {
    id: msg.id,
    ok: true,
    providerMessageId: gatewayApiMessageId(safeJson(text)),
  };
}

async function sendViaInMobile(msg: SmsMessage, msisdn: string, sender: string, key: string): Promise<SendResult> {
  const res = await fetch("https://api.inmobile.com/v4/sms/outgoing", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + key,
    },
    body: JSON.stringify(inMobilePayload(sender, msisdn, msg.body)),
  });

  const text = await res.text();
  if (!res.ok) {
    return { id: msg.id, ok: false, error: `inmobile ${res.status}: ${text.slice(0, 300)}` };
  }
  return {
    id: msg.id,
    ok: true,
    providerMessageId: inMobileMessageId(safeJson(text)),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isAuthorised(req)) return json({ error: "unauthorized" }, 401);

  const url = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "supabase_env_missing" }, 500);

  const provider = (env("SMS_PROVIDER") || "gatewayapi").toLowerCase();
  const apiKey = env("SMS_GATEWAY_API_KEY");
  const sender = env("SMS_GATEWAY_SENDER") || "La Pista";
  // Without a key we never invent a send: the rows stay pending so nothing
  // is lost, and the caller is told why.
  const dryRun = !apiKey || env("SMS_DRY_RUN") === "true";

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Releasing stale offers first means their replacement SMS goes out in
  // this same run rather than waiting for the next one.
  const { data: expired, error: expireError } = await supabase.rpc("expire_offers");
  if (expireError) {
    console.error("expire_offers failed", expireError);
  }

  const { data: pending, error: readError } = await supabase
    .from("sms_outbox")
    .select("id, phone, body, attempts")
    .eq("status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (readError) return json({ error: "outbox_read_failed", detail: readError.message }, 500);

  const queued = pending ?? [];
  if (dryRun) {
    console.log(`[dry-run] ${queued.length} message(s) would be sent via ${provider}`);
    return json({
      dryRun: true,
      reason: apiKey ? "SMS_DRY_RUN=true" : "SMS_GATEWAY_API_KEY not set",
      expiredOffers: expired ?? 0,
      pending: queued.length,
    });
  }

  let sent = 0;
  let failed = 0;

  for (const row of queued) {
    const msg: SmsMessage = { id: row.id, phone: row.phone, body: row.body };
    const msisdn = toDanishMsisdn(row.phone);

    let result: SendResult;
    if (!msisdn) {
      result = { id: row.id, ok: false, error: `unusable phone number: ${row.phone}` };
    } else if (!isSendableBody(row.body)) {
      result = { id: row.id, ok: false, error: "message body is empty or too long" };
    } else if (provider === "inmobile") {
      result = await sendViaInMobile(msg, msisdn, sender, apiKey);
    } else {
      result = await sendViaGatewayApi(msg, msisdn, sender, apiKey);
    }

    const attempts = (row.attempts ?? 0) + 1;
    if (result.ok) {
      sent++;
      await supabase.from("sms_outbox").update({
        status: "sent",
        attempts,
        sent_at: new Date().toISOString(),
        provider_message_id: result.providerMessageId ?? null,
        error: null,
      }).eq("id", row.id);
    } else {
      failed++;
      console.error("sms send failed", row.id, result.error);
      // Give up only after the last attempt, so a blip is retried next run.
      await supabase.from("sms_outbox").update({
        status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        attempts,
        error: result.error ?? "unknown error",
      }).eq("id", row.id);
    }
  }

  return json({ provider, expiredOffers: expired ?? 0, sent, failed });
});
