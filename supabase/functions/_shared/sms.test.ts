import { describe, expect, it } from "vitest";
import {
  gatewayApiMessageId,
  gatewayApiPayload,
  inMobileMessageId,
  inMobilePayload,
  isSendableBody,
  MAX_SMS_LENGTH,
  toDanishMsisdn,
} from "./sms.ts";

describe("toDanishMsisdn", () => {
  it("accepts the formats players actually type", () => {
    expect(toDanishMsisdn("+45 20 12 34 56")).toBe("4520123456");
    expect(toDanishMsisdn("0045 20123456")).toBe("4520123456");
    expect(toDanishMsisdn("20123456")).toBe("4520123456");
    expect(toDanishMsisdn("20-12-34-56")).toBe("4520123456");
    expect(toDanishMsisdn("(45) 20123456")).toBe("4520123456");
  });

  it("rejects anything that is not a Danish mobile number", () => {
    expect(toDanishMsisdn(null)).toBeNull();
    expect(toDanishMsisdn("")).toBeNull();
    expect(toDanishMsisdn("   ")).toBeNull();
    expect(toDanishMsisdn("1234567")).toBeNull(); // too short
    expect(toDanishMsisdn("201234567")).toBeNull(); // too long
    expect(toDanishMsisdn("+46 701234567")).toBeNull(); // Swedish
    expect(toDanishMsisdn("hej med dig")).toBeNull();
    expect(toDanishMsisdn("+45 10123456")).toBeNull(); // no Danish mobile starts with 1
  });
});

describe("isSendableBody", () => {
  it("requires real content within the gateway limit", () => {
    expect(isSendableBody("Der er en plads ledig")).toBe(true);
    expect(isSendableBody("")).toBe(false);
    expect(isSendableBody("   ")).toBe(false);
    expect(isSendableBody(null)).toBe(false);
    expect(isSendableBody("x".repeat(MAX_SMS_LENGTH))).toBe(true);
    expect(isSendableBody("x".repeat(MAX_SMS_LENGTH + 1))).toBe(false);
  });
});

describe("provider payloads", () => {
  it("sends GatewayAPI the msisdn as a number", () => {
    expect(gatewayApiPayload("La Pista", "4520123456", "Hej")).toEqual({
      sender: "La Pista",
      message: "Hej",
      recipients: [{ msisdn: 4520123456 }],
    });
  });

  it("reads the message id back out of a GatewayAPI response", () => {
    expect(gatewayApiMessageId({ ids: [123456] })).toBe("123456");
    expect(gatewayApiMessageId({ ids: [] })).toBeUndefined();
    expect(gatewayApiMessageId(null)).toBeUndefined();
    expect(gatewayApiMessageId("not json")).toBeUndefined();
  });

  it("builds an inMobile payload and reads its id", () => {
    expect(inMobilePayload("La Pista", "4520123456", "Hej")).toEqual({
      messages: [{ to: "4520123456", text: "Hej", from: "La Pista" }],
    });
    expect(inMobileMessageId({ results: [{ messageId: "abc" }] })).toBe("abc");
    expect(inMobileMessageId({ results: [] })).toBeUndefined();
    expect(inMobileMessageId(undefined)).toBeUndefined();
  });
});
