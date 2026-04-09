// Import providers to trigger their auto-registration with the registry
import "./booking-com";
import "./expedia";

export { getProvider, requireProvider } from "./registry";
