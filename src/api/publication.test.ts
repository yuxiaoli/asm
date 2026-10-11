import { describe, expect, it } from "vitest";
import { publicationBaseline } from "./publication";
import { fixtureSnapshot } from "./fixtures";

describe("production publication transaction", () => {
  it("requires explicit bootstrap and never resets an established feed", () => {
    const options = {
      previous: undefined,
      isDescendant: true,
      bootstrap: false,
      featureAlreadyPublished: false,
    };
    expect(() => publicationBaseline(options)).toThrow(/Missing feed baseline/);
    expect(
      publicationBaseline({ ...options, bootstrap: true }),
    ).toBeUndefined();
    expect(() =>
      publicationBaseline({
        ...options,
        bootstrap: true,
        featureAlreadyPublished: true,
      }),
    ).toThrow();
  });
  it("rejects older reruns, corrupt state and mismatched deployment identities", async () => {
    const snapshot = await fixtureSnapshot();
    const options = {
      previous: snapshot.feed,
      latestRevision: snapshot.sourceRevision,
      isDescendant: true,
      bootstrap: false,
      featureAlreadyPublished: true,
    };
    expect(publicationBaseline(options)).toBe(snapshot.feed);
    expect(() =>
      publicationBaseline({ ...options, isDescendant: false }),
    ).toThrow(/predates/);
    expect(() =>
      publicationBaseline({ ...options, latestRevision: "old" }),
    ).toThrow(/does not match/);
    expect(() =>
      publicationBaseline({
        ...options,
        previous: { ...snapshot.feed, known: { broken: {} } },
      }),
    ).toThrow();
    expect(snapshot.feed.events).toEqual([]);
  });
});
