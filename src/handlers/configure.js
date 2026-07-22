/**
 * Serves the /configure page. Stremio opens this in a browser when the user
 * clicks "Configure". The page renders a form from manifest.config fields.
 * "Save Configuration" hands off to Stremio via the stremio:// protocol.
 * "Copy install URL" copies the config-encoded manifest URL for manual paste.
 */
export function createConfigureHandler(manifest) {
  const fields = manifest.config || [];

  return (req, res) => {
    const host = req.get('host') || 'subsync.peyloride.com';

    const fieldHtml = fields
      .map((f) => {
        const label = `<label for="${f.key}">${f.title || f.key}</label>`;
        let input;
        if (f.type === 'select') {
          const opts = (f.options || [])
            .map((o) => `<option value="${o}">${o}</option>`)
            .join('');
          input = `<select id="${f.key}" name="${f.key}">${opts}</select>`;
        } else if (f.type === 'checkbox') {
          input = `<input type="checkbox" id="${f.key}" name="${f.key}" checked />`;
        } else if (f.type === 'number') {
          input = `<input type="number" id="${f.key}" name="${f.key}" value="${f.default ?? ''}" />`;
        } else {
          const inputType = f.type === 'password' ? 'password' : 'text';
          input = `<input type="${inputType}" id="${f.key}" name="${f.key}" placeholder="${f.title || ''}" autocomplete="off" spellcheck="false" />`;
        }
        return `<div class="field">${label}${input}</div>`;
      })
      .join('\n');

    // Build one cfg-collection snippet reused by both buttons.
    const collectCfg = fields
      .map((f) => {
        if (f.type === 'checkbox') {
          return `cfg['${f.key}'] = document.getElementById('${f.key}').checked;`;
        }
        if (f.type === 'number') {
          return `cfg['${f.key}'] = Number(document.getElementById('${f.key}').value) || ${f.default ?? 0};`;
        }
        return `cfg['${f.key}'] = document.getElementById('${f.key}').value;`;
      })
      .join('\n    ');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Configure ${manifest.name}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0b141c; --panel: #14212b; --panel-2: #182833; --line: #243745;
    --ink: #e8eef2; --ink-dim: #93a7b4; --ink-faint: #5f7684;
    --accent: #4fc3f7; --accent-hi: #8fdcff; --accent-deep: #0e6e9c;
    --ok: #5ee6a8;
  }
  html, body { min-height: 100%; }
  body {
    font-family: 'IBM Plex Sans', system-ui, sans-serif; color: var(--ink);
    background: var(--bg); display: flex; justify-content: center;
    padding: 3rem 1rem 4rem; position: relative; overflow-x: hidden;
  }
  /* layered ambient background */
  body::before {
    content: ''; position: fixed; inset: 0; z-index: -2;
    background:
      radial-gradient(900px 500px at 85% -10%, rgba(79,195,247,.14), transparent 60%),
      radial-gradient(700px 500px at -10% 110%, rgba(14,110,156,.18), transparent 60%);
  }
  body::after {
    content: ''; position: fixed; inset: 0; z-index: -1; opacity: .5;
    background-image:
      linear-gradient(rgba(79,195,247,.045) 1px, transparent 1px),
      linear-gradient(90deg, rgba(79,195,247,.045) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: radial-gradient(700px 500px at 50% 0%, #000 30%, transparent 80%);
  }
  .card {
    background: linear-gradient(180deg, var(--panel-2), var(--panel));
    border: 1px solid var(--line); border-radius: 14px; padding: 2.2rem 2rem 2rem;
    max-width: 460px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,.5);
    animation: rise .45s cubic-bezier(.2,.8,.3,1) both;
  }
  @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  .eyebrow {
    font-family: 'Space Grotesk', sans-serif; font-size: .68rem; font-weight: 700;
    letter-spacing: .22em; text-transform: uppercase; color: var(--accent);
    display: flex; align-items: center; gap: .5rem; margin-bottom: .6rem;
  }
  .eyebrow::before { content: ''; width: 18px; height: 2px; background: var(--accent); }
  h1 {
    font-family: 'Space Grotesk', sans-serif; font-size: 1.9rem; font-weight: 700;
    letter-spacing: -.01em; line-height: 1.1; margin-bottom: .5rem;
  }
  p.sub { font-size: .88rem; color: var(--ink-dim); line-height: 1.5; margin-bottom: 1.6rem; }
  .field { margin-bottom: 1.05rem; }
  .field label {
    display: block; font-size: .78rem; font-weight: 600; letter-spacing: .04em;
    text-transform: uppercase; color: var(--ink-faint); margin-bottom: .35rem;
  }
  .field input[type="text"], .field input[type="password"],
  .field input[type="number"], .field select {
    width: 100%; padding: .6rem .8rem; border: 1px solid var(--line); border-radius: 8px;
    background: rgba(11,20,28,.7); color: var(--ink); font-size: .92rem;
    font-family: inherit; transition: border-color .18s, box-shadow .18s, background .18s;
  }
  .field input:focus, .field select:focus {
    outline: none; border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(79,195,247,.16); background: rgba(11,20,28,.95);
  }
  .field input[type="checkbox"] { width: 1.15rem; height: 1.15rem; accent-color: var(--accent); cursor: pointer; }
  .field:has(input[type="checkbox"]) { display: flex; align-items: center; gap: .6rem; }
  .field:has(input[type="checkbox"]) label { margin: 0; text-transform: none; font-size: .9rem; color: var(--ink-dim); cursor: pointer; }
  .actions { display: grid; gap: .6rem; margin-top: 1.4rem; }
  button {
    width: 100%; padding: .75rem 1rem; border-radius: 8px; font-family: 'Space Grotesk', sans-serif;
    font-size: .95rem; font-weight: 700; letter-spacing: .02em; cursor: pointer;
    transition: transform .15s, box-shadow .15s, background .15s, color .15s, border-color .15s;
  }
  button:active { transform: translateY(1px) scale(.99); }
  .btn-primary {
    border: none; background: var(--accent); color: #062230;
    box-shadow: 0 6px 20px rgba(79,195,247,.28);
  }
  .btn-primary:hover { background: var(--accent-hi); box-shadow: 0 8px 26px rgba(79,195,247,.4); transform: translateY(-1px); }
  .btn-ghost {
    border: 1px solid var(--line); background: transparent; color: var(--ink-dim);
  }
  .btn-ghost:hover { border-color: var(--accent); color: var(--accent); background: rgba(79,195,247,.06); }
  .btn-ghost.copied { border-color: var(--ok); color: var(--ok); background: rgba(94,230,168,.08); }
  .urlbox {
    margin-top: .9rem; display: none; animation: rise .3s ease both;
  }
  .urlbox.show { display: block; }
  .urlbox label {
    display: block; font-size: .72rem; font-weight: 600; letter-spacing: .06em;
    text-transform: uppercase; color: var(--ink-faint); margin-bottom: .35rem;
  }
  .urlbox textarea {
    width: 100%; min-height: 64px; resize: vertical; padding: .6rem .8rem;
    border: 1px solid var(--line); border-radius: 8px; background: rgba(11,20,28,.8);
    color: var(--accent); font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: .74rem; line-height: 1.5; word-break: break-all;
  }
  .urlbox textarea:focus { outline: none; border-color: var(--accent); }
  .hint { margin-top: .8rem; font-size: .75rem; color: var(--ink-faint); text-align: center; }
</style>
</head>
<body>
<div class="card">
  <div class="eyebrow">Stremio Addon</div>
  <h1>${manifest.name}</h1>
  <p class="sub">${manifest.description}</p>
  <form id="cfg">
    ${fieldHtml}
    <div class="actions">
      <button type="submit" class="btn-primary">Save Configuration</button>
      <button type="button" class="btn-ghost" id="copyBtn">Copy install URL</button>
    </div>
    <div class="urlbox" id="urlbox">
      <label for="urlField">Install URL</label>
      <textarea id="urlField" readonly></textarea>
      <div class="hint">Paste this into Stremio &rarr; Addons &rarr; search by URL</div>
    </div>
  </form>
</div>
<script>
function collectCfg() {
  var cfg = {};
  ${collectCfg}
  return cfg;
}
function buildUrl(cfg) {
  var encoded = encodeURIComponent(JSON.stringify(cfg));
  return 'https://${host}/' + encoded + '/manifest.json';
}
document.getElementById('cfg').addEventListener('submit', function(e) {
  e.preventDefault();
  var url = buildUrl(collectCfg());
  window.location.href = url.replace('https://', 'stremio://');
});
document.getElementById('copyBtn').addEventListener('click', function() {
  var url = buildUrl(collectCfg());
  var btn = this;
  var box = document.getElementById('urlbox');
  var field = document.getElementById('urlField');
  field.value = url;
  box.classList.add('show');
  function done() {
    btn.textContent = 'Copied to clipboard';
    btn.classList.add('copied');
    setTimeout(function() {
      btn.textContent = 'Copy install URL';
      btn.classList.remove('copied');
    }, 1800);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(function() {
      field.select(); document.execCommand('copy'); done();
    });
  } else {
    field.select(); document.execCommand('copy'); done();
  }
});
</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(html);
  };
}
