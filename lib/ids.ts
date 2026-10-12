import { randomBytes } from "node:crypto";

// Crockford-style alphabet without look-alikes (0/O, 1/I/L), easy to read out loud.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export const newId = (prefix: string) => `${prefix}_${randomCode(16).toLowerCase()}`;

/** Customer-facing booking reference, e.g. "EE-7K3Q9M". */
export const newRefCode = () => `EE-${randomCode(6)}`;
