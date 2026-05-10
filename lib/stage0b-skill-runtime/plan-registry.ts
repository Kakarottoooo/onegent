import { EVENTBRITE_SKILL_FORGE_PLAN } from "./eventbrite-forge-plan";
import { STUBHUB_SKILL_FORGE_PLAN } from "./stubhub-forge-plan";
import { STAGE0B_TEST_PLAN } from "./test-plan";
import { TICKETMASTER_SKILL_FORGE_PLAN } from "./ticketmaster-forge-plan";
import type {
  LabTestPlanEntry,
  Stage0bLabPlanName,
} from "./types";

export interface Stage0BLabPlanDefinition {
  name: Stage0bLabPlanName;
  entries: ReadonlyArray<LabTestPlanEntry>;
}

export const STAGE0B_LAB_PLAN_REGISTRY: Record<Stage0bLabPlanName, Stage0BLabPlanDefinition> = {
  stage0b: {
    name: "stage0b",
    entries: STAGE0B_TEST_PLAN,
  },
  "ticketmaster-forge": {
    name: "ticketmaster-forge",
    entries: TICKETMASTER_SKILL_FORGE_PLAN,
  },
  "stubhub-forge": {
    name: "stubhub-forge",
    entries: STUBHUB_SKILL_FORGE_PLAN,
  },
  "eventbrite-forge": {
    name: "eventbrite-forge",
    entries: EVENTBRITE_SKILL_FORGE_PLAN,
  },
};

export function isStage0BLabPlanName(value: unknown): value is Stage0bLabPlanName {
  return typeof value === "string" && value in STAGE0B_LAB_PLAN_REGISTRY;
}

export function getStage0BLabPlanNames(): Stage0bLabPlanName[] {
  return Object.keys(STAGE0B_LAB_PLAN_REGISTRY) as Stage0bLabPlanName[];
}

export function getStage0BLabPlanEntries(plan: Stage0bLabPlanName): LabTestPlanEntry[] {
  return [...STAGE0B_LAB_PLAN_REGISTRY[plan].entries];
}

export function getAllStage0BLabPlanEntries(): LabTestPlanEntry[] {
  return getStage0BLabPlanNames().flatMap((plan) => getStage0BLabPlanEntries(plan));
}
