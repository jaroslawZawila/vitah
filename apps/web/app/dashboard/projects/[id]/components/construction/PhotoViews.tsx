"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Eye, EyeOff, ImagePlus, Trash2 } from "lucide-react";
import { todayInSpain } from "@repo/core/obra-calc";
import { MAX_CAPTION_LENGTH, MAX_PHOTO_BYTES, PHOTO_TYPES, type PhotoError, type PhotoSize, type ProjectPhoto } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FieldDescription, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import { addDays, useControlFormat } from "./format";

// Presentational: the project's site photos, grouped by week or by chapter,
// and the form that uploads them.

export type PhotoGrouping = "date" | "chapter";

type Group = { key: string; title: string; photos: ProjectPhoto[] };

/** Monday of `day`'s week. */
const weekOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

/** Photos by the week they were taken (newest first), or by chapter (in budget order, then those of none). */
export function usePhotoGroups(
  photos: ProjectPhoto[],
  grouping: PhotoGrouping,
  chapters: { code: string; name: string }[],
  today: string,
): Group[] {
  const t = useTranslations("construction.photos");
  const f = useControlFormat();
  if (grouping === "chapter") {
    const groups = chapters
      .map((c) => ({ key: c.code, title: `${c.code} · ${c.name}`, photos: photos.filter((p) => p.chapterCode === c.code) }))
      .filter((g) => g.photos.length > 0);
    const known = new Set(chapters.map((c) => c.code));
    const none = photos.filter((p) => !p.chapterCode || !known.has(p.chapterCode));
    return none.length > 0 ? [...groups, { key: "none", title: t("noChapter"), photos: none }] : groups;
  }
  const byWeek = new Map<string, ProjectPhoto[]>();
  for (const photo of [...photos].sort((a, b) => b.takenOn.localeCompare(a.takenOn))) {
    const week = weekOf(photo.takenOn);
    byWeek.set(week, [...(byWeek.get(week) ?? []), photo]);
  }
  const thisWeek = weekOf(today);
  return [...byWeek.entries()].map(([week, list]) => {
    const range = f.range(list.at(-1)!.takenOn, list[0]!.takenOn);
    return { key: week, title: week === thisWeek ? t("thisWeek", { range }) : range, photos: list };
  });
}

/** The groups of photos, each a card with its thumbnails. A photo hidden from the client's app is dimmed. */
export function PhotoGroups({
  groups,
  grouping,
  fileUrl,
  photoName,
  onToggleVisibility,
  onDelete,
  busy,
}: {
  groups: Group[];
  grouping: PhotoGrouping;
  fileUrl: (photo: ProjectPhoto, size: PhotoSize) => string;
  photoName: (photo: ProjectPhoto) => string;
  /** Omitted for viewers. */
  onToggleVisibility?: (photo: ProjectPhoto, visibleToClient: boolean) => void;
  /** Omitted for viewers. */
  onDelete?: (photo: ProjectPhoto) => void;
  /** An action is running: the buttons wait. */
  busy: boolean;
}) {
  const t = useTranslations("construction.photos");
  const f = useControlFormat();
  return (
    <>
      {groups.map((group) => (
        <section key={group.key} className={cn(cardVariants(), "gap-3")} aria-label={group.title}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2>{group.title}</h2>
            <span className="num text-muted-foreground">{t("count", { count: group.photos.length })}</span>
          </div>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(150px,100%),1fr))] gap-3 p-0">
            {group.photos.map((photo) => {
              const name = photoName(photo);
              const meta = [f.day(photo.takenOn), grouping === "date" && photo.chapterCode].filter(Boolean).join(" · ");
              return (
                <li key={photo.id}>
                  <figure className="m-0 flex flex-col gap-1.5">
                    <a href={fileUrl(photo, "full")} target="_blank" rel="noreferrer" title={t("open")} className="relative block overflow-hidden rounded-lg bg-raise">
                      {/* Served by our authenticated API, so next/image can't optimise it. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={fileUrl(photo, "thumb")}
                        alt={name}
                        loading="lazy"
                        className={cn("block aspect-[4/3] w-full object-cover", !photo.visibleToClient && "opacity-50")}
                      />
                      {!photo.visibleToClient && (
                        <Badge variant="outline" className="absolute top-2 left-2">
                          <EyeOff aria-hidden />
                          {t("hidden")}
                        </Badge>
                      )}
                    </a>
                    <figcaption className="flex flex-col gap-0.5 text-[13px]">
                      <span className="font-semibold wrap-anywhere">{name}</span>
                      <span className="flex items-center justify-between gap-1 text-muted-foreground">
                        <span className="num">{meta}</span>
                        <span className="flex items-center">
                          {onToggleVisibility && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-pressed={photo.visibleToClient}
                              disabled={busy}
                              onClick={() => onToggleVisibility(photo, !photo.visibleToClient)}
                              aria-label={t("visibleLabel", { name })}
                              title={photo.visibleToClient ? t("visible") : t("hidden")}
                            >
                              {photo.visibleToClient ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
                            </Button>
                          )}
                          <a
                            href={fileUrl(photo, "full")}
                            download
                            aria-label={t("download", { name })}
                            title={t("download", { name })}
                            className="inline-flex size-8 items-center justify-center rounded-[7px] transition-colors hover:bg-raise hover:text-foreground pointer-coarse:size-11"
                          >
                            <Download aria-hidden className="size-4" />
                          </a>
                          {onDelete && (
                            <Button
                              type="button"
                              variant="ghost-destructive"
                              size="icon-sm"
                              onClick={() => onDelete(photo)}
                              disabled={busy}
                              aria-label={t("delete", { name })}
                              title={t("delete", { name })}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          )}
                        </span>
                      </span>
                    </figcaption>
                  </figure>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

/** What the upload sends with every photo picked. */
export type PhotoUploadValues = { takenOn: string; caption: string; chapterCode: string };

/** The date a file carries (its last change, which a camera sets when it takes the photo), not after today. */
const fileDay = (file: File, today: string) => {
  const day = todayInSpain(new Date(file.lastModified));
  return day > today ? today : day;
};

/**
 * Uploads one or more photos with one date, an optional caption and the
 * chapter they show. Files can be dropped on the box or picked.
 */
export function PhotoUploadForm({
  chapters,
  today,
  chapterCode,
  pending,
  progress,
  error,
  onSubmit,
  onCancel,
  bare = false,
}: {
  chapters: { code: string; name: string }[];
  today: string;
  chapterCode?: string;
  pending: boolean;
  progress?: { done: number; total: number } | null;
  error?: PhotoError;
  onSubmit: (files: File[], values: PhotoUploadValues) => void;
  onCancel: () => void;
  /** Inside a dialog: no card, no title. */
  bare?: boolean;
}) {
  const t = useTranslations("construction.photos");
  const [files, setFiles] = useState<File[]>([]);
  const [takenOn, setTakenOn] = useState(today);
  const [caption, setCaption] = useState("");
  const [chapter, setChapter] = useState(chapterCode ?? "");
  const [dragging, setDragging] = useState(false);
  const tooLarge = files.some((file) => file.size > MAX_PHOTO_BYTES);
  const wrongType = files.some((file) => !(PHOTO_TYPES as readonly string[]).includes(file.type));

  function pick(list: File[]) {
    setFiles(list);
    if (list[0]) setTakenOn(fileDay(list[0], today));
  }

  function reset() {
    setFiles([]);
    setTakenOn(today);
    setCaption("");
    setChapter(chapterCode ?? "");
    onCancel();
  }

  return (
    <form
      aria-label={t("uploadTitle")}
      className={cn(!bare && cardVariants(), "flex flex-col gap-3.5")}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(files, { takenOn, caption: caption.trim(), chapterCode: chapter });
      }}
    >
      {!bare && <h2>{t("uploadTitle")}</h2>}
      <label
        htmlFor="photo-files"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          pick(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          "flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed bg-raise px-4 py-5 text-center text-[13px] text-muted-foreground transition-colors hover:border-primary",
          dragging && "border-primary bg-brand-soft",
        )}
      >
        <ImagePlus aria-hidden className="size-6 text-brand-ink" />
        <span>
          <b className="text-foreground">{t("dropHere")}</b>
          <br />
          {t("orPick")}
        </span>
        {files.length > 0 && <span className="font-semibold text-foreground">{t("picked", { count: files.length })}</span>}
      </label>
      <input
        id="photo-files"
        type="file"
        multiple
        accept={PHOTO_TYPES.join(",")}
        className="sr-only"
        onChange={(event) => pick(Array.from(event.target.files ?? []))}
      />
      <Field>
        <Label htmlFor="photo-date">{t("date")}</Label>
        <Input id="photo-date" type="date" className="num" required max={today} value={takenOn} onChange={(event) => setTakenOn(event.target.value)} />
        <FieldDescription>{t("dateHint")}</FieldDescription>
      </Field>
      <Field>
        <Label htmlFor="photo-caption">
          {t("caption")} <span className="text-[12px] font-normal text-muted-foreground">{t("optional")}</span>
        </Label>
        <Input
          id="photo-caption"
          maxLength={MAX_CAPTION_LENGTH}
          placeholder={t("captionPlaceholder")}
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
        />
      </Field>
      <Field>
        <Label htmlFor="photo-chapter">
          {t("chapter")} <span className="text-[12px] font-normal text-muted-foreground">{t("optional")}</span>
        </Label>
        <NativeSelect id="photo-chapter" value={chapter} onChange={(event) => setChapter(event.target.value)}>
          <NativeSelectOption value="">{t("noChapter")}</NativeSelectOption>
          {chapters.map((c) => (
            <NativeSelectOption key={c.code} value={c.code}>
              {c.code} · {c.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldDescription>{t("chapterHint")}</FieldDescription>
      </Field>
      <FormError
        namespace="construction.photos.errors"
        error={wrongType ? "invalid_file_type" : tooLarge ? "file_too_large" : error}
      />
      {progress && (
        <p role="status" className="text-[13px] text-muted-foreground">
          {t("uploading", { done: progress.done, total: progress.total })}
        </p>
      )}
      <FormActions>
        <Button type="button" variant="outline" onClick={reset}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending || files.length === 0 || tooLarge || wrongType}>
          {pending ? t("sending") : t("submit")}
        </Button>
      </FormActions>
    </form>
  );
}
