(function(){
  "use strict";

  const VERSION = "world-foundation-1";
  const STORAGE = {
    visitor:"ofaVisitorId",
    apiBase:"oddApiBaseUrl",
    apiStatus:"ofaApiStatus",
    settings:"ofaWorldSettings",
    signal:"ofaSignalCache",
    condition:"ofaConditionCache",
    weather:"ofaWeatherCache",
    activity:"ofaActivityCache",
    objectives:"ofaObjectivesCache",
    creature:"ofaCreatureCache",
    pendingEvents:"ofaPendingEvents",
    unlistedEntered:"ofaUnlistedEntered",
    employee:"ofaEmployeeRecord",
    conclusions:"ofaCaseConclusions",
    publicRestored:"ofaPublicArchiveRestored"
  };

  const OFFICIAL_HOSTS = new Set([
    "oddfrequencyarchive.com",
    "www.oddfrequencyarchive.com",
    "mrredallstar12-lab.github.io",
    "localhost",
    "127.0.0.1"
  ]);

  const fallbackSignals = [
    {artifact:"Static Coin",transmission:"The shared signal is quiet. The local fallback is still blinking.",weatherEffect:"clear-signal",reward:{currency:["Static Coins",2],item:"Shared Signal Stub"}},
    {artifact:"Coupon Dust Jar",transmission:"Zero-percent winds are moving through the old table cells.",weatherEffect:"coupon-winds",reward:{currency:["Coupon Dust",3],item:"Coupon Dust Jar"}},
    {artifact:"Radio Static Sample",transmission:"CH 404 repeats: contradiction stabilizes containment.",weatherEffect:"heavy-static",reward:{currency:["Static Coins",3],item:"Radio Static Sample"}},
    {artifact:"Door Knock Receipt",transmission:"A temporary room key exists only until the archive forgets it.",weatherEffect:"pixel-fog",reward:{currency:["Popup Bucks",1],item:"Door Knock Receipt"}},
    {artifact:"Fake Patch Note",transmission:"Keep the public archive loud. Do not complete the person.",weatherEffect:"modem-pressure",reward:{currency:["Static Coins",1],item:"Fake Patch Note"}}
  ];

  const artifactDeskItems = [
    {name:"Wet Cassette",serial:"R2-404-WET",notes:"The label says Elian, then scratches itself into a station number.",item:"Radio Static Sample"},
    {name:"Green Library Card",serial:"Q-031-SWITCH",notes:"The card has no borrower name until someone describes Mara too clearly.",item:"Corkboard String"},
    {name:"Aquarium Key Tag",serial:"V-044-ANNEX",notes:"The key opens nothing visible, but fish avoid it.",item:"Aquarium Bubble"},
    {name:"Removed Portrait Sleeve",serial:"000-NO-FACE",notes:"The sleeve is heavier when left uninspected.",item:"Case Smudge"}
  ];

  function $(selector, root=document){return root.querySelector(selector)}
  function $$(selector, root=document){return Array.from(root.querySelectorAll(selector))}
  function readJSON(key,fallback){
    try{return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback))}
    catch{return fallback}
  }
  function writeJSON(key,value){localStorage.setItem(key,JSON.stringify(value))}
  function clean(text){
    return String(text ?? "").replace(/[&<>"']/g,(ch)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
  }
  function cleanAttr(text){return clean(text).replace(/`/g,"&#96;")}
  function localDayKey(){
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function dailyIndex(offset=0){
    return (Number(localDayKey().replace(/-/g,"")) + offset) % 9973;
  }
  function addInventoryItem(item, amount=1){
    if(typeof window.addInventoryItem === "function") window.addInventoryItem(item,amount);
  }
  function addCurrency(type, amount=1){
    if(typeof window.addCurrency === "function") window.addCurrency(type,amount);
  }
  function signalBanner(text){
    if(typeof window.signalBanner === "function") window.signalBanner(text);
    else console.info("[OFA]",text);
  }

  function getSettings(){
    return Object.assign({
      persistentHorrorEffects:false,
      sharedActivity:true,
      sharedRewards:true,
      apiPolling:true
    },readJSON(STORAGE.settings,{}));
  }

  function saveSettings(next){
    writeJSON(STORAGE.settings,Object.assign(getSettings(),next));
    renderSettingsControls();
  }

  function createVisitorId(){
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return "ofa_" + Array.from(bytes).map((b)=>b.toString(16).padStart(2,"0")).join("");
  }

  function getVisitorId(){
    let id = localStorage.getItem(STORAGE.visitor);
    if(!/^ofa_[a-f0-9]{24,80}$/i.test(id || "")){
      id = createVisitorId();
      localStorage.setItem(STORAGE.visitor,id);
    }
    return id;
  }

  function visitorLabel(id=getVisitorId()){
    let n = 0;
    for(const ch of id) n = (n * 31 + ch.charCodeAt(0)) % 9000;
    return `VISITOR ${String(1000 + n).slice(-4)}`;
  }

  function resetVisitorId(){
    const old = visitorLabel();
    localStorage.setItem(STORAGE.visitor,createVisitorId());
    renderIdentity();
    signalBanner(`${old} was retired. New anonymous badge issued.`);
  }

  function getApiBase(){
    const fromWindow = String(window.OFA_API_BASE_URL || "").trim();
    const fromStorage = String(localStorage.getItem(STORAGE.apiBase) || "").trim();
    const base = fromWindow || fromStorage;
    return base.replace(/\/+$/,"");
  }

  function apiPath(path){
    const base = getApiBase();
    if(!base) return "";
    return `${base}/api/v1${path}`;
  }

  async function fetchJson(path, options={}){
    const url = apiPath(path);
    if(!url) throw new Error("api_not_configured");
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),options.timeout || 3500);
    try{
      const response = await fetch(url,{
        method:options.method || "GET",
        headers:Object.assign({"Content-Type":"application/json","X-OFA-Visitor":getVisitorId()},options.headers || {}),
        body:options.body ? JSON.stringify(options.body) : undefined,
        signal:controller.signal
      });
      const data = await response.json().catch(()=>({ok:false,error:{code:"invalid_json",message:"API returned unreadable static."}}));
      if(!response.ok || data.ok === false){
        const err = new Error(data.error?.message || `API ${response.status}`);
        err.code = data.error?.code || "api_error";
        throw err;
      }
      localStorage.setItem(STORAGE.apiStatus,"online");
      return data;
    }catch(error){
      localStorage.setItem(STORAGE.apiStatus,error.code || error.name || "offline");
      throw error;
    }finally{
      clearTimeout(timer);
    }
  }

  function fallbackSignal(){
    const pick = fallbackSignals[dailyIndex(13) % fallbackSignals.length];
    return Object.assign({dateKey:localDayKey(),source:"local-fallback",rumor:"Backend not configured; deterministic local signal is active.",roomKey:"none"},pick);
  }

  async function loadSharedState(){
    const state = {
      signal:fallbackSignal(),
      condition:{key:"stable",label:"Stable",detail:"Local fallback condition. Public archive remains canonical.",source:"local-fallback"},
      weather:{key:"clear-signal",label:"Clear signal",detail:"Local fallback weather.",intensity:1},
      activity:[{message:"LOCAL FALLBACK: shared feed unavailable; local archive still works.",eventType:"local"}],
      objectives:[{id:"local-popup-static",title:"Local fallback: close 25 fake popups",target_value:25,current_value:Number(localStorage.getItem("oddClosedAds") || 0),status:"local"}],
      creature:{designation:"Specimen LOCAL-FEED",hunger:66,mood:"waiting for backend crumbs",stage:1,modifiers:["paper teeth"],recent:[]}
    };

    try{
      const [health,signal,condition,weather,activity,objectives,creature] = await Promise.allSettled([
        fetchJson("/health"),
        fetchJson("/signal/today"),
        fetchJson("/condition"),
        fetchJson("/weather"),
        fetchJson("/activity"),
        fetchJson("/objectives"),
        fetchJson("/creature")
      ]);
      if(health.status === "fulfilled") writeJSON("ofaHealthCache",health.value);
      if(signal.status === "fulfilled") state.signal = signal.value.signal || state.signal;
      if(condition.status === "fulfilled") state.condition = condition.value.condition || state.condition;
      if(weather.status === "fulfilled") state.weather = weather.value.weather || state.weather;
      if(activity.status === "fulfilled") state.activity = activity.value.events || state.activity;
      if(objectives.status === "fulfilled") state.objectives = objectives.value.objectives || state.objectives;
      if(creature.status === "fulfilled") state.creature = creature.value.creature || state.creature;
    }catch{
      // Individual fallbacks above handle offline mode.
    }

    writeJSON(STORAGE.signal,state.signal);
    writeJSON(STORAGE.condition,state.condition);
    writeJSON(STORAGE.weather,state.weather);
    writeJSON(STORAGE.activity,state.activity);
    writeJSON(STORAGE.objectives,state.objectives);
    writeJSON(STORAGE.creature,state.creature);
    renderSharedState(state);
    applyTemporaryPublicEffects(state);
    return state;
  }

  function renderIdentity(){
    $$("[data-ofa-identity]").forEach((slot)=>{
      slot.innerHTML = `
        <p><b>${clean(visitorLabel())}</b></p>
        <p class="mini-status">Anonymous local badge. It is random, resettable, and not a login.</p>
        <button type="button" onclick="OFA.resetVisitorId()">reset anonymous badge</button>
      `;
    });
  }

  function renderSettingsControls(){
    const settings = getSettings();
    $$("[data-ofa-horror-controls]").forEach((slot)=>{
      slot.innerHTML = `
        <p><b>Public Archive Restoration</b></p>
        <label class="ofa-check"><input type="checkbox" ${settings.persistentHorrorEffects ? "checked" : ""} onchange="OFA.setPersistentHorrorEffects(this.checked)"> allow persistent case effects</label>
        <p class="mini-status">Default is conservative. Temporary effects can always be cleared.</p>
        <button type="button" onclick="OFA.restorePublicArchive()">Restore Public Archive</button>
      `;
    });
  }

  function renderSharedState(state){
    renderIdentity();
    renderSettingsControls();
    $$("[data-ofa-api-status]").forEach((slot)=>{
      const configured = !!getApiBase();
      const status = localStorage.getItem(STORAGE.apiStatus) || (configured ? "checking" : "not configured");
      slot.textContent = configured ? `Shared API: ${status}` : "Shared API: local fallback mode";
    });
    $$("[data-ofa-signal]").forEach((slot)=>{
      const signal = state.signal || readJSON(STORAGE.signal,fallbackSignal());
      slot.innerHTML = `<b>${clean(signal.artifact || "Signal artifact")}</b><p>${clean(signal.transmission || "No transmission.")}</p><p class="mini-status">source: ${clean(signal.source || "server")} | weather: ${clean(signal.weatherEffect || "none")}</p><button type="button" onclick="OFA.claimDailySignal()">claim harmless signal reward</button>`;
    });
    $$("[data-ofa-condition]").forEach((slot)=>{
      const condition = state.condition || readJSON(STORAGE.condition,{label:"Stable",detail:"Local fallback condition."});
      slot.innerHTML = `<b>${clean(condition.label || condition.key)}</b><p>${clean(condition.detail || "The archive is stable enough.")}</p>`;
    });
    $$("[data-ofa-activity]").forEach((slot)=>{
      const events = (state.activity || readJSON(STORAGE.activity,[])).slice(0,8);
      slot.innerHTML = events.length ? `<ul>${events.map((event)=>`<li>${clean(event.message || event)}</li>`).join("")}</ul>` : "<p>No shared activity yet.</p>";
    });
    $$("[data-ofa-objectives]").forEach((slot)=>{
      const objectives = state.objectives || readJSON(STORAGE.objectives,[]);
      slot.innerHTML = objectives.length ? objectives.slice(0,4).map((objective)=>objectiveHTML(objective)).join("") : "<p>No active shared objectives.</p>";
    });
    $$("[data-ofa-creature]").forEach((slot)=>{
      const creature = state.creature || readJSON(STORAGE.creature,{});
      slot.innerHTML = `
        <div class="archive-creature" aria-label="Shared Archive Creature">
          <div class="archive-creature-face">0_0</div>
          <div><b>${clean(creature.designation || "Specimen")}</b><p>${clean(creature.mood || "contained")}</p><p class="mini-status">hunger ${Number(creature.hunger || 0)} | stage ${Number(creature.stage || 1)}</p></div>
        </div>
        <button type="button" onclick="OFA.feedCreature()">feed local junk</button>
      `;
    });
    renderSharedMapHints(state);
    renderArtifactDesk();
    renderSubmissionVault();
  }

  function objectiveHTML(objective){
    const current = Number(objective.current_value ?? objective.currentValue ?? 0);
    const target = Math.max(1,Number(objective.target_value ?? objective.targetValue ?? 1));
    const pct = Math.min(100,Math.round(current / target * 100));
    return `<div class="ofa-objective"><b>${clean(objective.title)}</b><div class="quest-meter"><span style="width:${pct}%"></span></div><p class="mini-status">${current}/${target} | ${clean(objective.status || "active")}</p></div>`;
  }

  async function recordEvent(type,payload={},options={}){
    const event = {
      type,
      visitorId:getVisitorId(),
      payload,
      amount:options.amount || 1,
      idempotencyKey:options.idempotencyKey || `${type}:${Date.now()}:${Math.random().toString(16).slice(2)}`
    };
    const pending = readJSON(STORAGE.pendingEvents,[]);
    pending.push(event);
    writeJSON(STORAGE.pendingEvents,pending.slice(-40));
    try{
      await fetchJson("/events",{method:"POST",body:event,timeout:2500});
      writeJSON(STORAGE.pendingEvents,readJSON(STORAGE.pendingEvents,[]).filter((entry)=>entry.idempotencyKey !== event.idempotencyKey));
    }catch{
      // Queue remains local. Existing site behavior is not blocked by shared API failures.
    }
  }

  async function flushPendingEvents(){
    const pending = readJSON(STORAGE.pendingEvents,[]);
    if(!pending.length || !getApiBase()) return;
    for(const event of pending.slice(0,8)){
      try{
        await fetchJson("/events",{method:"POST",body:event,timeout:2000});
        const rest = readJSON(STORAGE.pendingEvents,[]).filter((entry)=>entry.idempotencyKey !== event.idempotencyKey);
        writeJSON(STORAGE.pendingEvents,rest);
      }catch{
        break;
      }
    }
  }

  function claimDailySignal(){
    const signal = readJSON(STORAGE.signal,fallbackSignal());
    if(signal.reward?.item) addInventoryItem(signal.reward.item,1);
    if(Array.isArray(signal.reward?.currency)) addCurrency(signal.reward.currency[0],Number(signal.reward.currency[1] || 1));
    recordEvent("daily_signal_claim",{artifact:signal.artifact,source:signal.source});
    signalBanner(`Signal reward claimed: ${signal.reward?.item || "Static Coins"}.`);
  }

  function feedCreature(){
    const inv = readJSON("oddInventory",{});
    const item = Object.keys(inv).find((name)=>Number(inv[name] || 0) > 0) || "Loose Pixel";
    recordEvent("creature_feed",{item}, {amount:1});
    fetchJson("/creature/feed",{method:"POST",body:{visitorId:getVisitorId(),itemName:item,amount:1,idempotencyKey:`feed:${item}:${Date.now()}`},timeout:2500}).catch(()=>{});
    signalBanner(`Fed ${item} to the Archive Creature. Shared mode will sync when available.`);
  }

  async function renderServerAlchemyRecipes(){
    const slot = $("[data-ofa-server-alchemy]");
    if(!slot) return;
    let recipes = [
      {name:"Rotating Static Needle",inputs:["Radio Static Sample","Static Coin"],output:"Community Static Needle",source:"local fallback"},
      {name:"Contaminated Coupon",inputs:["Coupon Dust Jar","Case Smudge"],output:"Contaminated Coupon Witness",source:"local fallback"}
    ];
    try{
      const data = await fetchJson("/alchemy/recipes",{timeout:2500});
      recipes = data.recipes || recipes;
    }catch{
      // Fallback recipes remain visible.
    }
    slot.innerHTML = recipes.slice(0,5).map((recipe)=>`
      <div class="ofa-objective">
        <b>${clean(recipe.name || recipe.id || "Rotating recipe")}</b>
        <p>${clean((recipe.inputs || []).join(" + "))} -> ${clean(recipe.output || recipe.output_name || "unknown output")}</p>
        <p class="mini-status">source: ${clean(recipe.source || "server/community")}</p>
      </div>
    `).join("");
  }

  function renderSharedMapHints(state={}){
    $$("[data-ofa-map-shared]").forEach((slot)=>{
      const condition = state.condition || readJSON(STORAGE.condition,{label:"Stable",detail:"Local fallback condition."});
      const weather = state.weather || readJSON(STORAGE.weather,{label:"Clear signal",detail:"Local fallback weather."});
      const entered = localStorage.getItem(STORAGE.unlistedEntered) === "true";
      slot.innerHTML = `
        <p><b>${clean(condition.label || "Stable")}</b>: ${clean(condition.detail || "The map is locally stable.")}</p>
        <p><b>Weather:</b> ${clean(weather.label || weather.key || "clear signal")}</p>
        <p class="mini-status">${entered ? "Unlisted Wing has been discovered locally; secret map doors may appear during future events." : "Secret areas appear only after discovery or shared events."}</p>
      `;
    });
  }

  function renderArtifactDesk(){
    $$("[data-ofa-artifact-desk]").forEach((slot)=>{
      const log = readJSON("ofaArtifactDeskLog",[]).slice(-4).reverse();
      slot.innerHTML = `
        <div class="artifact-desk-grid">
          ${artifactDeskItems.map((item,index)=>`<button type="button" class="artifact-desk-item" onclick="OFA.inspectArtifact(${index},'scan')"><b>${clean(item.name)}</b><span>${clean(item.serial)}</span></button>`).join("")}
        </div>
        <p><button type="button" onclick="OFA.inspectArtifact(0,'rotate')">rotate</button> <button type="button" onclick="OFA.inspectArtifact(1,'catalog')">catalog</button> <button type="button" onclick="OFA.inspectArtifact(2,'open')">open compartment</button> <button type="button" onclick="OFA.inspectArtifact(3,'test')">test safely</button></p>
        <div class="artifact-desk-log">${log.length ? log.map((entry)=>`<p>${clean(entry)}</p>`).join("") : "<p>No artifact tests recorded locally.</p>"}</div>
      `;
    });
  }

  function inspectArtifact(index=0,action="scan"){
    const artifact = artifactDeskItems[index] || artifactDeskItems[0];
    const lines = {
      rotate:`${artifact.name} rotated 17 degrees and returned to the same wrong year.`,
      scan:`${artifact.name} scan: ${artifact.notes}`,
      catalog:`${artifact.name} cataloged under ${artifact.serial}. The label is not legally a name.`,
      open:`${artifact.name} compartment opened. It contained a receipt-shaped silence.`,
      test:`${artifact.name} test complete. No real files, devices, or evidence were touched.`,
      destroy:`${artifact.name} refused destruction and became paperwork.`
    };
    const text = lines[action] || lines.scan;
    const log = readJSON("ofaArtifactDeskLog",[]);
    log.push(`${new Date().toLocaleTimeString()}: ${text}`);
    writeJSON("ofaArtifactDeskLog",log.slice(-20));
    addInventoryItem(artifact.item,1);
    recordEvent("archive_echo",{artifact:artifact.name,action});
    renderArtifactDesk();
    signalBanner(text);
  }

  function renderSubmissionVault(){
    $$("[data-ofa-submission-vault]").forEach((slot)=>{
      const local = readJSON("ofaLocalSubmissions",[]).slice(-5).reverse();
      slot.innerHTML = `
        <label>type <select id="ofaSubmissionType"><option value="rumor">rumor</option><option value="sighting">fictional sighting</option><option value="object">object description</option><option value="message">short message</option><option value="drawing-note">drawing note</option></select></label>
        <label>title <input id="ofaSubmissionTitle" maxlength="120" placeholder="short fictional title"></label>
        <label>body <textarea id="ofaSubmissionBody" maxlength="2000" placeholder="fictional archive note; no personal info"></textarea></label>
        <button type="button" onclick="OFA.submitCommunityArtifact()">submit for moderation</button>
        <p id="ofaSubmissionStatus" class="mini-status">Pending submissions are reviewed before publication.</p>
        <div class="artifact-desk-log">${local.length ? local.map((entry)=>`<p>${clean(entry.createdAt)} - ${clean(entry.title)} (${clean(entry.status)})</p>`).join("") : "<p>No local pending submission receipts yet.</p>"}</div>
      `;
    });
  }

  async function submitCommunityArtifact(){
    const type = $("#ofaSubmissionType")?.value || "rumor";
    const title = ($("#ofaSubmissionTitle")?.value || "").trim();
    const body = ($("#ofaSubmissionBody")?.value || "").trim();
    const status = $("#ofaSubmissionStatus");
    if(title.length < 3 || body.length < 10){
      if(status) status.textContent = "Title/body are too short for moderation.";
      return;
    }
    const receipt = {type,title,body,status:"pending-local",createdAt:new Date().toLocaleString()};
    try{
      await fetchJson("/submissions",{method:"POST",body:{visitorId:getVisitorId(),type,title,body},timeout:3500});
      receipt.status = "pending-server";
      if(status) status.textContent = "Submission received by the shared archive for moderation.";
    }catch{
      if(status) status.textContent = "Backend unavailable. Submission receipt saved locally only.";
    }
    const local = readJSON("ofaLocalSubmissions",[]);
    local.push(receipt);
    writeJSON("ofaLocalSubmissions",local.slice(-20));
    recordEvent("archive_echo",{submission:type,title});
    renderSubmissionVault();
  }

  function pageIsPublicNormal(){
    const body = document.body;
    return body && !body.classList.contains("unlisted-wing") && !body.classList.contains("case-records") && !body.classList.contains("employee-terminal-page") && !body.classList.contains("corrupt-zone") && !body.classList.contains("beyond-zone");
  }

  function applyTemporaryPublicEffects(state){
    if(!pageIsPublicNormal()) return;
    const settings = getSettings();
    const entered = localStorage.getItem(STORAGE.unlistedEntered) === "true";
    if(localStorage.getItem(STORAGE.publicRestored) === "true") return;
    const condition = state.condition?.key || "";
    const weather = state.weather?.key || "";
    if(settings.persistentHorrorEffects && entered && (condition === "contaminated" || condition === "basement-awake" || weather === "blood-red-buffering")){
      document.body.classList.add("ofa-public-anomaly-active",`ofa-condition-${condition}`,`ofa-weather-${weather}`);
      showRestoreControl("Case-related public effect is active.");
      setTimeout(()=>restorePublicArchive({silent:true}),90000);
    }
  }

  function showRestoreControl(message){
    if($(".restore-public-archive")) return;
    const box = document.createElement("div");
    box.className = "restore-public-archive";
    box.setAttribute("role","status");
    box.innerHTML = `<b>PUBLIC ARCHIVE MUTATION</b><p>${clean(message || "Temporary effect active.")}</p><button type="button" onclick="OFA.restorePublicArchive()">Restore Public Archive</button>`;
    document.body.appendChild(box);
  }

  function restorePublicArchive(options={}){
    document.body.classList.remove("ofa-public-anomaly-active");
    Array.from(document.body.classList).filter((cls)=>cls.startsWith("ofa-condition-") || cls.startsWith("ofa-weather-")).forEach((cls)=>document.body.classList.remove(cls));
    $$(".restore-public-archive,.ofa-temporary-mutation").forEach((el)=>el.remove());
    localStorage.setItem(STORAGE.publicRestored,"true");
    if(!options.silent) signalBanner("Public Archive restored for this browser session.");
  }

  function setPersistentHorrorEffects(value){
    saveSettings({persistentHorrorEffects:!!value});
    if(!value) restorePublicArchive({silent:true});
  }

  function enterUnlistedWing(options={}){
    localStorage.setItem(STORAGE.unlistedEntered,"true");
    localStorage.removeItem(STORAGE.publicRestored);
    recordEvent("room_open",{room:"unlisted-wing",debug:!!options.debug});
    const target = document.location.pathname.includes("/pages/") ? "unlisted.html" : "pages/unlisted.html";
    if(options.navigate !== false) location.href = target + (options.debug ? "?dev=1" : "");
  }

  function attachSecretEntryBuffer(){
    let buffer = "";
    addEventListener("keydown",(event)=>{
      if(event.ctrlKey || event.metaKey || event.altKey) return;
      if(event.key.length !== 1) return;
      buffer = (buffer + event.key.toLowerCase()).slice(-24);
      if(buffer.includes("unlisted")){
        buffer = "";
        showUnlistedPrompt();
      }
    });
  }

  function showUnlistedPrompt(){
    const box = document.createElement("div");
    box.className = "fake-window ofa-temporary-mutation unlisted-entry-choice";
    box.style.left = "min(32px,4vw)";
    box.style.top = "80px";
    box.innerHTML = `
      <div class="win-title"><span>UNLISTED ROUTE FOUND</span><button type="button" onclick="this.closest('.fake-window').remove()">X</button></div>
      <div class="win-body">
        <p>This wing is not part of the public archive index.</p>
        <p>No files will be harmed. The normal archive can be restored.</p>
        <button type="button" onclick="OFA.enterUnlistedWing()">enter THE UNLISTED WING</button>
        <button type="button" onclick="this.closest('.fake-window').remove()">stay in public archive</button>
      </div>
    `;
    document.body.appendChild(box);
  }

  function wrapExistingHandlers(){
    const originalRecordPopupGrave = window.recordPopupGrave;
    if(typeof originalRecordPopupGrave === "function" && !originalRecordPopupGrave.__ofaWrapped){
      const wrapped = function(popup,templateClass,source){
        const result = originalRecordPopupGrave.apply(this,arguments);
        const popupType = templateClass || popup?.dataset?.templateClass || popup?.className || "popup-ad";
        recordEvent("popup_close",{popupType:String(popupType).slice(0,80),source:source || "x"});
        return result;
      };
      wrapped.__ofaWrapped = true;
      window.recordPopupGrave = wrapped;
    }
    const originalTuneRadio = window.tuneRadio;
    if(typeof originalTuneRadio === "function" && !originalTuneRadio.__ofaWrapped){
      const wrapped = function(station){
        const result = originalTuneRadio.apply(this,arguments);
        recordEvent("radio_tune",{station:String(station || "unknown").slice(0,80)});
        return result;
      };
      wrapped.__ofaWrapped = true;
      window.tuneRadio = wrapped;
    }
    const originalCraft = window.craftAlchemyRecipe;
    if(typeof originalCraft === "function" && !originalCraft.__ofaWrapped){
      const wrapped = function(id){
        const result = originalCraft.apply(this,arguments);
        recordEvent("alchemy_attempt",{recipe:String(id || "unknown").slice(0,80)});
        return result;
      };
      wrapped.__ofaWrapped = true;
      window.craftAlchemyRecipe = wrapped;
    }
  }

  function boot(){
    getVisitorId();
    renderIdentity();
    renderSettingsControls();
    loadSharedState();
    renderServerAlchemyRecipes();
    renderArtifactDesk();
    renderSubmissionVault();
    flushPendingEvents();
    wrapExistingHandlers();
    attachSecretEntryBuffer();
    if(getSettings().apiPolling){
      setInterval(()=>{loadSharedState(); flushPendingEvents();},90000);
    }
  }

  window.OFA = Object.assign(window.OFA || {},{
    version:VERSION,
    storage:STORAGE,
    boot,
    getApiBase,
    fetchJson,
    getVisitorId,
    visitorLabel,
    resetVisitorId,
    getSettings,
    saveSettings,
    setPersistentHorrorEffects,
    restorePublicArchive,
    showRestoreControl,
    recordEvent,
    claimDailySignal,
    feedCreature,
    renderServerAlchemyRecipes,
    renderArtifactDesk,
    inspectArtifact,
    renderSubmissionVault,
    submitCommunityArtifact,
    enterUnlistedWing,
    fallbackSignal,
    OFFICIAL_HOSTS
  });

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded",boot);
  else boot();
})();
