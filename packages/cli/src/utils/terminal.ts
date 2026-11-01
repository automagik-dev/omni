import { stripVTControlCharacters } from 'node:util';

/** Keep untrusted text on one terminal line, without terminal controls or bidi overrides. */
export function stripTerminalControls(text: string): string {
  return Array.from(stripVTControlCharacters(text))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return (
        code >= 32 &&
        !(code >= 0x7f && code <= 0x9f) &&
        code !== 0x200e &&
        code !== 0x200f &&
        !(code >= 0x202a && code <= 0x202e) &&
        !(code >= 0x2066 && code <= 0x2069)
      );
    })
    .join('');
}
