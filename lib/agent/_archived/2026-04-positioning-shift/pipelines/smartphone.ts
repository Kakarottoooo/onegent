import { SmartphoneIntent, SmartphoneRecommendationCard } from "../../types";
import { recommendSmartphones, classifyMentionedSmartphones } from "../../smartphoneEngine";
import { buildDbGapWarning } from "./utils";

// ─── Smartphone Pipeline ──────────────────────────────────────────────────────

export async function runSmartphonePipeline(
  intent: SmartphoneIntent
): Promise<{ smartphoneRecommendations: SmartphoneRecommendationCard[]; db_gap_warning: string | null }> {
  const effectiveIntent: SmartphoneIntent = {
    ...intent,
    use_cases: intent.use_cases.length > 0 ? intent.use_cases : ["everyday"],
  };
  const smartphoneRecommendations = recommendSmartphones(effectiveIntent);
  let db_gap_warning: string | null = null;
  if (intent.mentioned_models.length > 0) {
    const { announced, unknown } = classifyMentionedSmartphones(intent.mentioned_models);
    db_gap_warning = buildDbGapWarning(announced, unknown);
  }
  return { smartphoneRecommendations, db_gap_warning };
}
