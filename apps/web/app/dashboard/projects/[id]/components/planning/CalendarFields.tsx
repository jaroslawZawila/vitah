"use client";

import { useTranslations } from "next-intl";
import { PLANNING_REGIONS, type PlanningCalendar, type PlanningRegion } from "@repo/core/contract";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

// Presentational: which days a plan works: the region's holidays and the
// August and Christmas closures (generating a first plan, editing a draft).

const check = "flex min-h-11 cursor-pointer items-center gap-2.5 text-[13.5px]";

export default function CalendarFields({
  id,
  calendar,
  disabled = false,
  onChange,
}: {
  /** Prefix of the fields' ids, unique on the page. */
  id: string;
  calendar: PlanningCalendar;
  disabled?: boolean;
  onChange: (change: Partial<PlanningCalendar>) => void;
}) {
  const t = useTranslations("planning.calendar");
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-region`}>{t("region")}</Label>
        <NativeSelect
          id={`${id}-region`}
          value={calendar.region ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ region: (e.target.value || null) as PlanningRegion | null })}
        >
          <NativeSelectOption value="">{t("regions.none")}</NativeSelectOption>
          {PLANNING_REGIONS.map((r) => (
            <NativeSelectOption key={r} value={r}>
              {t(`regions.${r}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <label className={check}>
        <input
          type="checkbox"
          className="size-[18px] accent-primary"
          checked={calendar.augustClosure}
          disabled={disabled}
          onChange={(e) => onChange({ augustClosure: e.target.checked })}
        />
        {t("augustClosure")}
      </label>
      <label className={check}>
        <input
          type="checkbox"
          className="size-[18px] accent-primary"
          checked={calendar.christmasClosure}
          disabled={disabled}
          onChange={(e) => onChange({ christmasClosure: e.target.checked })}
        />
        {t("christmasClosure")}
      </label>
    </>
  );
}
