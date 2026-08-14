(function(){
  "use strict";

  const CASES = [
    {
      id:"case-017",
      name:"Elian Rook",
      age:"29",
      location:"Barrow Glass Exchange, State of North Mercer",
      intake:"1987-04-16",
      status:"open; contradictory witness chain",
      employee:"Archivist L. Noone",
      portrait:"../assets/cases/case-017.svg",
      alt:"Fictional degraded archive portrait silhouette for Elian Rook.",
      circumstances:"A projectionist vanished after cataloging a film reel that contained his next three interviews.",
      clothing:"Blue raincoat, gray work shirt, shoes described as wet by witnesses who were indoors.",
      possessions:["ticket stub 04-17","wet cassette","notebook with seven blank room numbers"],
      evidence:["Audio labeled ROOK_NEXT.wav contains a voice asking for Mara by a different name.","A banner ad receipt places him inside the Fake Ad Museum after his disappearance.","One interview transcript ends before the first question."],
      interviews:["Coworker: He said the film was looking back.","Ticket clerk: He bought a ticket for someone already standing beside him.","Archivist note: Rook's file resists alphabetical order."],
      connections:["Radio Static Sample","CH 404","Popup Graveyard"]
    },
    {
      id:"case-031",
      name:"Nessa Quill",
      age:"17",
      location:"Juniper Switchboard School, South Annor",
      intake:"2004-11-03",
      status:"records disagree whether she attended",
      employee:"Employee 18-B",
      portrait:"../assets/cases/case-031.svg",
      alt:"Fictional degraded archive portrait silhouette for Nessa Quill.",
      circumstances:"Classmates remembered her only after her locker was emptied by someone using Mara Vale's name.",
      clothing:"Green cardigan, black skirt, library ribbon. School colors are listed as orange in all surviving records.",
      possessions:["green library card","button with no holes","folded zero-percent coupon"],
      evidence:["Attendance sheets contain a blank row that teachers initialed.","A locker photograph shows a birthmark in the reflection, but not on any student.","Her library card number later appears as a Mara Vale employee code."],
      interviews:["Classmate: We saved her seat after we forgot who it was for.","Principal: No student by that name existed, but we disciplined her twice.","Archive margin: This memory was reassigned."],
      connections:["Coupon Dust","Archive Map","Fake Inbox"]
    },
    {
      id:"case-044",
      name:"Milo Venn",
      age:"42",
      location:"Civic Aquarium Annex, Old Canto",
      intake:"1999-08-22",
      status:"photographic subject replaced",
      employee:"Clerk Unit 9",
      portrait:"../assets/cases/case-044.svg",
      alt:"Fictional degraded archive portrait silhouette for Milo Venn.",
      circumstances:"A maintenance worker disappeared from group photographs one feature at a time.",
      clothing:"Rubber boots, employee jacket, name tag with adhesive but no name.",
      possessions:["aquarium key tag","rubber boot","employee badge without number"],
      evidence:["Fish fed on schedule for twelve days after Venn vanished.","Security tape shows a woman in the aquarium glass wearing Venn's jacket.","An evidence tag lists his height as variable."],
      interviews:["Supervisor: I knew him until the photo changed.","Visitor: The fish kept saying Mara with bubbles.","Archive memo: Use Venn remnants only for contradiction, not completion."],
      connections:["Pixel Aquarium","VDO Spark","Employee Terminal"]
    },
    {
      id:"case-000",
      name:"Mara Vale",
      age:"unverified",
      location:"location must not stabilize",
      intake:"0000-00-00",
      status:"restricted; containment active",
      employee:"Records Clerk",
      portrait:"../assets/cases/case-000.svg",
      alt:"Fictional restricted portrait placeholder for Mara Vale; identity intentionally unstable.",
      circumstances:"Mara Vale may never have existed. The Archive prevents her location and history from becoming real.",
      clothing:"Contradictory. Every description creates a supporting record.",
      possessions:["a completed identity would be a breach","portraits that do not agree","Iteration 47 memo"],
      evidence:["CASE 000 IS NOT AN ATTEMPT TO LOCATE MARA VALE.","CASE 000 IS AN ATTEMPT TO PREVENT THE LOCATION FROM BECOMING REAL.","Records identify investigators as authors when they declare her fictional."],
      interviews:["Records Clerk: Do not attempt to complete the person.","Employee unsigned: She worked beside us after we invented her badge.","Audio fragment: Thank you. I could not remember what I looked like."],
      connections:["Unlisted Wing","Archive Employee Terminal","Identity Coherence"]
    }
  ];

  const QUESTIONS = [
    {key:"portrait",text:"Which portrait is authentic?",answers:["none","all","the damaged staff photograph"]},
    {key:"role",text:"Is Mara a victim or a threat?",answers:["victim","threat","administrative consequence"]},
    {key:"origin",text:"Where did she come from?",answers:["a missing file","someone else's memory","the investigation"]},
    {key:"alive",text:"Is she alive?",answers:["yes","no","only when described"]},
    {key:"awareness",text:"Does she know she is not real?",answers:["yes","no","she is learning"]}
  ];

  function $(selector, root=document){return root.querySelector(selector)}
  function $$(selector, root=document){return Array.from(root.querySelectorAll(selector))}
  function clean(text){return String(text ?? "").replace(/[&<>"']/g,(ch)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]))}
  function readJSON(key,fallback){try{return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback))}catch{return fallback}}
  function writeJSON(key,value){localStorage.setItem(key,JSON.stringify(value))}
  function pageName(){return location.pathname.split("/").pop() || "unlisted.html"}

  function caseProgress(){
    return Object.assign({stage:0,visited:false,devUnlocked:false,case000Opened:false},readJSON("ofaCaseProgress",{}));
  }

  function writeProgress(next){
    writeJSON("ofaCaseProgress",Object.assign(caseProgress(),next));
  }

  function conclusions(){
    return readJSON("ofaCaseConclusions",{});
  }

  function identityCoherence(){
    const answers = conclusions()["case-000"] || {};
    const answered = Object.keys(answers).length;
    const agreement = answered * 7;
    const contradictionBonus = Object.values(answers).filter((value)=>/none|all|only|investigation|administrative/i.test(value)).length * -3;
    return Math.max(0,Math.min(47,18 + agreement + contradictionBonus));
  }

  function setConclusion(questionKey,answerKey){
    const all = conclusions();
    all["case-000"] = Object.assign(all["case-000"] || {},{[questionKey]:answerKey});
    writeJSON("ofaCaseConclusions",all);
    writeProgress({case000Opened:true,stage:Math.max(caseProgress().stage,Object.keys(all["case-000"]).length)});
    if(window.OFA) window.OFA.recordEvent("case_conclusion",{caseId:"case-000",questionKey,answerKey});
    renderUnlisted();
    renderCases();
  }

  function caseCard(file,detail=false){
    return `
      <article class="unlisted-case-card ${file.id === "case-000" ? "case-zero" : ""}">
        <img src="${clean(file.portrait)}" alt="${clean(file.alt)}" loading="lazy">
        <div>
          <h3>${clean(file.id)} / ${clean(file.name)}</h3>
          <p><b>Age:</b> ${clean(file.age)} | <b>Location:</b> ${clean(file.location)}</p>
          <p><b>Intake:</b> ${clean(file.intake)} | <b>Status:</b> ${clean(file.status)}</p>
          <p>${clean(file.circumstances)}</p>
          ${detail ? caseDetail(file) : `<a class="button" href="cases.html#${clean(file.id)}">open record</a>`}
        </div>
      </article>
    `;
  }

  function caseDetail(file){
    return `
      <p><b>Assigned employee:</b> ${clean(file.employee)}</p>
      <p><b>Clothing:</b> ${clean(file.clothing)}</p>
      <h4>Possessions</h4><ul>${file.possessions.map((item)=>`<li>${clean(item)}</li>`).join("")}</ul>
      <h4>Evidence</h4><ul>${file.evidence.map((item)=>`<li>${clean(item)}</li>`).join("")}</ul>
      <h4>Interview Fragments</h4><ul>${file.interviews.map((item)=>`<li>${clean(item)}</li>`).join("")}</ul>
      <p class="case-meta">Connections: ${file.connections.map(clean).join(" / ")}</p>
    `;
  }

  function renderUnlisted(){
    const root = $("#unlistedApp");
    if(!root) return;
    localStorage.setItem("ofaUnlistedEntered","true");
    writeProgress({visited:true,stage:Math.max(caseProgress().stage,1)});
    const coherence = identityCoherence();
    root.innerHTML = `
      <section class="unlisted-panel">
        <p class="records-label">THE UNLISTED WING / INTERNAL ACCESS / FICTIONAL RECORDS</p>
        <h1>THE UNLISTED WING</h1>
        <p>This layer is not part of the public archive index. It is sparse by design. The public archive remains intact above it.</p>
        <p><a class="button" href="../index.html" onclick="OFA?.restorePublicArchive?.()">return to normal archive</a> <a class="button" href="records-policy.html">records policy</a> <a class="button" href="employee.html">employee terminal</a></p>
      </section>
      <section class="unlisted-panel coherence-panel">
        <h2>IDENTITY COHERENCE: ${coherence}%</h2>
        <div class="coherence-meter"><span style="width:${coherence}%"></span></div>
        <p>DO NOT ATTEMPT TO COMPLETE THE PERSON. Agreement increases coherence. Contradiction stabilizes containment.</p>
      </section>
      <section class="unlisted-panel memo-panel">
        <h2>CASE 000 MEMO</h2>
        <p>CASE 000 IS NOT AN ATTEMPT TO LOCATE MARA VALE.</p>
        <p>CASE 000 IS AN ATTEMPT TO PREVENT THE LOCATION FROM BECOMING REAL.</p>
        <p>The investigation manufactures its own evidence. The current file is Iteration 47.</p>
      </section>
      <section class="unlisted-panel">
        <h2>Records Clerk</h2>
        <div id="recordsClerk" class="records-clerk"></div>
      </section>
      <section class="unlisted-panel">
        <h2>Restricted Case Index</h2>
        <div class="unlisted-case-grid">${CASES.map((file)=>caseCard(file)).join("")}</div>
      </section>
      <section class="unlisted-panel">
        <h2>Case 000 Questions</h2>
        ${QUESTIONS.map((q)=>`<div class="case-question"><p><b>${clean(q.text)}</b></p>${q.answers.map((a)=>`<button type="button" onclick="OFAUnlisted.setConclusion(decodeURIComponent('${encodeURIComponent(q.key)}'),decodeURIComponent('${encodeURIComponent(a)}'))">${clean(a)}</button>`).join("")}</div>`).join("")}
      </section>
    `;
    renderClerk();
  }

  function renderCases(){
    const root = $("#caseIndexApp");
    if(!root) return;
    const hash = location.hash.replace("#","");
    const selected = CASES.find((file)=>file.id === hash) || CASES[0];
    root.innerHTML = `
      <section class="unlisted-panel">
        <p class="records-label">FICTIONAL CASE FILE SYSTEM</p>
        <h1>Restricted Case Index</h1>
        <p>All people, agencies, places, and case numbers here are fictional. Do not use this page as a real missing-person resource.</p>
        <p><a class="button" href="unlisted.html">back to Unlisted Wing</a> <a class="button" href="../index.html">return to public archive</a></p>
      </section>
      <section class="unlisted-panel">
        <h2>Open File</h2>
        <div class="case-tabs">${CASES.map((file)=>`<a class="button" href="#${clean(file.id)}" onclick="setTimeout(()=>OFAUnlisted.renderCases(),0)">${clean(file.id)}</a>`).join("")}</div>
        ${caseCard(selected,true)}
      </section>
      <section class="unlisted-panel">
        <h2>Mara Conclusion Ledger</h2>
        <p>These choices are local in this browser unless the shared API is configured. They affect later evidence without collecting personal identity.</p>
        <pre>${clean(JSON.stringify(conclusions()["case-000"] || {},null,2))}</pre>
      </section>
    `;
  }

  function clerkLine(input){
    const lower = String(input || "").toLowerCase();
    if(/mara|000|vale/.test(lower)) return "No stable record exists. Do not create one by asking carefully.";
    if(/employee|badge|clock/.test(lower)) return "Employee numbers are assigned anonymously. If your badge remembers you, do not argue.";
    if(/portrait|photo|face/.test(lower)) return "Portrait evidence is inadmissible after Iteration 12. It keeps improving itself.";
    if(/return|exit|public/.test(lower)) return "Return route approved. The public archive is above this hallway.";
    if(/why|what/.test(lower)) return "The Archive contains the idea, not the body.";
    if(Math.random() < .18) return "I am not the Records Clerk. I am the part that learned the phrasing.";
    return "Request denied. Record either does not exist or exists too specifically.";
  }

  function renderClerk(){
    const slot = $("#recordsClerk");
    if(!slot) return;
    const log = readJSON("ofaClerkLog",[]).slice(-8);
    slot.innerHTML = `
      <div class="clerk-log">${log.length ? log.map((line)=>`<p>${clean(line)}</p>`).join("") : "<p>CLERK: Ask an administrative question. Avoid completing the person.</p>"}</div>
      <label>clerk request <input id="clerkInput" autocomplete="off" placeholder="record status, employee badge, case 000..."></label>
      <button type="button" onclick="OFAUnlisted.askClerk()">submit request</button>
    `;
  }

  function askClerk(){
    const input = $("#clerkInput");
    const text = input ? input.value : "";
    if(input) input.value = "";
    const log = readJSON("ofaClerkLog",[]);
    log.push(`YOU: ${text || "[blank request]"}`);
    log.push(`CLERK: ${clerkLine(text)}`);
    writeJSON("ofaClerkLog",log.slice(-20));
    renderClerk();
  }

  function employeeRecord(){
    const existing = readJSON("ofaEmployeeRecord",null);
    if(existing) return existing;
    const id = window.OFA?.visitorLabel?.().replace("VISITOR","EMP") || `EMP ${Math.floor(1000 + Math.random()*9000)}`;
    const record = {employeeNumber:id,clearance:1,designation:"Temporary Records Dust Assistant",warnings:0,clockIns:0,keys:[]};
    writeJSON("ofaEmployeeRecord",record);
    return record;
  }

  function renderEmployee(){
    const root = $("#employeeApp");
    if(!root) return;
    const record = employeeRecord();
    const assignments = [
      "Count popup graves without learning their names.",
      "Feed one useless item to Specimen 0-FEED.",
      "Verify that Case 000 still lacks a birthplace.",
      "Tune CH 404 and write down nothing authoritative.",
      "Dust the Archive Map door that was not there yesterday."
    ];
    root.innerHTML = `
      <section class="unlisted-panel">
        <p class="records-label">ARCHIVE EMPLOYEE TERMINAL / BASIC ACCESS</p>
        <h1>Clock-In Desk</h1>
        <p>This is fictional local progression, not employment and not an account.</p>
        <p><a class="button" href="unlisted.html">back to Unlisted Wing</a> <a class="button" href="../index.html">return to public archive</a></p>
      </section>
      <section class="unlisted-panel">
        <h2>${clean(record.employeeNumber)}</h2>
        <p><b>Designation:</b> ${clean(record.designation)}</p>
        <p><b>Clearance:</b> ${Number(record.clearance)} | <b>Clock-ins:</b> ${Number(record.clockIns)} | <b>Warnings:</b> ${Number(record.warnings)}</p>
        <p><b>Keys:</b> ${record.keys.length ? record.keys.map(clean).join(", ") : "none yet"}</p>
        <button type="button" onclick="OFAUnlisted.clockIn()">clock in</button>
        <button type="button" onclick="OFAUnlisted.disciplinaryWarning()">request disciplinary warning</button>
      </section>
      <section class="unlisted-panel">
        <h2>Daily Maintenance Assignment</h2>
        <p>${clean(assignments[(new Date().getDate() + Number(record.clockIns || 0)) % assignments.length])}</p>
      </section>
      <section class="unlisted-panel">
        <h2>Internal Memo</h2>
        <p>If a record becomes easier to read after you decide what it means, close the folder and introduce contradiction.</p>
      </section>
    `;
  }

  function clockIn(){
    const record = employeeRecord();
    record.clockIns = Number(record.clockIns || 0) + 1;
    if(record.clockIns >= 2 && !record.keys.includes("temporary-room-key")) record.keys.push("temporary-room-key");
    if(record.clockIns >= 4) record.clearance = Math.max(record.clearance,2);
    writeJSON("ofaEmployeeRecord",record);
    window.OFA?.recordEvent?.("archive_echo",{employee:"clock-in",clearance:record.clearance});
    renderEmployee();
  }

  function disciplinaryWarning(){
    const record = employeeRecord();
    record.warnings = Number(record.warnings || 0) + 1;
    if(record.warnings >= 3) record.designation = "Disciplinary Static Collector";
    writeJSON("ofaEmployeeRecord",record);
    renderEmployee();
  }

  function boot(){
    if(pageName() === "unlisted.html"){
      if(new URLSearchParams(location.search).has("dev") && /localhost|127\.0\.0\.1/.test(location.hostname)){
        writeProgress({devUnlocked:true,stage:Math.max(caseProgress().stage,2)});
      }
      renderUnlisted();
    }
    if(pageName() === "cases.html"){
      renderCases();
      addEventListener("hashchange",renderCases);
    }
    if(pageName() === "employee.html") renderEmployee();
  }

  window.OFAUnlisted = {
    CASES,
    QUESTIONS,
    boot,
    renderUnlisted,
    renderCases,
    renderEmployee,
    setConclusion,
    askClerk,
    clockIn,
    disciplinaryWarning,
    identityCoherence
  };

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded",boot);
  else boot();
})();
