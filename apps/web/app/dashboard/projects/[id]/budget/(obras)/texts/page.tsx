import { budgetPage } from "../page";

/** The Budget tab's texts. */
export default function ProjectTextsPage(props: Parameters<typeof budgetPage>[0]) {
  return budgetPage(props, "texts");
}
