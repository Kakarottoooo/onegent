import { Hero } from "./_components/Hero";
import { ScenarioGrid } from "./_components/ScenarioGrid";
import { HowItWorks } from "./_components/HowItWorks";

import "./_styles/hero.css";
import "./_styles/code-preview.css";
import "./_styles/scenario-grid.css";
import "./_styles/how-it-works.css";

export default function DevelopersHomePage() {
  return (
    <>
      <Hero />
      <ScenarioGrid />
      <HowItWorks />
      {/* US-W4-017  TrustStrip — real metrics */}
    </>
  );
}
