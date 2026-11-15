// Patterns and limits shared by the services and their input schemas (./inputs).

/** A phone number as staff type it: digits, spaces, brackets and dashes, an optional leading +. */
export const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{5,19}$/;

/** An email address, loosely: something@something.something, no spaces. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The usual cap for a name, email, title or address. */
export const MAX_TEXT = 200;
