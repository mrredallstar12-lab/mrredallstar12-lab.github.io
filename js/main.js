const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

let adStorm = false;
let adStormTimer = 0;
let reactionReady = false;
let reactionStart = 0;
let reactionTimer = 0;
let fortuneClicks = 0;

const stickerBits = ["*", "#", "@", "%", "!!", "??", "VHS", "404", "CRT", "ZAP"];

const adTemplates = [
  {
    className:"ad-prize",
    title:"FAKE PRIZE WINDOW",
    icon:"$",
    body:"A pretend prize committee selected this archive tab for maximum blinking potential.",
    buttons:["admire prize","decline loudly","more glitter"],
    fine:"Parody popup. No prize, no purchase, no download."
  },
  {
    className:"ad-toolbar",
    title:"TOOLBAR SIMULATOR",
    icon:"===",
    body:"Add an imaginary toolbar with buttons for Weather, Wormhole, and Sandwich Status.",
    buttons:["preview toolbar","keep browser clean","why is it gray"],
    fine:"Nothing is installed. The toolbar is theatrical."
  },
  {
    className:"ad-fortune",
    title:"HOROSCOPE MODEM",
    icon:"*",
    body:"The stars say a mysterious link will open exactly when curiosity wins.",
    buttons:["read omen","shuffle fate","close portal"],
    fine:"For entertainment only. The modem has no license."
  },
  {
    className:"ad-banner",
    title:"DANCING BANNER AD",
    icon:"<>",
    body:"This banner has been dancing since 2002 and refuses to hydrate.",
    buttons:["dance back","clap twice","no rhythm"],
    fine:"Movement implied. Actual dance quality not guaranteed."
  },
  {
    className:"ad-download",
    title:"FAKE DOWNLOAD MANAGER",
    icon:"DL",
    body:"Preparing absolutely nothing.zip. Estimated time remaining: emotionally variable.",
    buttons:["pretend save","pause nothing","view progress"],
    fine:"No files are downloaded. The progress bar is decorative."
  },
  {
    className:"ad-visitor",
    title:"VISITOR NUMBER CLAIM",
    icon:"#",
    body:"You are visitor #" + String(Math.floor(1000 + Math.random() * 8999)) + " in a completely local hallucination.",
    buttons:["accept number","reroll number","frame it"],
    fine:"Visitor numbers are fake unless shown in the local counter box."
  },
  {
    className:"ad-ring",
    title:"WEB RING INVITATION",
    icon:"O",
    body:"Join a ring of abandoned buttons, suspicious guestbooks, and heroic under-construction signs.",
    buttons:["surf sideways","next weird site","stay here"],
    fine:"All destinations are internal or imaginary."
  },
  {
    className:"ad-alert",
    title:"DESKTOP ALERT",
    icon:"!",
    body:"A desktop widget reports that the archive has exceeded recommended nonsense levels.",
    buttons:["acknowledge","open meter","ignore professionally"],
    fine:"This is a fake alert from a fake desktop."
  },
  {
    className:"ad-aquarium",
    title:"AQUARIUM SPONSOR",
    icon:"~",
    body:"The pixel aquarium requests browser crumbs and one small bubble budget increase.",
    buttons:["release bubbles","feed pixels","deny budget"],
    fine:"Pixel water is not drinkable."
  },
  {
    className:"ad-coupon",
    title:"CURSED COUPON",
    icon:"%",
    body:"Redeem this coupon for 0% off a mystery object that may already be in the archive.",
    buttons:["clip coupon","fold it wrong","summon receipt"],
    fine:"Coupon has no cash value, store value, or logical value."
  }
];

function clean(text){
  return String(text).replace(/[<>&]/g,(char)=>({"<":"&lt;",">":"&gt;","&":"&amp;"}[char]));
}

function visitorCounter(){
  const key = "oddFrequencyVisitors";
  const n = Number(localStorage.getItem(key) || 0) + 1;
  localStorage.setItem(key,String(n));
  const el = $("#counter");
  if(el) el.textContent = String(n).padStart(8,"0");
}

function randomQuote(){
  const quotes = [
    "Archive note: the fake ads are restless tonight.",
    "A blinking button was cataloged and immediately escaped.",
    "Signal quality: bent but oddly charming.",
    "Do not feed the mystery bolt after midnight.",
    "A tiny game cabinet is humming behind the wallpaper.",
    "This page is best viewed with one tab too many.",
    "The bouncing logo is practicing for the corner hit."
  ];
  const el = $("#quote");
  if(el) el.textContent = quotes[Math.floor(Math.random() * quotes.length)];
}

function spawnConfetti(){
  for(let i = 0; i < 85; i++){
    const d = document.createElement("div");
    d.className = "confetti-bit";
    d.textContent = ["*","+","x","o","#","%","=","~"][Math.floor(Math.random() * 8)];
    Object.assign(d.style,{
      left:Math.random() * 100 + "vw",
      fontSize:12 + Math.random() * 30 + "px",
      color:`hsl(${Math.random() * 360},100%,70%)`
    });
    document.body.appendChild(d);
    let y = 0;
    let rot = Math.random() * 180;
    const speed = 3 + Math.random() * 6;
    const wobble = Math.random() * 50;
    const id = setInterval(()=>{
      y += speed;
      rot += 10 + Math.random() * 12;
      d.style.transform = `translate(${Math.sin(y / 35) * wobble}px, ${y}px) rotate(${rot}deg)`;
      if(y > innerHeight + 80){
        clearInterval(id);
        d.remove();
      }
    },28);
  }
}

function spawnSticker(){
  const d = document.createElement("div");
  d.className = "sticker";
  d.textContent = stickerBits[Math.floor(Math.random() * stickerBits.length)];
  d.style.left = Math.random() * 90 + "vw";
  d.style.top = Math.random() * 85 + "vh";
  d.style.color = `hsl(${Math.random() * 360},100%,72%)`;
  document.body.appendChild(d);
  setTimeout(()=>d.remove(),2700);
}

function spawnAd(manual=false){
  const maxAds = manual ? 99 : 8;
  if(document.querySelectorAll(".popup-ad").length >= maxAds) return;
  const template = adTemplates[Math.floor(Math.random() * adTemplates.length)];
  const ad = document.createElement("div");
  ad.className = `popup-ad ${template.className}`;
  ad.style.left = Math.max(5,Math.random() * Math.max(20,innerWidth - 350)) + "px";
  ad.style.top = Math.max(5,Math.random() * Math.max(20,innerHeight - 255)) + "px";
  ad.innerHTML = `
    <div class="ad-title"><span>${template.icon} ${template.title}</span><button class="x" title="close">X</button></div>
    <div class="ad-body">
      <b>${template.body}</b>
      <p>${["Limited-time imaginary offer.","Certified harmless parody.","Best viewed while suspicious.","Now with 30% more blinking."][Math.floor(Math.random()*4)]}</p>
      <div class="fake-progress"></div>
      <p>${template.buttons.map((label)=>`<button>${label}</button>`).join("")}</p>
      <p class="ad-fine">${template.fine}</p>
    </div>`;
  document.body.appendChild(ad);
  ad.querySelector(".x").onclick = () => ad.remove();
  ad.querySelectorAll(".ad-body button").forEach((button)=>{
    button.onclick = () => {
      spawnSticker();
      if(template.className === "ad-aquarium") aquariumEvent();
      if(Math.random() > .6) spawnAd(true);
    };
  });
  makeDraggable(ad,ad.querySelector(".ad-title"));
  if(!manual) setTimeout(()=>{if(ad.isConnected && Math.random() > .25) ad.remove()},9000 + Math.random() * 8000);
}

function updateAdStormButton(){
  $$("[data-ad-storm]").forEach((button)=>{
    button.textContent = adStorm ? "stop ad storm" : "start ad storm";
  });
  const status = $("#adStormStatus");
  if(status) status.textContent = adStorm ? "Ad storm: broadcasting fake popups." : "Ad storm: paused.";
}

function runAdStorm(){
  clearTimeout(adStormTimer);
  if(!adStorm) return;
  spawnAd(false);
  adStormTimer = setTimeout(runAdStorm,2200 + Math.random() * 4200);
}

function toggleAdStorm(){
  adStorm = !adStorm;
  updateAdStormButton();
  if(adStorm) runAdStorm();
  else clearTimeout(adStormTimer);
}

function toggleSpinMode(){
  document.body.classList.toggle("spin-mode");
  $$("[data-spin-toggle]").forEach((button)=>{
    button.textContent = document.body.classList.contains("spin-mode") ? "stop spin mode" : "spin mode";
  });
}

function makeDraggable(el,handle){
  if(!handle) return;
  let ox = 0;
  let oy = 0;
  let down = false;
  handle.onmousedown = (e) => {
    down = true;
    ox = e.clientX - el.offsetLeft;
    oy = e.clientY - el.offsetTop;
    e.preventDefault();
  };
  addEventListener("mousemove",(e)=>{
    if(!down) return;
    el.style.left = Math.max(0,Math.min(innerWidth - el.offsetWidth,e.clientX - ox)) + "px";
    el.style.top = Math.max(0,Math.min(innerHeight - el.offsetHeight,e.clientY - oy)) + "px";
  });
  addEventListener("mouseup",()=>down=false);
}

function bouncingLogo(){
  if($(".bounce-logo")) return;
  const logo = document.createElement("div");
  logo.className = "bounce-logo";
  logo.innerHTML = "<div>VDO<small>ODD SIGNAL</small></div>";
  document.body.appendChild(logo);
  let x = 40 + Math.random() * 120;
  let y = 60 + Math.random() * 120;
  let vx = 2.2;
  let vy = 1.8;
  let hue = 0;
  function step(){
    const w = logo.offsetWidth;
    const h = logo.offsetHeight;
    x += vx;
    y += vy;
    let hit = false;
    if(x < 0 || x + w > innerWidth){vx *= -1;x = Math.max(0,Math.min(x,innerWidth - w));hit = true}
    if(y < 0 || y + h > innerHeight){vy *= -1;y = Math.max(0,Math.min(y,innerHeight - h));hit = true}
    if(hit){
      hue = (hue + 75) % 360;
      logo.style.filter = `hue-rotate(${hue}deg)`;
      if(Math.random() > .82) spawnSticker();
    }
    logo.style.transform = `translate(${x}px,${y}px)`;
    requestAnimationFrame(step);
  }
  step();
}

function clickGame(){
  const area = $("#clickGame");
  if(!area) return;
  let score = 0;
  const scoreEl = $("#score");
  function make(){
    const t = document.createElement("div");
    t.className = "target";
    t.textContent = ["UFO","BUG","CD","VHS","404","ORB","BOLT"][Math.floor(Math.random() * 7)];
    t.style.left = Math.random() * 78 + "%";
    t.style.top = Math.random() * 75 + "%";
    t.onclick = () => {
      score++;
      scoreEl.textContent = score;
      t.remove();
      make();
      if(score % 5 === 0) spawnAd(false);
    };
    area.appendChild(t);
  }
  make();
}

function bugGame(){
  const area = $("#bugGame");
  if(!area) return;
  let score = 0;
  const out = $("#bugScore");
  function bug(){
    const b = document.createElement("div");
    b.className = "bug";
    b.textContent = ["bug","bit","zap","err"][Math.floor(Math.random() * 4)];
    b.style.left = Math.random() * 82 + "%";
    b.style.top = Math.random() * 80 + "%";
    b.onclick = () => {
      score++;
      out.textContent = score;
      b.remove();
      spawnSticker();
    };
    area.appendChild(b);
    setTimeout(()=>{if(b.isConnected) b.remove()},2600);
  }
  setInterval(bug,650);
}

function startReaction(){
  const box = $("#reactionBox");
  const out = $("#reactionOut");
  if(!box) return;
  reactionReady = false;
  box.className = "reaction-box";
  box.textContent = "wait for signal...";
  out.textContent = "";
  clearTimeout(reactionTimer);
  reactionTimer = setTimeout(()=>{
    reactionReady = true;
    reactionStart = performance.now();
    box.className = "reaction-box go";
    box.textContent = "GO! CLICK!";
  },900 + Math.random() * 2500);
  box.onclick = () => {
    if(!reactionReady){
      box.className = "reaction-box too-soon";
      box.textContent = "TOO SOON";
      out.textContent = "The archive refuses to certify that reflex.";
      clearTimeout(reactionTimer);
    }else{
      const ms = Math.round(performance.now() - reactionStart);
      out.textContent = `${ms} ms. ${ms < 250 ? "Unreasonably fast." : "Acceptable signal capture."}`;
      box.className = "reaction-box";
      box.textContent = "done";
      reactionReady = false;
    }
  };
}

function startPopupMole(){
  const area = $("#popupMole");
  const out = $("#moleScore");
  if(!area) return;
  area.innerHTML = "";
  let score = 0;
  let made = 0;
  const id = setInterval(()=>{
    made++;
    const mole = document.createElement("button");
    mole.className = "mole";
    mole.textContent = ["POP","AD","X","SALE","NOPE"][Math.floor(Math.random() * 5)];
    mole.style.left = Math.random() * 74 + "%";
    mole.style.top = Math.random() * 72 + "%";
    mole.onclick = () => {
      score++;
      out.textContent = score;
      mole.remove();
      spawnSticker();
    };
    area.appendChild(mole);
    setTimeout(()=>{if(mole.isConnected)mole.remove()},900);
    if(made >= 24) clearInterval(id);
  },430);
}

function mysteryButton(){
  const out = $("#mysteryOut");
  const actions = [
    () => {out.textContent = "The button changed its mind.";},
    () => {out.textContent = "A polite fake popup has been notified."; spawnAd(true);},
    () => {out.textContent = "Confetti protocol activated."; spawnConfetti();},
    () => {out.textContent = "The page made a tiny static noise in spirit."; document.body.classList.add("static-burst"); setTimeout(()=>document.body.classList.remove("static-burst"),1800);}
  ];
  actions[Math.floor(Math.random() * actions.length)]();
}

function fakeCaptcha(){
  const out = $("#captchaOut");
  const good = Math.random() > .45;
  out.textContent = good ? "Accepted. The archive believes you are mostly human." : "Rejected. Please select all squares containing existential dread.";
  if(!good) spawnAd(true);
}

function startCornerHunt(){
  const area = $("#cornerHunt");
  const out = $("#cornerOut");
  if(!area) return;
  area.innerHTML = "";
  const dot = document.createElement("button");
  dot.className = "corner-dot";
  dot.title = "click the signal";
  dot.style.left = Math.random() > .5 ? "3px" : "calc(100% - 32px)";
  dot.style.top = Math.random() > .5 ? "3px" : "calc(100% - 32px)";
  dot.onclick = () => {
    out.textContent = "Corner signal captured. It immediately filed a complaint.";
    dot.remove();
    spawnSticker();
  };
  area.appendChild(dot);
  out.textContent = "Find the glowing dot hiding in a corner.";
}

function fortuneClicker(){
  fortuneClicks++;
  const out = $("#fortuneClickOut");
  out.textContent = `Fortune clicks: ${fortuneClicks}. ${randomFortune()}`;
}

function badPassword(){
  const parts = ["signal","static","crt","mysterybolt","coupon","archive","button","beacon","void"];
  const out = $("#passOut");
  if(out) out.textContent = Array.from({length:4},()=>parts[Math.floor(Math.random()*parts.length)]).join("-") + "-" + Math.floor(Math.random()*9999);
}

function randomFortune(){
  const f = [
    "A blinking object will offer advice.",
    "The archive hums at a frequency only old modems respect.",
    "A fake coupon will arrive exactly too late.",
    "A tiny cabinet wants one more imaginary quarter.",
    "The mystery bolt knows where the missing panel went."
  ];
  return f[Math.floor(Math.random() * f.length)];
}

function fortune(){
  const out = $("#fortuneOut");
  if(out) out.textContent = randomFortune();
}

function guestbook(){
  const form = $("#guestForm");
  const list = $("#guestList");
  const clear = $("#clearGuestbook");
  if(!form || !list) return;
  let saved = JSON.parse(localStorage.getItem("oddGuestbook") || "[]");
  const render = () => {
    list.innerHTML = saved.map((x)=>`<div class="box"><b>${clean(x.name)}</b> tuned in:<br>${clean(x.msg)}<p class="hidden-note">${clean(x.date)}</p></div>`).join("") || "<div class='box'><i>No entries yet. The page is listening.</i></div>";
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    saved.unshift({
      name:$("#gname").value || "Anonymous Signal",
      msg:$("#gmsg").value || "The archive blinked back.",
      date:new Date().toLocaleString()
    });
    saved = saved.slice(0,30);
    localStorage.setItem("oddGuestbook",JSON.stringify(saved));
    render();
    form.reset();
  };
  if(clear){
    clear.onclick = () => {
      if(confirm("Clear the local guestbook entries in this browser?")){
        saved = [];
        localStorage.setItem("oddGuestbook","[]");
        render();
      }
    };
  }
  render();
}

function fakeDownload(name){
  const out = $("#downloadOut");
  if(out) out.innerHTML = `<b>${clean(name)}</b> failed successfully. No file was created, but the fake progress bar feels seen.`;
  spawnAd(true);
}

function randomThing(){
  const a = ["haunted","overclocked","discount","ancient","forbidden","glowing","sideways","unlabeled"];
  const b = ["keyboard","CRT","floppy disk","coupon","garden hose","router","antenna","receipt","tiny ladder"];
  const out = $("#thingOut");
  if(out) out.textContent = "Cataloged object: " + a[Math.floor(Math.random()*a.length)] + " " + b[Math.floor(Math.random()*b.length)];
}

function fakeFact(){
  const facts = [
    "Every abandoned button contains one unspent click.",
    "A web ring rotates counterclockwise when nobody is watching.",
    "CRT static can season a loading bar if applied incorrectly.",
    "The archive once cataloged a folder named New Folder (final) (real).",
    "A guestbook entry travels exactly one browser deep."
  ];
  const out = $("#factOut");
  if(out) out.textContent = facts[Math.floor(Math.random() * facts.length)];
}

function cursedLoad(){
  const bar = $("#loadBar span");
  const out = $("#loadOut");
  if(!bar) return;
  let n = 0;
  clearInterval(window.cursedLoader);
  window.cursedLoader = setInterval(()=>{
    n += Math.random() * 18;
    if(n > 99 && Math.random() > .35) n = 13;
    bar.style.width = Math.min(100,n) + "%";
    out.textContent = n >= 100 ? "Loading completed and immediately forgot why." : "Loading: " + Math.floor(n) + "%";
    if(n >= 100) clearInterval(window.cursedLoader);
  },240);
}

function uselessButton(btn){
  const labels = ["still useless","no output","button confidence +1","clicked, technically","try again?","archive says thanks"];
  btn.textContent = labels[Math.floor(Math.random() * labels.length)];
  if(Math.random() > .7) spawnSticker();
}

function fakeSurvey(){
  const out = $("#surveyOut");
  if(out) out.textContent = "Survey processed. Result: the archive recommends more blinking, somehow.";
}

function boltOracle(){
  const msg = [
    "That bolt belongs to a door that only appears during loading screens.",
    "Keep it. The archive will ask for it later.",
    "It is load-bearing in a symbolic way.",
    "The bolt says: turn left at the fake banner.",
    "Do not tighten the prophecy past 12 nonsense-units."
  ];
  const out = $("#boltOut");
  if(out) out.textContent = msg[Math.floor(Math.random() * msg.length)];
}

function archiveExperiment(){
  const ideas = [
    "A clock that only reports expired coupon times.",
    "A shrine for unclaimed desktop shortcuts.",
    "A loading bar that gets nervous near 100%.",
    "A fake banner that reviews other fake banners.",
    "A tiny maze where every exit leads to another button."
  ];
  const out = $("#ideaOut");
  if(out) out.textContent = ideas[Math.floor(Math.random() * ideas.length)];
}

function signalName(){
  const first = ["Dust","Neon","Static","Blink","Socket","Vapor","Click","Ribbon"];
  const last = ["Beacon","Widget","Oracle","Button","Signal","Panel","Cabinet"];
  const out = $("#signalOut");
  if(out) out.textContent = first[Math.floor(Math.random()*first.length)] + " " + last[Math.floor(Math.random()*last.length)];
}

function lightPanel(){
  const p = $("#lightPanel");
  if(!p) return;
  p.innerHTML = "";
  for(let i=0;i<24;i++){
    const l = document.createElement("button");
    l.className = "light";
    l.title = "toggle archive light";
    l.onclick = () => l.classList.toggle("on");
    p.appendChild(l);
  }
}

function scrambleMeters(){
  $$(".nonsense-meter span").forEach((span)=>span.style.width = Math.floor(8 + Math.random() * 92) + "%");
  const out = $("#meterOut");
  if(out) out.textContent = "Meters recalibrated without permission.";
}

function flipPanel(){
  document.body.classList.toggle("nightmare");
  const out = $("#labOut");
  if(out) out.textContent = document.body.classList.contains("nightmare") ? "Spectrum inversion active." : "Spectrum inversion parked.";
}

function openFakeWindow(title,body){
  const w = document.createElement("div");
  w.className = "fake-window";
  w.style.left = Math.max(10,Math.random() * Math.max(20,innerWidth - 390)) + "px";
  w.style.top = Math.max(10,Math.random() * Math.max(20,innerHeight - 245)) + "px";
  w.innerHTML = `<div class="win-title"><span>${title}</span><button class="x">X</button></div><div class="win-body"><p>${body}</p><button>OK</button><button onclick="spawnAd(true)">fake help</button></div>`;
  document.body.appendChild(w);
  w.querySelector(".x").onclick = () => w.remove();
  w.querySelector(".win-body button").onclick = () => w.remove();
  makeDraggable(w,w.querySelector(".win-title"));
}

function desktopClock(){
  const el = $("#clockBox");
  if(!el) return;
  const tick = () => el.textContent = new Date().toLocaleTimeString();
  tick();
  setInterval(tick,1000);
}

function desktopAlert(){
  openFakeWindow("Archive Alert","A fake desktop window noticed another fake desktop window. The recursion has been documented.");
}

function addFish(){
  const tank = $("#aquarium");
  if(!tank) return;
  const f = document.createElement("div");
  f.className = "fish";
  f.textContent = ["fish","eel","ray","crab","boot","sub"][Math.floor(Math.random()*6)];
  f.style.top = 18 + Math.random() * 245 + "px";
  f.style.animationDuration = 7 + Math.random() * 12 + "s";
  f.style.animationDelay = -(Math.random() * 6) + "s";
  f.onclick = () => {
    const out = $("#fishOut");
    if(out) out.textContent = "The aquarium resident filed a tiny incident report.";
    makeBubble(tank,parseFloat(f.style.top) || 120);
  };
  tank.appendChild(f);
}

function makeBubble(tank,y=260){
  const b = document.createElement("div");
  b.className = "bubble";
  const size = 8 + Math.random() * 20;
  b.style.width = size + "px";
  b.style.height = size + "px";
  b.style.left = Math.random() * 92 + "%";
  b.style.top = y + "px";
  tank.appendChild(b);
  setTimeout(()=>b.remove(),4200);
}

function feedFish(){
  const out = $("#fishOut");
  if(out) out.textContent = "The aquarium accepts the browser crumbs and becomes slightly weirder.";
  for(let i=0;i<4;i++) addFish();
}

function aquariumEvent(){
  const tank = $("#aquarium");
  const out = $("#fishOut");
  if(!tank) return;
  for(let i=0;i<12;i++) makeBubble(tank,260 + Math.random() * 30);
  if(out) out.textContent = ["Bubble storm declared.","A sign floats by: DO NOT TAP GLASS.","The boot moved two pixels."][Math.floor(Math.random()*3)];
}

function aquarium(){
  const tank = $("#aquarium");
  if(!tank) return;
  for(let i=0;i<10;i++) addFish();
  tank.onclick = (e) => {
    if(e.target === tank) makeBubble(tank,e.offsetY);
  };
}

function randomSecret(){
  return [
    "The corner hit will happen when attention drifts.",
    "Somewhere, a forgotten toolbar still updates its feelings.",
    "A mystery cable becomes useful once every seven years.",
    "The fake ad is afraid of the close button.",
    "The deep archive has a door labeled NO NORMAL PAGES."
  ][Math.floor(Math.random()*5)];
}

function unlockSecret(){
  const input = $("#secretPassword");
  const out = $("#secretGateOut");
  const panel = $("#secretPanel");
  if(!input || !panel) return;
  if(input.value.trim().toLowerCase() === "signal404"){
    panel.classList.add("unlocked");
    out.textContent = "ACCESS GRANTED: deep archive door unstuck.";
    spawnConfetti();
  }else{
    out.textContent = "ACCESS DENIED: the archive heard static.";
    spawnAd(true);
  }
}

function makeNoiseText(btn){
  btn.textContent = ["BEEP","BOOP","BZZT","STATIC","NOPE"][Math.floor(Math.random()*5)];
  spawnSticker();
}

function randomWebringJump(){
  const pages = ["void.html","ads.html","oracle.html","objects.html","tv.html","buttons.html","maze.html","random.html","aquarium.html"];
  location.href = pages[Math.floor(Math.random() * pages.length)];
}

function randomObjectShrine(){
  const out = $("#shrineOut");
  const objects = ["unlabeled adapter","green plastic jewel","ticket from nowhere","tiny brass switch","folded map to a 404","receipt for moon gas","single perfect pixel"];
  if(out) out.textContent = objects[Math.floor(Math.random() * objects.length)];
}

function tvStatic(){
  const out = $("#tvOut");
  if(out) out.textContent = ["CHANNEL 03: lost cooking show for cables","CHANNEL 17: weather inside a floppy disk","CHANNEL 44: silent auction for fake banners","CHANNEL 99: the loading void waves back"][Math.floor(Math.random()*4)];
  document.body.classList.add("static-burst");
  setTimeout(()=>document.body.classList.remove("static-burst"),1800);
}

function voidMessage(){
  const out = $("#voidOut");
  if(out) out.textContent = ["Still loading.","Still loading..","Still loading...","It loaded, but only emotionally.","The void requests another second."][Math.floor(Math.random()*5)];
}

function mazeChoice(id){
  const out = $("#mazeOut");
  const text = {
    a:"Room A contains a button labeled OTHER BUTTON.",
    b:"Room B smells like warm plastic and unresolved links.",
    c:"Room C loops back to itself with confidence.",
    d:"Room D opens a fake popup because of course it does.",
    e:"Room E has a sign: the exit is a mood.",
    f:"Room F reveals a shortcut to the oracle."
  };
  if(out) out.textContent = text[id] || "The maze blinks.";
  if(id === "d") spawnAd(true);
}

addEventListener("DOMContentLoaded",()=>{
  visitorCounter();
  randomQuote();
  clickGame();
  bugGame();
  guestbook();
  lightPanel();
  desktopClock();
  aquarium();
  bouncingLogo();
  updateAdStormButton();

  window.spawnConfetti = spawnConfetti;
  window.fortune = fortune;
  window.spawnAd = spawnAd;
  window.toggleAdStorm = toggleAdStorm;
  window.toggleSpinMode = toggleSpinMode;
  window.spawnSticker = spawnSticker;
  window.fakeDownload = fakeDownload;
  window.randomThing = randomThing;
  window.fakeFact = fakeFact;
  window.cursedLoad = cursedLoad;
  window.uselessButton = uselessButton;
  window.fakeSurvey = fakeSurvey;
  window.boltOracle = boltOracle;
  window.archiveExperiment = archiveExperiment;
  window.signalName = signalName;
  window.openFakeWindow = openFakeWindow;
  window.desktopAlert = desktopAlert;
  window.startReaction = startReaction;
  window.startPopupMole = startPopupMole;
  window.mysteryButton = mysteryButton;
  window.fakeCaptcha = fakeCaptcha;
  window.startCornerHunt = startCornerHunt;
  window.fortuneClicker = fortuneClicker;
  window.badPassword = badPassword;
  window.addFish = addFish;
  window.feedFish = feedFish;
  window.aquariumEvent = aquariumEvent;
  window.randomSecret = randomSecret;
  window.unlockSecret = unlockSecret;
  window.makeNoiseText = makeNoiseText;
  window.randomWebringJump = randomWebringJump;
  window.randomObjectShrine = randomObjectShrine;
  window.tvStatic = tvStatic;
  window.voidMessage = voidMessage;
  window.mazeChoice = mazeChoice;
  window.scrambleMeters = scrambleMeters;
  window.flipPanel = flipPanel;
});
