import { buildOpenTableCanonicalUrl, buildOpenTableUrl } from "../lib/agent/planners/booking-links";

console.log("=== canonical /r/ URL ===");
console.log(buildOpenTableCanonicalUrl("Tao Downtown", "New York"));
console.log(buildOpenTableCanonicalUrl("The Modern", "New York"));
console.log(buildOpenTableCanonicalUrl("Sushi by Bou", "Brooklyn, NY"));
console.log(buildOpenTableCanonicalUrl("L'Artusi", "New York"));

console.log("\n=== search URL with metroId ===");
console.log(buildOpenTableUrl({ restaurantName: "Tao Downtown New York", city: "New York", date: "2026-05-04", time: "19:00", covers: 1 }));
console.log(buildOpenTableUrl({ restaurantName: "Foo Bar", city: "Tokyo", date: "2026-05-04", time: "19:00", covers: 2 }));  // unknown city → no metroId
console.log(buildOpenTableUrl({ restaurantName: "Bistro X", city: "West Village, New York", date: "2026-05-04", time: "19:00", covers: 2 }));  // neighborhood prefix
