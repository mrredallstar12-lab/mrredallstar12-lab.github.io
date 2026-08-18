export function adminControlPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OFA Control Center</title>
  <style>
    body{margin:0;font:14px/1.4 system-ui,Segoe UI,sans-serif;background:#101213;color:#e5e8df}
    main{max-width:1100px;margin:0 auto;padding:24px}
    section{border:1px solid #3c4540;background:#181c1a;padding:14px;margin:0 0 14px}
    input,select,textarea,button{font:inherit;margin:4px 0;padding:8px}
    input,select,textarea{background:#0b0d0c;color:#e5e8df;border:1px solid #4f5f55}
    button{background:#26382f;color:#e5e8df;border:1px solid #66806f;cursor:pointer}
    .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
    pre{white-space:pre-wrap;background:#080a09;border:1px solid #354039;padding:12px;min-height:220px}
  </style>
</head>
<body>
<main>
  <h1>OFA Control Center</h1>
  <section>
    <h2>Operator</h2>
    <div class="row">
      <button onclick="adminMe()">admin status</button>
      <button onclick="startElevation()">start elevation</button>
      <button onclick="confirmElevation()">confirm fresh elevation</button>
    </div>
  </section>
  <section>
    <h2>Player Inspector</h2>
    <input id="username" value="noobuus" aria-label="username">
    <button onclick="inspectPlayer()">inspect by username</button>
    <button onclick="inventoryLedger()">inventory ledger</button>
  </section>
  <section>
    <h2>Typed Player Operations</h2>
    <div class="row">
      <input id="accountId" placeholder="target account id">
      <input id="discoveryKey" value="phase5.admin.test">
      <button onclick="grantDiscovery()">grant discovery</button>
      <button onclick="revokeDiscovery()">revoke discovery</button>
    </div>
    <div class="row">
      <input id="itemKey" value="phase5_admin_test_item">
      <input id="quantity" value="1">
      <button onclick="grantInventory()">grant quantity</button>
      <button onclick="revokeInventory()">revoke quantity</button>
    </div>
    <div class="row">
      <input id="instanceId" placeholder="item instance id">
      <button onclick="revokeInstance()">revoke instance custody</button>
      <button onclick="revokeSessions()">revoke account sessions</button>
    </div>
  </section>
  <section>
    <h2>Operations</h2>
    <div class="row">
      <select id="modeKey">
        <option value="registrations_disabled">registrations_disabled</option>
        <option value="auth_initiation_disabled">auth_initiation_disabled</option>
        <option value="player_mutations_disabled">player_mutations_disabled</option>
      </select>
      <select id="modeEnabled">
        <option value="true">enabled</option>
        <option value="false">disabled</option>
      </select>
      <button onclick="setMode()">set mode</button>
      <button onclick="modes()">list modes</button>
      <button onclick="revokeAllSessions()">emergency revoke global sessions</button>
    </div>
  </section>
  <section>
    <h2>Content Preview</h2>
    <input id="slug" value="phase4-signal-001">
    <select id="previewAs">
      <option value="anonymous">anonymous</option>
      <option value="authenticated">authenticated</option>
      <option value="player">selected player</option>
    </select>
    <button onclick="previewContent()">preview</button>
  </section>
  <pre id="out">Control Center ready.</pre>
</main>
<script>
let csrf = "";
let inspectedAccountId = "";
function out(value){document.querySelector("#out").textContent = typeof value === "string" ? value : JSON.stringify(value,null,2)}
async function api(path, options={}){
  const res = await fetch(path,{credentials:"same-origin",headers:Object.assign({"Content-Type":"application/json"},csrf ? {"X-OFA-CSRF":csrf}:{},options.headers||{}),method:options.method||"GET",body:options.body?JSON.stringify(options.body):undefined});
  const next = res.headers.get("X-OFA-CSRF"); if(next) csrf = next;
  const data = await res.json().catch(()=>({ok:false,error:{code:"invalid_json"}}));
  if(data?.player?.account?.id){ inspectedAccountId = data.player.account.id; accountId.value = inspectedAccountId; }
  out({status:res.status,elevated:!!data?.admin?.elevated,data});
  return data;
}
function adminMe(){api("/api/v1/admin/me")}
function startElevation(){api("/api/v1/admin/elevation/start",{method:"POST",body:{}})}
function confirmElevation(){api("/api/v1/admin/elevation/confirm",{method:"POST",body:{confirm:"ELEVATE"}})}
function inspectPlayer(){api("/api/v1/admin/players/by-username/"+encodeURIComponent(username.value))}
function target(){return accountId.value || inspectedAccountId}
function inventoryLedger(){api("/api/v1/admin/players/"+encodeURIComponent(target())+"/inventory-ledger")}
function grantDiscovery(){api("/api/v1/admin/players/"+encodeURIComponent(target())+"/discoveries/grant",{method:"POST",body:{confirm:"GRANT_DISCOVERY",discoveryType:"admin",discoveryKey:discoveryKey.value,reason:"control-center"}})}
function revokeDiscovery(){api("/api/v1/admin/players/"+encodeURIComponent(target())+"/discoveries/revoke",{method:"POST",body:{confirm:"REVOKE_DISCOVERY",discoveryType:"admin",discoveryKey:discoveryKey.value,reason:"control-center"}})}
function grantInventory(){api("/api/v1/admin/players/"+encodeURIComponent(target())+"/inventory/grant",{method:"POST",body:{confirm:"GRANT_INVENTORY",itemKey:itemKey.value,name:itemKey.value,quantity:Number(quantity.value||1),reason:"control-center"}})}
function revokeInventory(){api("/api/v1/admin/players/"+encodeURIComponent(target())+"/inventory/revoke",{method:"POST",body:{confirm:"REVOKE_INVENTORY",itemKey:itemKey.value,quantity:Number(quantity.value||1),reason:"control-center"}})}
function revokeInstance(){api("/api/v1/admin/players/"+encodeURIComponent(target())+"/inventory/revoke",{method:"POST",body:{confirm:"REVOKE_INVENTORY",itemInstanceId:instanceId.value,reason:"control-center"}})}
function revokeSessions(){api("/api/v1/admin/players/"+encodeURIComponent(target())+"/sessions/revoke",{method:"POST",body:{confirm:"REVOKE_ACCOUNT_SESSIONS",reason:"control-center"}})}
function modes(){api("/api/v1/admin/operations/modes")}
function setMode(){api("/api/v1/admin/operations/modes/set",{method:"POST",body:{confirm:"SET_OPERATIONAL_MODE",modeKey:modeKey.value,enabled:modeEnabled.value==="true",reason:"control-center"}})}
function revokeAllSessions(){api("/api/v1/admin/sessions/revoke-all",{method:"POST",body:{confirm:"REVOKE_ALL_SESSIONS",reason:"control-center"}})}
function previewContent(){api("/api/v1/admin/content/preview",{method:"POST",body:{slug:slug.value,as:previewAs.value,username:username.value}})}
adminMe();
</script>
</body>
</html>`;
}
