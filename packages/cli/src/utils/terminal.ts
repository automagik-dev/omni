import { stripVTControlCharacters } from 'node:util';

/** Keep untrusted text on one terminal line, with no ANSI commands or ASCII controls. */
export function stripTerminalControls(text: string): string {
  return Array.from(stripVTControlCharacters(text))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');
}
