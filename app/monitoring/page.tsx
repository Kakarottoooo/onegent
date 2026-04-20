import { redirect } from "next/navigation";

export default function MonitoringRedirectPage() {
  redirect("/tasks?view=live");
}
