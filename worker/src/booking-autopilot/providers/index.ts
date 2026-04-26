// Import providers to trigger their auto-registration with the registry
import "./booking-com";
import "./expedia";
import "./hotels-com";
import "./opentable-com";
import "./resy-com";
import "./seatgeek-com";
import "./ticketmaster-com";
// yelp-com kept for potential future use but not in active fallback chain

export { getProvider, requireProvider } from "./registry";
