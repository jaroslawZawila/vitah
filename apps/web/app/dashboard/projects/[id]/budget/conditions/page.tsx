import { budgetPage } from "../page";

/** The Budget tab's conditions. */
export default function ProjectConditionsPage(props: Parameters<typeof budgetPage>[0]) {
  return budgetPage(props, "conditions");
}
