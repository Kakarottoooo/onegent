import * as fs from "node:fs";
import * as path from "node:path";
const p = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(p)) for (const line of fs.readFileSync(p,"utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"(.*)"$/,"$1");
}
import("../lib/db").then(async ({sql}) => {
  const j = await sql`SELECT id, status, user_id, steps->0 as step0, created_at, updated_at FROM booking_jobs WHERE id='b6c54862-0ee3-4134-a211-33670f68bfdb'`;
  const r = j.rows[0];
  console.log("job:", { id: r.id, status: r.status, user_id: r.user_id, created: r.created_at, updated: r.updated_at });
  const step = r.step0 as any;
  console.log("step.status:", step.status);
  console.log("step.error:", step.error);
  console.log("step.attemptCount:", step.attemptCount);
  console.log("step.body keys:", Object.keys(step.body));
  console.log("step.body.__source:", step.body.__source);
  console.log("step.body.scenario:", step.body.scenario);
  console.log("has step.body.profile:", !!step.body.profile);
  if (step.body.profile) console.log("profile fields:", Object.keys(step.body.profile));
  console.log("step.body.profileId:", step.body.profileId);
  process.exit(0);
});
