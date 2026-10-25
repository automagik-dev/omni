/**
 * GET /market: the Automagik marketplace, for a person. The catalog this Omni serves and
 * how to add its index to a DeepSeek Harness. The octopus page shell of the login pages; the
 * catalog arrives as JSON and is inserted with textContent, never as HTML.
 */

import { page } from '../login/pages';
import type { Catalog } from './service';

const MARKET_STYLE = `<style>
.plugin{border:1px solid var(--line);border-radius:13px;padding:12px 14px;margin:10px 0;background:rgba(255,255,255,.02)}
.plugin .head{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}.plugin .head strong{font-size:15px}
.plugin code{font:12px/1.4 ui-monospace,monospace;color:var(--ink2);overflow-wrap:anywhere}.plugin p{margin:6px 0 8px;font-size:14px}
.tag{display:inline-block;margin:0 6px 0 0;padding:3px 8px;border-radius:999px;border:1px solid rgba(34,211,197,.45);color:var(--accent);font:600 11px/1.2 ui-monospace,monospace}
.tag.here{color:#05070f;background:var(--accent);border-color:var(--accent)}
ol{margin:0 0 12px;padding-left:20px;color:var(--ink2)}li{margin:4px 0}h2{font-size:17px;margin:22px 0 8px}
</style>`;

/** JSON a `<script>` may hold: no `<` survives, so no `</script>` either. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

export function marketPage(catalog: Catalog): string {
  return page(
    'Automagik marketplace',
    `${MARKET_STYLE}
<section id="market"><h1>Automagik marketplace</h1><p>The DeepSeek Harness plugins of this Omni's release, and the Automagik plugins it was tested with.</p>
<div id="plugins"></div>
<h2>Add it to your DSH</h2>
<ol><li>Settings → Plugins → enable <strong>Plugin market</strong>.</li><li>Market → Indexes → add this index:</li></ol>
<code class="cmd" id="indexUrl"></code><button class="primary" id="copy">Copy the index URL</button></section>`,
    `
const CATALOG = ${scriptJson(catalog)};
const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node; };
for (const plugin of CATALOG.plugins) {
  const card = el('div', 'plugin');
  const head = el('div', 'head');
  head.append(el('strong', '', plugin.title), el('code', '', plugin.name + '@' + plugin.version));
  card.append(head);
  if (plugin.description) card.append(el('p', '', plugin.description));
  if (plugin.bundled) card.append(el('span', 'tag here', 'From this Omni'));
  for (const label of plugin.labels) card.append(el('span', 'tag', label));
  $('plugins').append(card);
}
if (!CATALOG.plugins.length) $('plugins').append(el('p', 'muted', 'Nothing is listed here yet.'));
$('indexUrl').textContent = CATALOG.indexUrl;
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(CATALOG.indexUrl); say('Copied. Paste it under Market → Indexes.'); glitch(); }
  catch { getSelection().selectAllChildren($('indexUrl')); say('Selected: copy it with your keyboard.'); }
};
speak('Plugins for your DSH, straight from me. Add my index and pick what you like.');`,
  );
}
