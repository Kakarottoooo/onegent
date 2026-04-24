import { LaptopIntent, LaptopRecommendationCard } from "../../types";
import { recommendLaptops, classifyMentionedModels } from "../../laptopEngine";

// ─── Phase 10: Laptop Pipeline ────────────────────────────────────────────────

export async function runLaptopPipeline(
  intent: LaptopIntent
): Promise<{ laptopRecommendations: LaptopRecommendationCard[]; laptop_db_gap_warning: string | null }> {
  // Default to light_productivity if no use case specified
  const effectiveIntent: LaptopIntent = {
    ...intent,
    use_cases: intent.use_cases.length > 0 ? intent.use_cases : ["light_productivity"],
  };
  const laptopRecommendations = recommendLaptops(effectiveIntent);

  // Check if user mentioned specific models not covered by our database
  let laptop_db_gap_warning: string | null = null;
  if (intent.mentioned_models.length > 0) {
    const { announced, unknown } = classifyMentionedModels(intent.mentioned_models);
    const parts: string[] = [];
    if (announced.length > 0) {
      parts.push(
        `${announced.join(", ")} ${announced.length > 1 ? "have" : "has"} been announced — we're tracking ${announced.length > 1 ? "them" : "it"} but don't have full review data yet.`
      );
    }
    if (unknown.length > 0) {
      parts.push(
        `${unknown.join(", ")} ${unknown.length > 1 ? "aren't" : "isn't"} in our database yet.`
      );
    }
    if (parts.length > 0) {
      laptop_db_gap_warning =
        parts.join(" ") +
        " The recommendations below are the best matches from our current reviewed dataset.";
    }
  }

  return { laptopRecommendations, laptop_db_gap_warning };
}
