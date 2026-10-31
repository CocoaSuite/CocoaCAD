let counter = 0;

/** Short unique id; random part avoids collisions across sessions and merged files. */
export function newId(prefix = ""): string {
  counter = (counter + 1) % 0xffff;
  const rand = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}
