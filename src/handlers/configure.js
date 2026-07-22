/**
 * Serves the /configure page. Stremio opens this in a browser when the user
 * clicks "Configure". The page renders a form from manifest.config fields,
 * and on submit redirects to /{json-config}/manifest.json which Stremio
 * installs as a pre-configured addon.
 */
export function createConfigureHandler(manifest) {
  const fields = manifest.config || [];

  return (_req, res) => {
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
          // text / password
          const inputType = f.type === 'password' ? 'password' : 'text';
          input = `<input type="${inputType}" id="${f.key}" name="${f.key}" placeholder="${f.title || ''}" />`;
        }
        return `<div class="field">${label}${input}</div>`;
      })
      .join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Configure ${manifest.name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: #0f1923; color: #e0e0e0; display: flex; justify-content: center;
         padding: 2rem 1rem; min-height: 100vh; }
  .card { background: #17242d; border-radius: 12px; padding: 2rem; max-width: 480px;
          width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,.4); }
  h1 { font-size: 1.3rem; margin-bottom: .5rem; color: #4fc3f7; }
  p.sub { font-size: .85rem; color: #8899a6; margin-bottom: 1.5rem; }
  .field { margin-bottom: 1rem; }
  .field label { display: block; font-size: .85rem; margin-bottom: .3rem; color: #b0bec5; }
  .field input[type="text"], .field input[type="password"],
  .field input[type="number"], .field select {
    width: 100%; padding: .5rem .7rem; border: 1px solid #2a3a45; border-radius: 6px;
    background: #0f1923; color: #e0e0e0; font-size: .9rem; }
  .field input[type="checkbox"] { width: 1.1rem; height: 1.1rem; accent-color: #4fc3f7; }
  button { width: 100%; padding: .7rem; margin-top: .5rem; border: none; border-radius: 6px;
           background: #4fc3f7; color: #0f1923; font-size: 1rem; font-weight: 600;
           cursor: pointer; }
  button:hover { background: #81d4fa; }
</style>
</head>
<body>
<div class="card">
  <h1>${manifest.name}</h1>
  <p class="sub">${manifest.description}</p>
  <form id="cfg">
    ${fieldHtml}
    <button type="submit">Install Addon</button>
  </form>
</div>
<script>
document.getElementById('cfg').addEventListener('submit', function(e) {
  e.preventDefault();
  var cfg = {};
  ${fields
    .map((f) => {
      if (f.type === 'checkbox') {
        return `cfg['${f.key}'] = document.getElementById('${f.key}').checked;`;
      }
      if (f.type === 'number') {
        return `cfg['${f.key}'] = Number(document.getElementById('${f.key}').value) || ${f.default ?? 0};`;
      }
      return `cfg['${f.key}'] = document.getElementById('${f.key}').value;`;
    })
    .join('\n  ')}
  var encoded = encodeURIComponent(JSON.stringify(cfg));
  window.location.href = '/' + encoded + '/manifest.json';
});
</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(html);
  };
}
