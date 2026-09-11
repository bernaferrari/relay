import type { CombineEvidencePackManifest } from "@relay/protocol";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

/** Self-contained and usable over file://; no fetch, CDN, or external scripts. */
export function comparisonHtml(manifest: CombineEvidencePackManifest): string {
  const data = JSON.stringify(manifest.content ?? { pages: [], duplicateGroups: [] }).replace(
    /</gu,
    "\\u003c",
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(manifest.title)} · Compare</title>
<style>
:root{color-scheme:light dark;--bg:oklch(98% 0 0);--surface:oklch(100% 0 0);--fg:oklch(22% 0 0);--muted:oklch(48% 0 0);--line:oklch(88% 0 0);font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}*{box-sizing:border-box}body{margin:0}main{max-width:1800px;margin:auto;padding:32px}h1{font-size:24px;letter-spacing:-.025em;margin:0}p{color:var(--muted);margin:8px 0 24px}a{color:inherit;text-underline-offset:3px}header{margin-bottom:24px}.toolbar{display:flex;gap:20px;align-items:end;flex-wrap:wrap;margin:24px 0}label{display:grid;gap:6px;font-size:13px;color:var(--muted)}select{font:inherit;color:var(--fg);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px 12px;min-width:200px;max-width:100%}select:hover{background:color-mix(in oklch,var(--surface),var(--fg) 4%)}:focus-visible{outline:2px solid oklch(60% .19 250);outline-offset:3px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}.preview{min-width:0}.preview img{display:block;width:100%;height:auto;background:var(--surface);border-radius:10px}.links{display:flex;gap:16px;margin:12px 0;font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 system-ui,sans-serif;padding:16px;background:var(--surface);border-radius:8px}summary{cursor:pointer;color:var(--muted)}.missing{padding:40px;background:var(--surface);border-radius:10px}.status{font-size:13px;margin-bottom:16px}@media(max-width:700px){main{padding:20px}.pair{grid-template-columns:1fr}select{min-width:160px}}@media(prefers-color-scheme:dark){:root{--bg:oklch(18% 0 0);--surface:oklch(22% 0 0);--fg:oklch(93% 0 0);--muted:oklch(72% 0 0);--line:oklch(33% 0 0)}}
</style></head><body><main><header><h1>Capture comparison</h1><p>Compare captured screens and their original text. Matching text is grouped; every capture is retained.</p><a href="index.html">Run report</a></header><div class="toolbar"><label>Screen<select id="screen"></select></label><label>Left capture<select id="left"></select></label><label>Right capture<select id="right"></select></label></div><p id="status" class="status" role="status"></p><div class="pair"><section id="a" class="preview" aria-label="Left preview"></section><section id="b" class="preview" aria-label="Right preview"></section></div></main>
<script type="application/json" id="data">${data}</script><script>
const data=JSON.parse(document.getElementById('data').textContent),screen=document.getElementById('screen'),left=document.getElementById('left'),right=document.getElementById('right');
function options(select,values){const previous=select.value;select.replaceChildren(...values.map(([value,label])=>new Option(label,value)));if(values.some(([v])=>v===previous))select.value=previous;}
options(screen,[...new Set(data.pages.map(p=>p.canonicalKey))].map(k=>[k,k.replace('frame-','Screen ')]));
function pathUrl(path){return path.split('/').map(encodeURIComponent).join('/');}
function render(id,path){const root=document.getElementById(id),p=data.pages.find(p=>p.path===path);root.replaceChildren();if(!p){root.textContent='No capture available';return;}const image=document.createElement('img');image.src=pathUrl(p.path);image.alt=p.locale+' · '+p.canonicalKey;root.append(image);const links=document.createElement('div');links.className='links';for(const [label,path] of [['Original image',p.path],['Accessibility',p.accessibilityPath],['Text',p.textPath]]){if(!path)continue;const a=document.createElement('a');a.textContent=label;a.href=pathUrl(path);links.append(a);}root.append(links);const details=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('pre');summary.textContent='Captured text';text.textContent=p.text||'No accessibility text was captured. This page is excluded from text deduplication.';details.append(summary,text);root.append(details);}
function draw(){render('a',left.value);render('b',right.value);const a=data.pages.find(p=>p.path===left.value),b=data.pages.find(p=>p.path===right.value);document.getElementById('status').textContent=!a||!b?'No comparable captures':!a.textSha256||!b.textSha256?'Text comparison unavailable for one or both captures':a.textSha256===b.textSha256?'Captured text matches exactly':'Captured text differs';}
function choose(){const pages=data.pages.filter(p=>p.canonicalKey===screen.value),values=pages.map((p,index)=>[p.path,p.locale+(pages.filter(other=>other.locale===p.locale).length>1?' · Run '+(index+1):'')]);options(left,values);options(right,values);if(left.value===right.value&&values.length>1)right.value=values[1][0];draw();}
screen.onchange=choose;left.onchange=draw;right.onchange=draw;choose();
</script></body></html>`;
}
