export function stagingArchivePage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OFA Staging Archive Surface</title>
  <style>
    body { margin: 0; font: 14px/1.4 Consolas, "Courier New", monospace; background: #111; color: #d8e6d0; }
    main { max-width: 980px; margin: 0 auto; padding: 24px; }
    button, input { font: inherit; }
    button { background: #203b2b; color: #d8e6d0; border: 1px solid #527a5f; padding: 8px 10px; cursor: pointer; }
    input { background: #080c09; color: #d8e6d0; border: 1px solid #527a5f; padding: 8px; min-width: 260px; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
    pre { white-space: pre-wrap; background: #080c09; border: 1px solid #314b39; padding: 14px; min-height: 260px; }
  </style>
</head>
<body>
<main>
  <h1>OFA Staging Archive Surface</h1>
  <div class="row">
    <button data-path="/api/v1/archive/records">Records</button>
    <button data-path="/api/v1/archive/cases">Cases</button>
    <button data-path="/api/v1/archive/transmissions">Transmissions</button>
    <button data-path="/api/v1/archive/relationships">Relationships</button>
  </div>
  <div class="row">
    <input id="slug" value="phase4-signal-001" aria-label="record slug">
    <button id="loadRecord">Load Record</button>
  </div>
  <pre id="out">Awaiting archive query.</pre>
</main>
<script>
const out = document.querySelector("#out");
async function show(path) {
  const res = await fetch(path, { credentials: "include" });
  const text = await res.text();
  out.textContent = res.status + "\\n" + text;
}
for (const button of document.querySelectorAll("button[data-path]")) {
  button.addEventListener("click", () => show(button.dataset.path));
}
document.querySelector("#loadRecord").addEventListener("click", () => {
  const slug = document.querySelector("#slug").value.trim();
  show("/api/v1/archive/records/" + encodeURIComponent(slug));
});
</script>
</body>
</html>`;
}
