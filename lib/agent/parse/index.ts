import { ParsedIntent, SessionPreferences, MultilingualQueryContext } from "../../types";
import { detectCategory } from "../category";
import { parseRestaurantIntent } from "./restaurant";
import { parseHotelIntent } from "./hotel";
import { parseFlightIntent } from "./flight";
import { parseCreditCardIntent } from "./credit-card";
import { parseSubscriptionIntent } from "./subscription";
import { parseSmartphoneIntent } from "./smartphone";
import { parseHeadphoneIntent } from "./headphone";
import { parseLaptopIntent } from "./laptop";

export async function parseIntent(
  userMessage: string,
  cityFullName: string,
  queryContext?: MultilingualQueryContext,
  sessionPreferences?: SessionPreferences,
  profileContext?: string,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>
): Promise<ParsedIntent> {
  const category = await detectCategory(userMessage, queryContext);
  if (category === "subscription") {
    return parseSubscriptionIntent(userMessage, conversationHistory ?? []);
  }
  if (category === "credit_card") {
    return parseCreditCardIntent(userMessage, conversationHistory ?? []);
  }
  if (category === "laptop") {
    return parseLaptopIntent(userMessage, conversationHistory ?? []);
  }
  if (category === "smartphone") {
    return parseSmartphoneIntent(userMessage, conversationHistory ?? []);
  }
  if (category === "headphone") {
    return parseHeadphoneIntent(userMessage, conversationHistory ?? []);
  }
  if (category === "flight") {
    return parseFlightIntent(userMessage, cityFullName, queryContext);
  }
  if (category === "hotel") {
    return parseHotelIntent(userMessage, cityFullName, queryContext, conversationHistory, profileContext);
  }
  return parseRestaurantIntent(
    userMessage,
    cityFullName,
    queryContext,
    sessionPreferences,
    profileContext,
    conversationHistory
  );
}
