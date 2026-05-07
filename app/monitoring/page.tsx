import { redirect } from "next/navigation";
import { taskWorkspaceHrefForView } from "@/lib/booking-jobs/workspace";

export default function MonitoringRedirectPage() {
  redirect(taskWorkspaceHrefForView("live"));
}
