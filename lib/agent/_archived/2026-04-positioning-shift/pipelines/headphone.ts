import { HeadphoneIntent, HeadphoneRecommendationCard } from "../../types";
import { recommendHeadphones, classifyMentionedHeadphones } from "../../headphoneEngine";
import { buildDbGapWarning } from "./utils";

// ─── Headphone Pipeline ───────────────────────────────────────────────────────

export async function runHeadphonePipeline(
  intent: HeadphoneIntent
): Promise<{ headphoneRecommendations: HeadphoneRecommendationCard[]; db_gap_warning: string | null }> {
  const effectiveIntent: HeadphoneIntent = {
    ...intent,
    use_cases: intent.use_cases.length > 0 ? intent.use_cases : ["casual"],
  };
  const headphoneRecommendations = recommendHeadphones(effectiveIntent);
  let db_gap_warning: string | null = null;
  if (intent.mentioned_models.length > 0) {
    const { announced, unknown } = classifyMentionedHeadphones(intent.mentioned_models);
    db_gap_warning = buildDbGapWarning(announced, unknown);
  }
  return { headphoneRecommendations, db_gap_warning };
}
