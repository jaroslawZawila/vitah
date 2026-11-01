import { budgetPage } from "../page";

/** The Budget tab's lines. */
export default function ProjectLinesPage(props: Parameters<typeof budgetPage>[0]) {
  return budgetPage(props, "lines");
}
