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

  it("ignores subdomains of other hosts, such as a Vercel or Netlify preview", () => {
    expect(centerSlugFromLocation(at("https://la-pista.vercel.app/"))).toBeNull();
    expect(centerSlugFromLocation(at("https://la-pista-git-main-mads.vercel.app/"))).toBeNull();
    expect(centerSlugFromLocation(at("https://padel.netlify.app/"))).toBeNull();
    expect(centerSlugFromLocation(at("https://la-pista.vercel.app/?center=padel-lounge"))).toBe("padel-lounge");
  });

  it("only takes a single label in front of the platform domain", () => {
    expect(centerSlugFromLocation(at("https://a.b.lapista.dk/"))).toBeNull();
  });

  it("treats platform hosts as tenant-less", () => {
    expect(centerSlugFromLocation(at("https://lapista.dk/"))).toBeNull();
    expect(centerSlugFromLocation(at("https://www.lapista.dk/"))).toBeNull();
    expect(centerSlugFromLocation(at("https://app.lapista.dk/"))).toBeNull();
    expect(centerSlugFromLocation(at("http://localhost:5173/"))).toBeNull();
    expect(centerSlugFromLocation(at("http://127.0.0.1:5173/"))).toBeNull();
  });
});
