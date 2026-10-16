// Customer contact rules, shared by the server and the details form in the chat
// so both accept and reject the same input.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normaliseName = (name: string) => name.trim().replace(/\s+/g, " ");
export const normaliseEmail = (email: string) => email.trim().toLowerCase();

export const isValidName = (name: string) => {
  const n = normaliseName(name);
  return n.length >= 2 && n.length <= 100;
};

export const isValidEmail = (email: string) => {
  const e = normaliseEmail(email);
  return EMAIL_RE.test(e) && e.length <= 200;
};

// Misspellings of the most common mail domains and endings.
const DOMAIN_FIXES: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gnail.com": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com",
  "outlook.con": "outlook.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "icloud.con": "icloud.com",
  "iclod.com": "icloud.com",
};

/** "jane@gmial.com" → "jane@gmail.com"; null when nothing looks mistyped. */
export function suggestEmail(email: string): string | null {
  const e = normaliseEmail(email);
  const at = e.lastIndexOf("@");
  if (at < 1) return null;
  const domain = e.slice(at + 1);
  const fixed = DOMAIN_FIXES[domain] ?? (domain.endsWith(".con") ? `${domain.slice(0, -4)}.com` : null);
  return fixed ? `${e.slice(0, at)}@${fixed}` : null;
}
