/** One POSIX shell argument for a printed command, quoted only when needed. */
export function quoteShellArg(value: string): string {
  if (/^[a-zA-Z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
