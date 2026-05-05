/**
 * Demo Control Room -?public surface.
 *
 * Pure types + loaders + script content. Imported by
 * `/dev/demo-control-room` page (server component) and tests.
 *
 * Read-only orchestration over the existing artifact loaders
 * (`lib/quality-gate/loader`, `lib/founder-e2e/loader`). Never
 * invokes a runner / provider / payment / OpenAI / worker.
 */

export * from "./phase2-status";
export * from "./loader";
export * from "./script";
