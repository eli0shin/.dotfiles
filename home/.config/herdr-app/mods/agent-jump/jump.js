// Jump labels for the Agents list, shown on every row: 1–9 and 0 (the tenth),
// which Ctrl+G Shift+1–0 also reach, then home-row letters first for Ctrl+;
// then a label. With more rows than single keys, every row past the tenth gets
// two letters so no label begins another.
// Herdr sandboxes each mod's imports, so agent-jump and eli-agents keep identical copies.
const DIGITS = [..."1234567890"];
const LETTERS = [..."asdfghjklqwertyuiopzxcvbnm"];

export const JUMP_KEY = "dotfiles.agents.jumping";

export function jumpLabels(count) {
  const rest = count - DIGITS.length > LETTERS.length ? LETTERS.flatMap((a) => LETTERS.map((b) => a + b)) : LETTERS;
  return [...DIGITS, ...rest].slice(0, Math.max(0, count));
}

// agent-jump sets { at } while it runs. A jump that died without clearing it
// stops showing labels after a minute.
export const jumping = (value, now) => typeof value?.at === "number" && now - value.at < 60000;
