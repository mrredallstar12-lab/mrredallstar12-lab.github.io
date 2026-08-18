export function stagingAccountPage() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>OFA Staging Account Test</title>
  <style>
    body{font-family:system-ui,Segoe UI,sans-serif;margin:24px;max-width:900px;background:#f4f1e8;color:#171717}
    section{border:1px solid #222;padding:16px;margin:0 0 16px;background:#fff}
    label{display:block;margin:8px 0}
    input,button,textarea{font:inherit;padding:8px;margin:4px 0}
    button{cursor:pointer}
    pre{white-space:pre-wrap;background:#111;color:#e9ffe1;padding:12px;min-height:160px}
  </style>
</head>
<body>
  <h1>OFA Staging Account Test</h1>
  <p>Local/staging instrumentation only. Not public UI.</p>
  <section>
    <h2>Register</h2>
    <label>Username <input id="regUsername" value="LuKe-Test"></label>
    <label>Email <input id="regEmail" value="luke-test@example.invalid"></label>
    <button onclick="registerAccount()">register</button>
  </section>
  <section>
    <h2>Email Link Sign-In</h2>
    <label>Email <input id="loginEmail" value="luke-test@example.invalid"></label>
    <button onclick="startEmail()">start email link</button>
    <label>Token from local server log <input id="emailToken"></label>
    <button onclick="completeEmail()">complete sign-in</button>
  </section>
  <section>
    <h2>Authenticated Checks</h2>
    <button onclick="me()">GET /me</button>
    <button onclick="addPhase3Discovery()">add Phase 3 test discovery</button>
    <button onclick="discoveries()">list discoveries</button>
    <button onclick="grantItem()">grant staging test item</button>
    <button onclick="inventory()">inventory</button>
    <button onclick="logout()">logout</button>
  </section>
  <section>
    <h2>Phase 4 Archive Discoveries</h2>
    <p>Grant one approved Phase 4 staging discovery at a time.</p>
    <button onclick="grantPhase4Discovery('phase4.signal001.transcript')">grant phase4.signal001.transcript</button>
    <button onclick="grantPhase4Discovery('phase4.caseecho.personnel')">grant phase4.caseecho.personnel</button>
    <button onclick="grantPhase4Discovery('phase4.relationship.echo')">grant phase4.relationship.echo</button>
    <button onclick="grantPhase4Discovery('phase4.withheld.null')">grant phase4.withheld.null</button>
  </section>
  <pre id="out">Waiting.</pre>
  <script>
    let csrf = "";
    function out(value){document.getElementById("out").textContent = typeof value === "string" ? value : JSON.stringify(value,null,2)}
    async function api(path, options={}){
      const res = await fetch(path,{credentials:"same-origin",headers:Object.assign({"Content-Type":"application/json"},csrf ? {"X-OFA-CSRF":csrf} : {},options.headers || {}),method:options.method || "GET",body:options.body ? JSON.stringify(options.body) : undefined});
      const nextCsrf = res.headers.get("X-OFA-CSRF");
      if(nextCsrf) csrf = nextCsrf;
      const data = await res.json().catch(()=>({ok:false,error:{code:"invalid_json"}}));
      out({status:res.status,csrf:!!csrf,data});
      return data;
    }
    function registerAccount(){api("/api/v1/auth/register",{method:"POST",body:{username:regUsername.value,email:regEmail.value}})}
    function startEmail(){api("/api/v1/auth/email/start",{method:"POST",body:{email:loginEmail.value}})}
    function completeEmail(){api("/api/v1/auth/email/complete",{method:"POST",body:{token:emailToken.value}})}
    function me(){api("/api/v1/me")}
    function addPhase3Discovery(){api("/api/v1/me/discoveries",{method:"POST",body:{discoveryType:"staging",discoveryKey:"phase3-account-page"}})}
    function grantPhase4Discovery(discoveryKey){api("/api/v1/me/discoveries",{method:"POST",body:{discoveryType:"phase4_staging",discoveryKey}})}
    function discoveries(){api("/api/v1/me/discoveries")}
    function grantItem(){api("/api/v1/staging/grant-test-item",{method:"POST",body:{}})}
    function inventory(){api("/api/v1/me/inventory")}
    function logout(){api("/api/v1/auth/logout",{method:"POST",body:{}})}
  </script>
</body>
</html>`;
}
