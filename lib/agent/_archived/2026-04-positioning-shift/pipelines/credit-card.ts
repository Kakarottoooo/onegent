import { CreditCardIntent, CreditCardRecommendationCard, SpendingProfile } from "../../types";
import { recommendCreditCards, buildPortfolioGapAnalysis, getAllCards } from "../../creditCardEngine";

// ─── Phase 9: Credit Card Pipeline ───────────────────────────────────────────

export async function runCreditCardPipeline(
  intent: CreditCardIntent
): Promise<{ creditCardRecommendations: CreditCardRecommendationCard[] }> {
  const spending: SpendingProfile = intent.spending_profile ?? {
    dining: 300,
    groceries: 400,
    travel: 200,
    gas: 100,
    online_shopping: 150,
    streaming: 30,
    entertainment: 0,
    pharmacy: 50,
    rent: 0,
    other: 200,
  };
  const existingCards = intent.existing_cards ?? [];
  const rewardPreference = intent.reward_preference ?? "travel";
  // null means MiniMax said "not mentioned" → no filtering; undefined means field missing → same
  const creditScore = (intent.credit_score !== null && intent.credit_score !== undefined)
    ? intent.credit_score
    : undefined;
  const preferNoAnnualFee = intent.prefer_no_annual_fee ?? false;
  const preferFlatRate = intent.prefer_flat_rate ?? false;
  const hasExistingCards = intent.has_existing_cards ?? (existingCards.length > 0);

  const creditCardRecommendations = recommendCreditCards(
    spending,
    existingCards,
    rewardPreference,
    creditScore,
    preferNoAnnualFee,
    preferFlatRate,
    hasExistingCards
  );

  // S-4: Signup bonus comparison mode
  if (intent.optimization_mode === "signup_bonus") {
    const CARDS = getAllCards();
    const monthly_spend = Object.values(spending).reduce((sum, v) => sum + v, 0);
    const creditScore = (intent.credit_score !== null && intent.credit_score !== undefined)
      ? intent.credit_score
      : undefined;
    const candidates = CARDS.filter((card) =>
      creditScore === undefined || (card.min_credit_score ?? 0) <= creditScore
    );
    const ranked = candidates
      .map((card) => {
        const sub_value = card.signup_bonus_points * card.point_value_cash;
        const spend_in_window = monthly_spend * card.signup_bonus_timeframe_months;
        const feasibility =
          spend_in_window >= card.signup_bonus_spend_requirement
            ? 1.0
            : spend_in_window >= card.signup_bonus_spend_requirement * 0.7
            ? 0.6
            : 0.2;
        const adjusted_value = sub_value * feasibility;
        const feasibility_label =
          feasibility >= 1
            ? "Reachable with your spend"
            : feasibility >= 0.6
            ? "Tight but possible"
            : "Requires extra spend";
        const portfolio_gap_note = `Bonus: ${Math.round(card.signup_bonus_points / 1000)}k pts (~$${Math.round(sub_value)}) · Spend $${card.signup_bonus_spend_requirement} in ${card.signup_bonus_timeframe_months}mo · ${feasibility_label}`;
        return { card, sub_value, adjusted_value, portfolio_gap_note };
      })
      .filter((x) => x.card.signup_bonus_points > 0)
      .sort((a, b) => b.adjusted_value - a.adjusted_value)
      .slice(0, 3);
    const signupCards: CreditCardRecommendationCard[] = ranked.map((x, i) => ({
      card: x.card,
      rank: i + 1,
      annual_net_benefit: x.sub_value - x.card.annual_fee,
      marginal_value: x.sub_value,
      category_breakdown: [],
      signup_bonus_value: x.sub_value,
      reward_preference: rewardPreference,
      why_recommended: `Strong signup bonus — ${Math.round(x.card.signup_bonus_points / 1000)}k pts worth ~$${Math.round(x.sub_value)}`,
      watch_out: x.card.notes ?? [],
      portfolio_gap_note: x.portfolio_gap_note,
    }));
    return { creditCardRecommendations: signupCards };
  }

  // G-2: Portfolio review mode — annotate cards with gap-fill notes
  if (intent.optimization_mode === "portfolio_review" && existingCards.length > 0) {
    const gap = buildPortfolioGapAnalysis(existingCards, spending);
    if (gap.uncovered_categories.length > 0) {
      const CARDS = getAllCards();
      const annotated: CreditCardRecommendationCard[] = creditCardRecommendations.map((rec) => {
        const card = CARDS.find((c) => c.id === rec.card.id);
        if (!card) return rec;
        const covered = gap.uncovered_categories.filter((cat) => {
          const key = cat as keyof typeof card.category_rates;
          const rate = card.category_rates[key] ?? 1;
          return rate >= 2;
        });
        if (covered.length === 0) return rec;
        const note = `Fills your ${gap.uncovered_categories.map((c) => c.replace(/_/g, " ")).join(", ")} gap${gap.uncovered_categories.length > 1 ? "s" : ""} — earns ${covered.map((cat) => `${card.category_rates[cat as keyof typeof card.category_rates]}× on ${cat.replace(/_/g, " ")}`).join(", ")}`;
        return { ...rec, portfolio_gap_note: note };
      });
      return { creditCardRecommendations: annotated };
    }
  }

  return { creditCardRecommendations };
}
