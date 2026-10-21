import { allowedModules, type Actor } from "../domain";
import { roleHome } from "../role-home";

export function roleAiFocus(actor: Actor) {
  if (["MD", "MD Assistant", "IT Administrator", "Group Manager", "Branch Manager"].includes(actor.role)) return "Company performance, risks and decisions requiring management attention.";
  return `${roleHome(actor).title}: ${roleHome(actor).description}`;
}
export function roleAiExamples(actor: Actor) {
  const allowed = allowedModules(actor);
  const examples: string[] = [];
  if (actor.role.startsWith("Accounts") || actor.role === "Accountant") examples.push("How much is overdue from customers?", "How many accounts records are in each status?");
  if (actor.role.startsWith("HR")) examples.push("How many employee records are in each status?");
  if (actor.role.startsWith("Logistics")) examples.push("How many shipments are in each status?");
  if (actor.role.startsWith("Marketing")) examples.push("How many marketing records are in each status?");
  if (actor.role === "IT Administrator" || actor.role === "Employee") examples.push("How many support tickets are in each status?");
  if (allowed.includes("leads")) examples.push("Which follow-ups are overdue?", "How is our pipeline looking?");
  if (allowed.includes("quotations")) examples.push("How many quotations are in each status?");
  if (allowed.includes("orders")) examples.push("How many orders are in each status?");
  return examples.slice(0, 4);
}
