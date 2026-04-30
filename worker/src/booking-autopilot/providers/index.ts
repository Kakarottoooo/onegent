// Import providers to trigger their auto-registration with the registry
import "./booking-com";
import "./expedia";
import "./hotels-com";
import "./opentable-com";
import "./resy-com";
import "./seatgeek-com";
import "./ticketmaster-com";
// Yelp is now the PRIMARY restaurant entry — broader venue coverage than
// OpenTable, and Yelp's "Make a Reservation" button auto-redirects to the
// underlying booking platform (OpenTable / Resy / venue widget). The
// downstream provider takes over once the redirect lands.
import "./yelp-com";

export { getProvider, requireProvider } from "./registry";
