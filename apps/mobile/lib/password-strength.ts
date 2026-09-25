// The strength meter of "Cambiar contraseña". Whether a password is allowed
// is isStrongPassword from @repo/core/contract, the rule the server applies.

export type Strength = "weak" | "fair" | "good" | "strong";

/** 0–4 filled bars and a label; `null` while empty. */
export function passwordStrength(password: string): { bars: number; label: Strength } | null {
  if (!password) return null;
  const bars = [
    password.length >= 10,
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password) || password.length >= 14,
  ].filter(Boolean).length;
  const labels: Strength[] = ["weak", "weak", "fair", "good", "strong"];
  return { bars, label: labels[bars]! };
}
