import type { CSSProperties } from "react";

/** The grid columns of an obra table from 768px (see `.row` in obra.module.css). */
export const columns = (template: string) => ({ "--columns": template }) as CSSProperties;
