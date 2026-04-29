import type { MetadataRoute } from "next";
import {
  listPublicProfileOwnerIds,
  listAllPublicSlugs,
  getUserProfilesByIds,
} from "@/lib/db";

/**
 * Sitemap for Google + Bing + GPT-style indexing.
 *
 * Includes:
 *   - static marketing/product pages
 *   - /u/[username] for every user with at least one public artifact
 *     (we surface the username when set; profile_code as fallback)
 *   - /s/[slug] for every public artifact (capped at 5000 by the helper)
 *
 * Auth-gated routes (/account, /tasks, /rooms, etc.) are intentionally
 * excluded — Google can't crawl them anyway, and listing them just
 * inflates the sitemap.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://onegent.one").replace(/\/$/, "");

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1.0 },
    { url: `${base}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/developers`, changeFrequency: "monthly", priority: 0.5 },
  ];

  // Public profiles — fetch ids → enrich with profile rows so we can use
  // the user's chosen handle (username preferred, profile_code fallback).
  let profileEntries: MetadataRoute.Sitemap = [];
  try {
    const ownerIds = await listPublicProfileOwnerIds();
    if (ownerIds.length > 0) {
      const profiles = await getUserProfilesByIds(ownerIds);
      profileEntries = ownerIds
        .map((id) => profiles[id])
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => {
          const handle = p.username ?? p.profile_code;
          return {
            url: `${base}/u/${encodeURIComponent(handle)}`,
            lastModified: p.updated_at ? new Date(p.updated_at) : undefined,
            changeFrequency: "weekly" as const,
            priority: 0.7,
          };
        });
    }
  } catch {
    /* If the DB is down at build/request time, ship the static portion. */
  }

  // Public artifacts — every /s/[slug] worth indexing.
  let slugEntries: MetadataRoute.Sitemap = [];
  try {
    const slugs = await listAllPublicSlugs();
    slugEntries = slugs.map((s) => ({
      url: `${base}/s/${encodeURIComponent(s.slug)}`,
      lastModified: new Date(s.created_at),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    }));
  } catch {
    /* same — degrade gracefully */
  }

  return [...staticEntries, ...profileEntries, ...slugEntries];
}
