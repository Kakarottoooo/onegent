import {
  buildActivitySkillReadinessReport,
  renderActivitySkillReadinessMarkdown,
} from "@/lib/activity-skills";

function main() {
  const args = new Set(process.argv.slice(2));
  const report = buildActivitySkillReadinessReport();
  if (args.has("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderActivitySkillReadinessMarkdown(report));
  }
  if (args.has("--gate") && !report.summary.noLiveGatePass) {
    process.exitCode = 1;
  }
}

main();
