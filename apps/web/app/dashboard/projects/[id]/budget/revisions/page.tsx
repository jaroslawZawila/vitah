import { budgetPage } from "../page";

/** The Budget tab's revisions. */
export default function ProjectRevisionsPage(props: Parameters<typeof budgetPage>[0]) {
  return budgetPage(props, "revisions");
}
