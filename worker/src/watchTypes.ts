/**
 * Generic Watch / Subscription types — category-agnostic.
 *
 * Adding a new watchable category (e.g. "headphones") only requires:
 *   1. Adding it to WatchCategory
 *   2. Adding a search strategy to WATCH_CATEGORY_META
 *   3. Creating a watch provider (analogous to laptopWatch.ts)
 */

// ─── Category registry ────────────────────────────────────────────────────────

export type WatchCategory =
  | "laptop"
  | "smartphone"
  | "headphone"
  | "gpu"
  | "car"
  | "tablet"
  | "monitor";

export const WATCH_CATEGORY_META: Record<
  WatchCategory,
  { label: string; emoji: string; exampleBrands: string[] }
> = {
  laptop:     { label: "Laptop",     emoji: "💻", exampleBrands: ["Apple", "Lenovo", "Dell", "HP", "ASUS"] },
  smartphone: { label: "Smartphone", emoji: "📱", exampleBrands: ["Apple", "Samsung", "Google", "OnePlus"] },
  headphone:  { label: "Headphone",  emoji: "🎧", exampleBrands: ["Sony", "Bose", "Apple", "Sennheiser"] },
  gpu:        { label: "GPU",        emoji: "🎮", exampleBrands: ["NVIDIA", "AMD", "Intel"] },
  car:        { label: "Car / EV",   emoji: "🚗", exampleBrands: ["Tesla", "Rivian", "BMW", "Toyota"] },
  tablet:     { label: "Tablet",     emoji: "📟", exampleBrands: ["Apple", "Samsung", "Microsoft"] },
  monitor:    { label: "Monitor",    emoji: "🖥️", exampleBrands: ["LG", "Samsung", "Dell", "ASUS"] },
};

// ─── Subscription ─────────────────────────────────────────────────────────────

export interface WatchSubscription {
  id: string;
  created_at: string;
  watch_category: WatchCategory;
  brands: string[];     // empty = watch all brands in this category
  keywords: string[];   // additional keyword filters; empty = no filter
  label: string;        // human-readable, e.g. "Apple MacBook releases"
}

// ─── Detected product (category-agnostic) ─────────────────────────────────────

export interface DetectedProduct {
  id: string;
  watch_category: WatchCategory;
  detected_at: string;
  name: string;
  brand: string;
  source_url: string;
  source_title: string;
  raw_excerpt: string;
  extracted_specs: {
    cpu?: string;
    price_usd?: number;
    display_size?: number;
    weight_kg?: number;
    ram_gb?: number;
    storage_gb?: number;
    [key: string]: unknown;
  };
  status: "pending_review" | "dismissed";
}

export interface PendingProductsFile {
  last_checked: string;
  pending: DetectedProduct[];
}

// ─── Notification payload ─────────────────────────────────────────────────────

export interface SubscriptionMatch {
  subscription: WatchSubscription;
  products: DetectedProduct[];
}
