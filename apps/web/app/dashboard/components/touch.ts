// Touch targets: 44 px for a finger (`pointer: coarse`), today's density for a mouse.

/** A text link on its own (a table cell's, a card's secondary link): 44 px tall on touch screens. */
export const touchLink = "pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center";

/** A row's or card's main link stretched over it on touch screens (the row or card is `relative`). */
export const touchStretch = "pointer-coarse:after:absolute pointer-coarse:after:inset-0";

/** A card's or list item's main link stretched over it at every width (the card or item is `relative`). */
export const stretchedLink = "after:absolute after:inset-0";
