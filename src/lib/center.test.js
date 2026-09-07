import { describe, expect, it } from "vitest";
import { centerSlugFromLocation } from "./center.js";

const at = (href) => new URL(href);

describe("centerSlugFromLocation", () => {
  it("reads the tenant from the subdomain", () => {
    expect(centerSlugFromLocation(at("https://padel-lounge.lapista.dk/"))).toBe("padel-lounge");
    expect(centerSlugFromLocation(at("https://aarhus-padel.lapista.dk/events"))).toBe("aarhus-padel");
  });

  it("lets an explicit ?center= win, for local development", () => {
    expect(centerSlugFromLocation(at("http://localhost:5173/?center=padel-lounge-aalborg")))
      .toBe("padel-lounge-aalborg");
    expect(centerSlugFromLocation(at("https://other.lapista.dk/?center=Padel-Lounge")))
      .toBe("padel-lounge");
  });

  it("treats platform hosts as tenant-less", () => {
    expect(centerSlugFromLocation(at("https://lapista.dk/"))).toBeNull();
    expect(centerSlugFromLocation(at("https://www.lapista.dk/"))).toBeNull();
    expect(centerSlugFromLocation(at("https://app.lapista.dk/"))).toBeNull();
    expect(centerSlugFromLocation(at("http://localhost:5173/"))).toBeNull();
    expect(centerSlugFromLocation(at("http://127.0.0.1:5173/"))).toBeNull();
  });
});
