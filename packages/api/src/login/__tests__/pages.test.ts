import { describe, expect, test } from 'bun:test';
import { appPage, claimPage, devicePage, landingPage } from '../pages';

/** The one inline script a page runs: the shared helpers and the page's own, in one scope. */
const scriptOf = (html: string) =>
  html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));

describe('login pages', () => {
  // A page's script shares one scope with the shared helpers: a name declared twice there is a
  // SyntaxError, and the whole page does nothing.
  test('every page script parses', () => {
    for (const [name, html] of [
      ['claim', claimPage()],
      ['device', devicePage({ 'omni-dsh': 'Automagik' })],
      ['app', appPage()],
      ['app with a grant', appPage({ grant: 'A'.repeat(24) })],
      ['landing', landingPage({ publicUrl: 'https://omni.example.com' })],
    ] as const) {
      expect(() => new Function(scriptOf(html)), name).not.toThrow();
    }
  });

  test("the claim page's last step opens Automagik with the link the claim hands back", () => {
    const html = claimPage();
    expect(html).toContain('<a class="btn primary" id="openApp">Open in Automagik</a>');
    const script = scriptOf(html);
    expect(script).toContain("claimLink = (await claim('POST', '/token')).appLink || null;");
    expect(script).toContain("if (claimLink) { $('openApp').href = claimLink; $('openHere').hidden = false; }");
  });
});
