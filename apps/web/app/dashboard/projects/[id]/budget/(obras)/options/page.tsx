import { budgetPage } from "../page";

/** The Budget tab's options. */
export default function ProjectOptionsPage(props: Parameters<typeof budgetPage>[0]) {
  return budgetPage(props, "options");
}
