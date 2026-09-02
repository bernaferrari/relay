/** Small deterministic Chromium fixture and its measured layout oracle. */

export function fixtureMarkup(head, seededFailure) {
  const repaired = head === "repaired";
  const title = repaired ? "Arabic — RTL fixed" : "Arabic — RTL regression";
  const primaryTop = repaired ? 96 : 58;
  const overlap = repaired ? "" : `<p id="regression" role="alert">${seededFailure}</p>`;
  return `<!doctype html><html lang="ar"><head><meta charset="utf-8"><title>Settings</title><style>
body{font:20px system-ui;margin:0;padding:32px;background:#fff;color:#111}button{display:block;font:inherit;margin:24px 0;padding:12px 18px}main{max-width:340px}#regression{color:#a00} .done{position:relative;min-height:180px;direction:rtl}.done #description,.done #primary{position:absolute;right:0;width:240px;box-sizing:border-box;margin:0}.done #description{top:0;height:80px}.done #primary{top:${primaryTop}px;height:40px}
</style></head><body><main id="app"><h1 id="heading">Settings</h1><button id="language" data-testid="settings-language">Language</button></main><script>
const app=document.querySelector('#app');
document.querySelector('#language').addEventListener('click',()=>{app.innerHTML='<h1 id="heading">Language</h1><button id="arabic" data-testid="language-arabic">Arabic</button>';document.title='Language'});
document.addEventListener('click',event=>{if(event.target.id!=='arabic')return;app.className='done';app.innerHTML='<h1 id="heading">${title}</h1><p id="description" role="text">Arabic description</p><button id="primary" data-testid="primary-action">Continue</button>${overlap}';document.title='${title}'});
</script></body></html>`;
}

function fixtureError(message) {
  const error = new Error(message);
  error.name = "GoldenBrowserFixtureError";
  return error;
}

function candidateForIdentifier(overlay, identifiers, name) {
  const candidates = (overlay?.candidates ?? []).filter((candidate) =>
    identifiers.includes(candidate.identifier),
  );
  if (candidates.length !== 1) {
    throw fixtureError(
      `Browser overlay must expose exactly one ${name} element; found ${candidates.length}`,
    );
  }
  const rect = candidates[0].rect;
  if (
    !rect ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    rect.width <= 0 ||
    !Number.isFinite(rect.height) ||
    rect.height <= 0
  ) {
    throw fixtureError(`Browser overlay ${name} element has no usable bounds`);
  }
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/** Resolve the reviewed semantic pair and return its actual intersection. */
export function measuredLayout(overlay) {
  const description = candidateForIdentifier(overlay, ["description"], "description");
  // The fixture uses #primary for the DOM hook and primary-action as its
  // reviewed semantic name. Accept either representation, but never guess
  // when both or neither are present.
  const primaryAction = candidateForIdentifier(
    overlay,
    ["primary-action", "primary"],
    "primary-action",
  );
  const x = Math.max(description.x, primaryAction.x);
  const y = Math.max(description.y, primaryAction.y);
  const right = Math.min(description.x + description.width, primaryAction.x + primaryAction.width);
  const bottom = Math.min(
    description.y + description.height,
    primaryAction.y + primaryAction.height,
  );
  const overlap = right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
  return { description, primaryAction, overlap };
}
