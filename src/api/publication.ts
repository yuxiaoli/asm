import { validateFeedState, type FeedState } from "./types";

/** Validate before building; only the publicly deployed state advances history. */
export function publicationBaseline(options: {
  previous: unknown;
  latestRevision?: string;
  isDescendant: boolean;
  bootstrap: boolean;
  featureAlreadyPublished: boolean;
}): FeedState | undefined {
  if (!options.isDescendant)
    throw new Error(
      "Refusing a production rerun that predates the successful Pages deployment",
    );
  if (options.previous === undefined) {
    if (!options.bootstrap || options.featureAlreadyPublished)
      throw new Error(
        "Missing feed baseline: explicit first-release bootstrap or recovery is required; history must not reset",
      );
    return undefined;
  }
  validateFeedState(options.previous);
  if (
    !options.latestRevision ||
    options.previous.sourceRevision !== options.latestRevision
  )
    throw new Error(
      "Published feed state does not match the latest successful Pages deployment",
    );
  return options.previous;
}
