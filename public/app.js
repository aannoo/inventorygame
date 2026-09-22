const app=document.querySelector('#app');
const toastEl=document.querySelector('#toast');
const clerks=[['donatas','Donatas'],['brendan','Brendan'],['anno','Anno'],['oliver','Oliver'],['romanian-rob','Romanian Rob'],['ridwan','Ridwan'],['sammer','Sammer'],['rob-moriarty','Rob Moriarty']];
const goodLines=['Well observed. The camera has finally met someone who can read it.','Correct. You may keep your imaginary clipboard.','A clean observation. The typist might even forgive you.','Nailed it. The deposit dispute trembles.','You saw the detail before it could hide.'];
const badLines=['That description belongs in a parallel universe.','A thrilling guess. Unfortunately, the photograph disagrees.','The evidence was right there, waving at you.','That report would make a letting agent develop a twitch.','Please stop making the wall confess to crimes it did not commit.'];
let name=localStorage.getItem('im-name')||'';
let avatar=localStorage.getItem('im-avatar')||'donatas';
let session=JSON.parse(localStorage.getItem('im-session')||'null');
let state=null,source=null,selection={desc:null,condition:null,slots:[]},questionId=null,offset=0,soundOn=localStorage.getItem('im-sound')!=='off',busy=false,renderedKey=null,joinDraft='';
let lastPhase=null,lastRound=0,invite=null,inviteLoading=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const qs=new URLSearchParams(location.search);
const invited=qs.get('room')?.toUpperCase()||'';
joinDraft=invited;

function toast(message){toastEl.textContent=message;toastEl.classList.add('show');clearTimeout(toastEl.timer);toastEl.timer=setTimeout(()=>toastEl.classList.remove('show'),3000);}
function sound(freq=440,len=.09,type='sine'){
  if(!soundOn)return;
  try {const ctx=new (window.AudioContext||window.webkitAudioContext)(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.type=type;osc.frequency.value=freq;gain.gain.setValueAtTime(.035,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+len);osc.connect(gain).connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+len);osc.onended=()=>ctx.close();}catch{}
}
async function api(path,data){const response=await fetch('/api/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Request failed');return result;}
function savedIdentity(){name=document.querySelector('#name')?.value.trim()||name||'Clerk';name=name.slice(0,20);localStorage.setItem('im-name',name);localStorage.setItem('im-avatar',avatar);}
function brand(right='') {return `<header class="brand"><div class="logo">📋 INVENTORY MAYHEM</div>${right||`<button class="mute" data-action="sound" aria-label="Toggle sound">${soundOn?'🔊':'🔇'}</button>`}</header>`;}
function home(){
  state=null;questionId=null;lastPhase=null;renderedKey=null;
  app.innerHTML=brand()+`<section class="screen"><div class="hero"><div class="eyebrow">The inspection arcade</div><h1>SPOT IT.<br>REPORT IT.<br>WIN.</h1><p>Real property photos. Unforgiving feedback. Occasionally, a toilet emergency.</p><div class="mascot">🕵️</div></div><div class="label">Your clerk name</div><input id="name" class="field" maxlength="20" placeholder="Enter a name" value="${esc(name)}"><div class="label">Choose your clerk</div><div class="avatar-grid">${clerks.map(([id,label])=>`<button class="avatar-choice ${avatar===id?'selected':''}" data-action="avatar" data-avatar="${id}"><img src="/assets/clerks/${id}.webp" alt=""><span>${label}</span></button>`).join('')}</div><div class="buttons"><button class="button" data-action="solo">⚡ SOLO SPRINT</button><button class="button secondary" data-action="create">🏆 CREATE LIVE ROOM</button><button class="button pink" data-action="create-puzzle">🧩 PUZZLE WITH A FRIEND</button></div><div class="label">Join a live room</div><div class="join-row"><input id="join-code" class="field" inputmode="latin" maxlength="6" placeholder="6-digit code" value="${esc(joinDraft)}"><button class="button pink" data-action="join">JOIN</button></div><p class="small">Share the invite link. Everyone must open the same game server before using the room code.</p><p class="note">Classic: 12 rounds, including 2 build-a-report rounds, plus WC breaks. Puzzle: solve 3 reports together at your own pace.</p></section>`;
}
function scoreList(players,sort=true,showPoo=false){
  const list=sort?[...players].sort((a,b)=>b.score-a.score):players;
  return `<div class="score-list">${list.map((p,i)=>`<div class="score-row ${p.id===state?.me?.id?'me':''}"><span>${showPoo?`${i+1}.`:sort?`${list.findIndex(x=>x.score===p.score)+1}.`:p.answered?'✓':'…'}</span><img src="/assets/clerks/${p.avatar}.webp" alt=""><span class="name">${esc(p.name)}</span><span class="tick">${showPoo?`${p.poo} pushes`:p.answered?'✓ locked':p.streak>1?`🔥${p.streak}`:''}</span><span class="pts">${p.score}</span></div>`).join('')}</div>`;
}
function activityHtml(s){return `<section class="activity-panel" aria-label="Live room activity"><h3>📡 Live activity</h3><div class="activity-list">${(s.activity||[]).slice(-5).reverse().map(x=>`<p>${esc(x.message)}</p>`).join('')||'<p>Waiting for the crew…</p>'}</div></section>`;}
function patchDynamic(){
  if(!state)return;
  const mute=document.querySelector('.mute[data-action="sound"]');if(mute){mute.textContent=soundOn?'🔊':'🔇';mute.setAttribute('aria-label',soundOn?'Mute sound':'Unmute sound');}
  const actions=document.querySelector('.game-actions');if(actions && Boolean(actions.querySelector('[data-action="restart"]'))!==Boolean(state.host))actions.outerHTML=gameActions(state);
  const scores=document.querySelector('.score-list');
  if(scores) scores.outerHTML=state.phase==='poo' ? scoreList([...state.players].sort((a,b)=>b.poo-a.poo),false,true) : scoreList(state.players);
  const activity=document.querySelector('.activity-panel');if(activity)activity.outerHTML=activityHtml(state);
  const live=document.querySelector('.live-strip');if(live)live.textContent=state.phase==='puzzle'?`🧩 ${state.players.reduce((n,p)=>n+p.attempts,0)} crew attempts · shared score ${state.players[0]?.score||0}`:`📝 ${state.players.filter(p=>p.answered).length}/${state.players.length} reports locked`;
  const liveNow=document.querySelector('.live-now');if(liveNow)liveNow.textContent=state.activity?.at(-1)?.message||'Waiting for the crew…';
  const summary=document.querySelector('.mix-summary');if(summary&&state.question?.type==='mix')summary.innerHTML=`<b>Your report:</b> ${state.question.slots.map((slot,i)=>esc(slot.options[selection.slots[i]]||'…')).join(' · ')}`;
  if(state.phase==='poo'){
    const me=state.players.find(p=>p.id===state.me?.id);
    const meter=document.querySelector('.meter>div');if(meter)meter.style.width=`${Math.min(100,(me?.poo||0)/35*100)}%`;
    const push=document.querySelector('[data-action="push"]');if(push)push.textContent=`💨 PUSH! ${me?.poo||0}`;
  }
  if(state.phase==='question'||state.phase==='puzzle'){
    document.querySelectorAll('.choice').forEach(button=>{
      const selected=button.dataset.kind==='slot'?selection.slots[Number(button.dataset.slot)]===Number(button.dataset.index):selection[button.dataset.kind]===Number(button.dataset.index);
      button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
      button.disabled=state.phase==='question'&&!!state.me?.answered;
    });
    const lock=document.querySelector('[data-action="answer"]');
    if(lock){const ready=state.question?.type==='mix'?state.question.slots.every((_,i)=>Number.isInteger(selection.slots[i])):selection.desc!==null&&selection.condition!==null;lock.disabled=(state.phase==='question'&&!!state.me?.answered)||!ready;lock.textContent=state.phase==='puzzle'?'TRY THIS REPORT 🧩':state.me?.answered?'ANSWER LOCKED ✓':'LOCK IN REPORT ⚡';}
  }
  updateTimer();
}
async function loadInvite(wifiIp=''){
  if(!session||inviteLoading)return;
  const code=session.code,playerId=session.playerId;
  inviteLoading=true;
  try{
    const params=new URLSearchParams({code,playerId,origin:location.origin});
    if(wifiIp)params.set('wifiIp',wifiIp);
    const response=await fetch(`/api/invite?${params}`);
    if(!response.ok)throw new Error('Invite link unavailable');
    const data=await response.json();
    if(session?.code===code&&session?.playerId===playerId){invite={code,...data};if(state?.phase==='lobby')render();}
  }catch(error){if(session?.code===code){if(!invite?.url)invite={code,url:null,qr:null,needsAddress:true};if(state?.phase==='lobby')render();toast(error.message);}}
  finally{inviteLoading=false;}
}
function lobbyHtml(s){
  if(invite?.code!==s.code){invite=null;loadInvite();}
  const url=invite?.url;
  const local=invite?.scope!=='internet';
  const networkHelp=local?`<p class="note"><b>Local connection:</b> The other phone must open this invite link and reach this server. Public or bar Wi‑Fi may block devices from reaching each other, even on the same Wi‑Fi. If the link will not open, use one phone’s hotspot and connect both devices to it, or run the game on a public HTTPS server. Changing the room code will not bypass Wi‑Fi isolation.</p>`:`<p class="note"><b>Internet connection:</b> Players can open this invite link from different networks. Everyone must use this same server.</p>`;
  return `<section class="screen"><div class="pill">${s.mode==='puzzle'?'🧩 PUZZLE CREW':'🎉 THE CREW IS ASSEMBLING'}</div><h1>${s.mode==='puzzle'?'Puzzle room':'Live room'}</h1><p class="small">${s.mode==='puzzle'?'Work together on three photo reports. Everyone sees attempts and shares the score. There is no timer.':'Race through photo and build-a-report rounds. Everyone sees who has answered and how each round went.'}</p><div class="lobby-code">${s.code}</div><p class="small">Share this link or scan the QR, then join with the room code.</p>${url?`<img class="invite-qr" src="${invite.qr}" alt="QR code for joining room ${s.code}"><input class="field invite-url" aria-label="Invite link" readonly value="${esc(url)}"><div class="buttons"><button class="button secondary" data-action="share">📲 SHARE INVITE</button><button class="button pink" data-action="copy">📋 COPY LINK</button></div>`:`<p class="note">${inviteLoading?'Finding an invite link…':'Enter this device’s local IP address to make a join link.'}</p>`}${networkHelp}${local?`<details class="manual-address"><summary>Use a different local IP address</summary><div class="join-row"><input id="manual-ip" class="field" inputmode="decimal" placeholder="192.168.1.20" value="${esc(invite?.autoWifiIp||'')}"><button class="button secondary" data-action="manual-invite">USE IP</button></div><p class="small">Find it in this device’s Wi‑Fi or hotspot settings. This only helps if devices can reach each other.</p></details>`:''}<h2>Players · ${s.players.length}/8</h2>${scoreList(s.players,false)}${activityHtml(s)}${s.host?`<div class="buttons"><button class="button" data-action="start">${s.mode==='puzzle'?'🧩 START PUZZLE':'🚀 START THE CHAOS'}</button></div>`:'<p class="note">Waiting for the host to start.</p>'}<div class="buttons"><button class="button pink" data-action="leave">← LEAVE ROOM</button></div></section>`;
}
function gameActions(s){return `<div class="game-actions"><button class="mini-action" data-action="leave">🚪 EXIT</button>${s.host?'<button class="mini-action" data-action="restart">🔁 RESTART</button>':''}</div>`;}
function reviewCard(x){
  return `<div class="review"><img src="${x.image}" alt="Review photo"><div><b>${esc(x.room)} · ${esc(x.item)}</b>${x.scenario?`<p><b>Scenario facts:</b> ${esc(x.scenario)}</p>`:''}<p><b>Your ${x.type==='mix'?'report':esc(x.descLabel)}:</b> ${esc(x.chosenDesc)}</p>${x.type==='mix'?'':`<p><b>Your ${esc(x.conditionLabel)}:</b> ${esc(x.chosenCondition)}</p>`}<p><b>Correct:</b> ${esc(x.correctDesc)}${x.type==='mix'?'':' / '+esc(x.correctCondition)}</p><small>${esc(x.explain)}</small></div></div>`;
}
function mixChoices(q,feedback){return `<div class="mix-summary"><b>Your report:</b> ${q.slots.map((slot,i)=>esc(slot.options[feedback?state.me?.answer?.slots?.[i]:selection.slots[i]]||'…')).join(' · ')}</div>${q.slots.map((slot,j)=>`<div class="label">${j+1} · ${esc(slot.label)}</div><div class="choice-list mix-options">${slot.options.map((value,i)=>choice('slot',i,value,feedback,slot.correct,j)).join('')}</div>`).join('')}`;}

function render(){
  if(!state){home();return;}
  const s=state;
  const selectionKey=s.question?`${s.matchId}:${s.turnId}`:null;
  if(selectionKey!==questionId){selection={desc:null,condition:null,slots:[]};questionId=selectionKey;}
  const key=`${s.matchId}:${s.phase}:${s.round}${s.phase==='puzzle'?':'+s.players.reduce((n,p)=>n+p.attempts,0):''}`;
  const previousKey=renderedKey;
  if(key===renderedKey && (s.phase==='question'||s.phase==='puzzle'||s.phase==='poo')){patchDynamic();return;}
  const header=brand(`<span class="pill">${s.solo?'SOLO':s.mode==='puzzle'?'PUZZLE '+s.code:'ROOM '+s.code}</span><button class="mute" data-action="sound" aria-label="${soundOn?'Mute sound':'Unmute sound'}">${soundOn?'🔊':'🔇'}</button>`)+(s.phase==='question'||s.phase==='puzzle'||s.phase==='feedback'||s.phase==='poo'?gameActions(s):'');
  if(s.phase==='lobby'){
    const manualState={open:document.querySelector('.manual-address')?.open,value:document.querySelector('#manual-ip')?.value};
    app.innerHTML=header+lobbyHtml(s);
    if(manualState.value!==undefined)document.querySelector('#manual-ip').value=manualState.value;
    if(manualState.open)document.querySelector('.manual-address').open=true;
  } else if(s.phase==='question'||s.phase==='feedback'||s.phase==='puzzle'){
    const q=s.question,feedback=s.phase==='feedback',puzzle=s.mode==='puzzle',mine=s.roundResults?.find(x=>x.id===s.me?.id);
    const correct=q.type==='mix'?mine?.all:mine?.desc&&mine?.cond;
    const line=correct?goodLines[(s.round-1)%goodLines.length]:badLines[(s.round-1)%badLines.length];
    const status=feedback?(puzzle?'🧩 SOLVED':'📣 VERDICT'):puzzle?'🤝 NO TIMER':'⏱ <span id="timer">18.0</span>s';
    const reports=s.players.filter(p=>p.answered).length;
    const clueHtml=puzzle?`<div class="clue-board"><b>🧩 Shared clues · ${(s.puzzleClues||[]).filter(Boolean).length}/${q.slots.length}</b>${(s.puzzleClues||[]).map((clue,i)=>`<div><span>${esc(q.slots[i].label)}</span><strong>${clue?esc(clue.value):'?'}</strong>${clue?`<small>found by ${esc(clue.by)}</small>`:''}</div>`).join('')}</div>`:'';
    const choices=q.type==='mix'?mixChoices(q,feedback):`<div class="label">${esc(q.descLabel)}</div><div class="choice-list">${q.descriptions.map((value,i)=>choice('desc',i,value,feedback,q.correctDesc)).join('')}</div><div class="label">${esc(q.conditionLabel)}</div><div class="choice-list">${q.conditions.map((value,i)=>choice('condition',i,value,feedback,q.correctCondition)).join('')}</div>`;
    const ready=q.type==='mix'?q.slots.every((_,i)=>Number.isInteger(selection.slots[i])):selection.desc!==null&&selection.condition!==null;
    const resultDetail=feedback?`<div class="feedback ${correct?'good':''}">${puzzle?`Solved together · +${mine?.points||0} each`:q.type==='mix'?`+${mine?.points||0} POINTS · ${mine?.count||0}/${q.slots.length} parts right`:`+${mine?.points||0} POINTS · ${line}`}</div><div class="explain"><b>Clerk’s note:</b> ${esc(q.explain)}</div>${!puzzle?`<div class="round-breakdown"><b>Everyone’s round</b>${s.players.map(p=>{const r=s.roundResults?.find(x=>x.id===p.id);return `<div><span>${esc(p.name)}</span><strong>${r?.points?`+${r.points}`:'0'} · ${q.type==='mix'?`${r?.count||0}/${q.slots.length} parts`:r?.desc&&r?.cond?'both right':r?.desc?'description right':r?.cond?'condition right':'no correct parts'}</strong></div>`}).join('')}</div>`:''}<p class="next-cue">${s.round===s.total?'Final results next':`Next: ${puzzle?'puzzle':'round'} ${s.round+1} of ${s.total}`} · <span id="timer"></span>s</p>`:'';
    const attempt=s.me?.lastAttempt;
    const attemptHtml=puzzle&&!feedback&&attempt?`<div class="feedback ${attempt.count===q.slots.length?'good':''}">Your last try: ${attempt.count}/${q.slots.length} parts fit. ${attempt.count===q.slots.length?'Solved!':'Change the highlighted parts and try again.'}</div><div class="part-hints">${q.slots.map((slot,i)=>`<span class="${attempt.hits[i]?'hit':'miss'}">${attempt.hits[i]?'✓':'↺'} ${esc(slot.label)}</span>`).join('')}</div>`:'';
    app.innerHTML=header+`<section class="screen"><div class="topline"><span class="pill">${puzzle?'PUZZLE':'ROUND'} ${s.round}/${s.total}</span><span class="pill">${status}</span></div>${puzzle?'':`<div class="progress"><div id="timebar"></div></div>`}<div class="live-strip">${puzzle?`🧩 ${s.players.reduce((n,p)=>n+p.attempts,0)} crew attempts · shared score ${s.players[0]?.score||0}`:`📝 ${reports}/${s.players.length} reports locked`}</div><div class="live-now" aria-live="polite">${esc(s.activity?.at(-1)?.message||'Waiting for the crew…')}</div>${q.scenario?`<div class="scenario"><b>SCENARIO FACTS</b><p>${esc(q.scenario)}</p></div>`:''}<div class="photo-wrap"><img src="${q.image}" alt="Property inspection photo"><span class="room-tag">${esc(q.room)}</span></div><h2 class="question-title">${esc(q.prompt)}</h2><p class="small coach">${puzzle?'Pick every part, then compare clues with your friend. A wrong try reveals correct parts to the whole crew.':q.type==='mix'?'Select one option in every row to build a complete report.':q.scenario?'Use the stated facts and visible evidence.':'Use only what this view actually shows.'}</p>${clueHtml}${choices}${!feedback?(s.me?.answered?'<div class="feedback good">Report locked. Watching the crew finish…</div>':`<div class="buttons"><button class="button" data-action="answer" ${ready?'':'disabled'}>${puzzle?'TRY THIS REPORT 🧩':'LOCK IN REPORT ⚡'}</button></div>`):resultDetail}${attemptHtml}<h3>${puzzle?'Shared crew score':'Live leaderboard'}</h3>${scoreList(s.players)}${activityHtml(s)}</section>`;
  } else if(s.phase==='poo'){
    const me=s.players.find(p=>p.id===s.me?.id);
    app.innerHTML=header+`<section class="screen"><div class="topline"><span class="pill">🚨 RANDOM WC BREAK</span><span class="pill">⏱ <span id="timer">7.0</span>s</span></div><div class="progress"><div id="timebar"></div></div><h1>THRONE SPRINT</h1><p class="small">The inspection is paused. Tap PUSH faster than the other clerks. The most pushes gets 80 bonus points. Yes, this is in the syllabus now.</p><div class="poo-stage"><div class="wc-sign">FLAT WC · INSPECTION PAUSED</div><div class="poo-emoji">💩</div><div class="toilet">🚽</div><div class="meter"><div style="width:${Math.min(100,(me?.poo||0)/35*100)}%"></div></div><div class="buttons"><button class="button pink" data-action="push">💨 PUSH! ${me?.poo||0}</button></div></div>${scoreList([...s.players].sort((a,b)=>b.poo-a.poo),false,true)}</section>`;
  } else if(s.phase==='results'){
    const rank=[...s.players].sort((a,b)=>b.score-a.score),winner=rank[0],me=rank.findIndex(p=>p.score===rank.find(x=>x.id===s.me?.id)?.score)+1,tied=rank.filter(p=>p.score===winner?.score);
    app.innerHTML=header+`<section class="screen"><div class="winner">${s.mode==='puzzle'?'🧩 PUZZLES SOLVED!':`🏆 ${tied.length>1?`${tied.map(p=>esc(p.name)).join(' & ')} TIE!`:`${esc(winner?.name||'The toilet')} WINS!`}`}</div><h2>${s.mode==='puzzle'?'Crew report complete':s.solo?'Inspection complete':'Final leaderboard'}</h2><p class="small">${s.mode==='puzzle'?`You solved ${s.total} reports together. Shared score: ${winner?.score||0}.`:s.solo?`You scored ${winner?.score||0} points. The clipboard has seen worse.`:`You finished #${me}. The clipboard remembers.`}</p>${scoreList(s.players)}${activityHtml(s)}${s.mode==='puzzle'?'':s.review?.length?`<h2>Missed evidence · ${s.review.length}</h2>${s.review.map(reviewCard).join('')}`:'<p class="note">No missed evidence. Annoyingly competent.</p>'}<div class="buttons">${s.host?`<button class="button" data-action="start">🔁 PLAY AGAIN</button>`:''}<button class="button secondary" data-action="leave">🏠 MAIN MENU</button></div></section>`;
  }
  renderedKey=key;
  updateTimer();
  if(previousKey!==key){
    if(s.phase==='question'||s.phase==='poo'||s.phase==='results')window.scrollTo({top:0,behavior:'auto'});
    else if(s.phase==='feedback')requestAnimationFrame(()=>document.querySelector('.feedback')?.scrollIntoView({block:'center',behavior:'auto'}));
  }
}
function choice(kind,i,value,feedback,correctIndex){
  const slot=arguments[5];
  const selected=kind==='slot'?(feedback?state.me?.answer?.slots?.[slot]===i:selection.slots[slot]===i):(feedback?state.me?.answer?.[kind]===i:selection[kind]===i);
  const verdict=feedback?(i===correctIndex?'correct':selected?'wrong':''):'';
  return `<button class="choice ${selected?'selected':''} ${verdict}" data-action="choice" data-kind="${kind}" ${kind==='slot'?`data-slot="${slot}"`:''} data-index="${i}" aria-pressed="${selected}" ${feedback||(state.phase==='question'&&state.me?.answered)?'disabled':''}><b>${String.fromCharCode(65+i)}</b>${esc(value)}${feedback&&i===correctIndex?' ✓ Correct':feedback&&selected?' ✗ Your answer':''}</button>`;
}
function updateTimer(){
  if(!state?.deadline)return;
  const remaining=Math.max(0,state.deadline-(Date.now()+offset));
  const timer=document.querySelector('#timer');if(timer)timer.textContent=(remaining/1000).toFixed(1);
  const bar=document.querySelector('#timebar');if(bar)bar.style.width=`${remaining/(state.phase==='poo'?7000:state.phase==='feedback'?8000:18000)*100}%`;
}
function connect(){
  source?.close();if(!session)return;
  const active={...session};
  const stream=new EventSource(`/api/events?code=${encodeURIComponent(active.code)}&playerId=${encodeURIComponent(active.playerId)}`);
  source=stream;
  stream.onmessage=event=>{
    if(source!==stream||session?.playerId!==active.playerId)return;
    document.querySelector('#connection-banner')?.classList.remove('show');
    const next=JSON.parse(event.data);offset=next.now-Date.now();
    if(lastPhase!==next.phase||lastRound!==next.round){
      if(next.phase==='poo') {sound(160,.25,'sawtooth');setTimeout(()=>sound(90,.3,'sawtooth'),150);}
      if(next.phase==='feedback')sound(610,.12,'triangle');
      if(next.phase==='results')sound(790,.3,'triangle');
      if(lastPhase==='poo'&&next.pooWinner)toast(`🚽 WC champion: ${next.pooWinner}. The porcelain applauds.`);
    }
    lastPhase=next.phase;lastRound=next.round;state=next;render();
  };
  stream.onerror=async()=>{
    if(source!==stream||session?.playerId!==active.playerId)return;
    document.querySelector('#connection-banner')?.classList.add('show');
    try{const r=await fetch(`/api/state?code=${encodeURIComponent(active.code)}&playerId=${encodeURIComponent(active.playerId)}`);if(source!==stream||session?.playerId!==active.playerId)return;if(!r.ok){stream.close();source=null;session=null;localStorage.removeItem('im-session');home();toast('That room has expired. Start a fresh one.');document.querySelector('#connection-banner')?.classList.remove('show');}}catch{}
  };
}
async function restore(){
  if(!session){home();return;}
  try{const r=await fetch(`/api/state?code=${encodeURIComponent(session.code)}&playerId=${encodeURIComponent(session.playerId)}`);if(!r.ok)throw new Error();state=await r.json();offset=state.now-Date.now();render();connect();}
  catch{localStorage.removeItem('im-session');session=null;home();toast('That room has expired. Start a fresh one.');}
}
document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-action]');if(!el)return;
  const action=el.dataset.action;
  if(action==='sound'){if(!state){name=document.querySelector('#name')?.value||name;joinDraft=document.querySelector('#join-code')?.value||joinDraft;}soundOn=!soundOn;localStorage.setItem('im-sound',soundOn?'on':'off');render();return;}
  if(action==='avatar'){avatar=el.dataset.avatar;document.querySelectorAll('.avatar-choice').forEach(x=>x.classList.toggle('selected',x.dataset.avatar===avatar));sound(520);return;}
  if(action==='choice'){if(el.dataset.kind==='slot')selection.slots[Number(el.dataset.slot)]=Number(el.dataset.index);else selection[el.dataset.kind]=Number(el.dataset.index);sound(430);render();return;}
  if(action==='push'){
    sound(100+Math.random()*80,.08,'sawtooth');
    try{await api('poo',{...session,matchId:state.matchId,turnId:state.turnId});}catch{}
    return;
  }
  if(busy)return;
  busy=true;
  try{
    if(action==='solo'||action==='create'||action==='create-puzzle'){
      savedIdentity();const result=await api('create',{solo:action==='solo',mode:action==='create-puzzle'?'puzzle':'classic',name,avatar});session={code:result.code,playerId:result.playerId};localStorage.setItem('im-session',JSON.stringify(session));state=result.state;connect();render();
    } else if(action==='join'){
      savedIdentity();const code=document.querySelector('#join-code')?.value.trim().toUpperCase();if(!code)throw new Error('Enter the room code');
      const result=await api('join',{code,name,avatar});session={code:result.code,playerId:result.playerId};localStorage.setItem('im-session',JSON.stringify(session));state=result.state;connect();render();
    } else if(action==='start'){await api('start',session);sound(780,.16);}
    else if(action==='restart'){if(!state.solo&&!window.confirm('Restart for everyone? Current scores and round progress will be cleared.'))return;await api('restart',session);sound(780,.16);}
    else if(action==='answer'){const q=state.question;if(q.type==='mix'){if(!q.slots.every((_,i)=>Number.isInteger(selection.slots[i])))return;await api(state.phase==='puzzle'?'puzzle':'answer',{...session,matchId:state.matchId,turnId:state.turnId,slots:selection.slots});}else{if(selection.desc===null||selection.condition===null)return;await api('answer',{...session,matchId:state.matchId,turnId:state.turnId,desc:selection.desc,condition:selection.condition});}sound(700,.12);}
    else if(action==='manual-invite'){const ip=document.querySelector('#manual-ip')?.value.trim();if(!ip)throw new Error('Enter this phone’s Wi‑Fi IP address');await loadInvite(ip);}
    else if(action==='copy'){const url=invite?.url;if(!url)throw new Error('Invite link is not ready');try{await navigator.clipboard.writeText(url);toast('Invite link copied. Send it to the crew.');}catch{const field=document.querySelector('.invite-url');field?.focus();field?.select();toast('Link selected. Tap Copy in the text menu.');}}
    else if(action==='share'){const url=invite?.url;if(!url)throw new Error('Invite link is not ready');if(navigator.share){try{await navigator.share({title:'Inventory Mayhem',text:`Join room ${state.code}`,url});}catch(error){if(error.name!=='AbortError')toast('Use the copy button or QR code.');}}else{const field=document.querySelector('.invite-url');field?.focus();field?.select();toast('Link selected. Tap Copy or scan the QR code.');}}
    else if(action==='leave'){source?.close();source=null;try{await api('leave',session);}catch{}session=null;invite=null;localStorage.removeItem('im-session');history.replaceState(null,'',location.pathname);home();}
  }catch(error){toast(error.message);}
  finally{busy=false;}
});
setInterval(updateTimer,100);
restore();
