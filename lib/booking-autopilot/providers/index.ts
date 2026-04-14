// Import providers to trigger their auto-registration with the registry
import "./booking-com";
import "./expedia";
import "./hotels-com";
import "./opentable-com";
import "./resy-com";
import "./yelp-com";

export { getProvider, requireProvider } from "./registry";
