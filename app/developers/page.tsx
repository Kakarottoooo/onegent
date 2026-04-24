import { Hero } from "./_components/Hero";
import { ScenarioGrid } from "./_components/ScenarioGrid";
import { HowItWorks } from "./_components/HowItWorks";
import { TrustStrip } from "./_components/TrustStrip";

import "./_styles/hero.css";
import "./_styles/code-preview.css";
import "./_styles/scenario-grid.css";
import "./_styles/how-it-works.css";
import "./_styles/trust-strip.css";

export default async function DevelopersHomePage() {
  return (
    <>
      <Hero />
      <ScenarioGrid />
      <HowItWorks />
      <TrustStrip />
    </>
  );
}
