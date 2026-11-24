"use client";

// Container for Obra › Planificación › Editar: the only part of it that knows
// about server actions (save, approve, discard). It recomputes the dates with
// core's arithmetic as staff type; the views in ../../../components/planning
// take props only.

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { PlanningCalendar, PlanningDraft, PlanningItemInput } from "@repo/core/contract";
import { chainRules, criticalPath, moveChapter, planCheck, planEnd, planProblem, schedulePlan, type Recorded } from "@repo/core/planning-calc";
import { Badge } from "@/components/ui/badge";
import {
  approvePlanningDraftAction,
  discardPlanningDraftAction,
  updatePlanningDraftAction,
} from "../../../../../../actions/planning";
import BackLink from "../../../../../components/BackLink";
import FormError from "../../../../../components/FormError";
import { useConfirm } from "../../../../../components/useConfirm";
import { useObraAction } from "../../../components/obra/useObraAction";
import { ApproveCard, CalendarBar, DraftCheck, DraftTable, type RuleChange } from "../../../components/planning/DraftViews";
import { planningHref } from "../../../components/planning/links";

const toRule = ({ code, after, lagDays, durationDays, fixedStart, spansWorks }: PlanningItemInput): PlanningItemInput => ({
  code,
  after,
  lagDays,
  durationDays,
  fixedStart,
  spansWorks,
});

/** Edit the draft's order, lags, lengths and calendar, see the dates they give, then approve it as the baseline. */
export default function EditPlanScreen({
  projectId,
  draft,
  canManage,
}: {
  projectId: string;
  draft: PlanningDraft;
  canManage: boolean;
}) {
  const t = useTranslations("planning.edit");
  const router = useRouter();
  const action = useObraAction();
  const confirm = useConfirm("planning.errors");
  const [rules, setRules] = useState(() => draft.rows.map(toRule));
  const [startDate, setStartDate] = useState(draft.version.startDate);
  const [calendar, setCalendar] = useState<PlanningCalendar>(draft.calendar);
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);

  const recorded = useMemo(
    () => new Map<string, Recorded>(draft.rows.map((r) => [r.code, { actualStart: r.actualStart, actualEnd: r.actualEnd }])),
    [draft.rows],
  );
  // Only when the plan changes, not on every render (typing a reason, a pending action).
  // `rules` is always a chain (core's, kept so by `moveRule`), so what is checked is what is sent.
  const { problem, dates, check, critical } = useMemo(() => {
    const problem = planProblem(rules);
    const dates = problem ? null : schedulePlan(rules, { startDate, calendar, recorded, today: draft.today });
    const end = dates && planEnd(dates);
    return {
      problem,
      dates,
      check: end ? planCheck(end, draft.completionDate) : null,
      critical: dates ? criticalPath(rules, dates, recorded) : new Set<string>(),
    };
  }, [rules, startDate, calendar, recorded, draft.today, draft.completionDate]);
  const input = { items: rules.map(({ code, lagDays, durationDays }) => ({ code, lagDays, durationDays })), startDate, ...calendar };
  const back = planningHref(projectId);

  const edited = () => {
    setSaved(false);
    action.reset();
  };
  const changeRule = (code: string, change: RuleChange) => {
    edited();
    setRules((all) => all.map((rule) => (rule.code === code ? { ...rule, ...change } : rule)));
  };
  // The order is the sequence, saved with the rules: the dates follow it. A chapter that
  // comes first starts with the works and loses its lag, as core stores it.
  const moveRule = (code: string, toCode: string) => {
    edited();
    setRules((all) => chainRules(moveChapter(all, code, toCode)));
  };

  return (
    <div className="flex flex-col gap-[18px]">
      <BackLink href={back} />
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <span className="eyebrow text-brand-ink">{t("eyebrow", { ref: draft.ref })}</span>
          <h1 className="mt-1.5">{t("title")}</h1>
          <p className="mt-1 max-w-[80ch] text-[14px] text-muted-foreground">{t("description")}</p>
        </div>
        <Badge variant="yel">{t("badge", { number: draft.version.number })}</Badge>
      </header>

      <CalendarBar
        startDate={startDate}
        calendar={calendar}
        readOnly={!canManage}
        onChange={({ startDate: start, ...change }) => {
          edited();
          if (start) setStartDate(start);
          setCalendar((current) => ({ ...current, ...change }));
        }}
      />
      <DraftTable
        rows={draft.rows}
        rules={rules}
        dates={dates}
        critical={critical}
        readOnly={!canManage}
        onChange={changeRule}
        onMove={moveRule}
      />
      <div className="grid items-start gap-[18px] md:grid-cols-2">
        <DraftCheck check={check} problem={problem && <FormError namespace="planning.errors" error={problem} />} />
        {canManage && (
          <ApproveCard
            number={draft.version.number}
            first={draft.baseline === null}
            reason={reason}
            pending={action.pending || confirm.pending}
            canApprove={problem === null}
            saved={saved}
            error={<FormError namespace="planning.errors" error={action.state?.error} />}
            onReason={setReason}
            onApprove={() => action.run(() => approvePlanningDraftAction(projectId, input, reason), () => router.push(back))}
            onSave={() => action.run(() => updatePlanningDraftAction(projectId, input), () => setSaved(true))}
            onDiscard={() =>
              confirm.ask({
                t,
                key: "approve.discardDialog",
                values: { number: draft.version.number },
                destructive: true,
                action: () => discardPlanningDraftAction(projectId),
                onDone: () => router.push(back),
              })
            }
          />
        )}
      </div>
      {confirm.dialog}
    </div>
  );
}
