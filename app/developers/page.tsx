import { Hero } from "./_components/Hero";
import { ScenarioGrid } from "./_components/ScenarioGrid";

import "./_styles/hero.css";
import "./_styles/code-preview.css";
import "./_styles/scenario-grid.css";

export default function DevelopersHomePage() {
  return (
    <>
      <Hero />
      <ScenarioGrid />
      {/*
        Sections to come:
          US-W4-016  HowItWorks   (SVG flow)
          US-W4-017  TrustStrip   (real metrics)
      */}
    </>
  );
}
