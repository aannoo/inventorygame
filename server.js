import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';
import { questions, scenarios, mixQuestions } from './questions.js';

const root = resolve('public');
const port = Number(process.env.PORT || 3000);
const rooms = new Map();
const avatars = new Set(['donatas','brendan','anno','oliver','romanian-rob','ridwan','sammer','rob-moriarty']);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
const duration = process.env.GAME_FAST === '1'
  ? { question: 650, feedback: 300, poo: 650 }
  : { question: 18000, feedback: 8000, poo: 7000 };
const shuffled = list => { const copy=[...list]; for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];} return copy; };
const token = () => randomBytes(12).toString('hex');
const code = () => randomBytes(3).toString('hex').toUpperCase();
const json = (res, status, data) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(data)); };

function makeQuestion(q) {
  if(q.slots) return {id:q.id,room:q.room,item:q.item,image:q.image,prompt:q.prompt,explain:q.explain,type:'mix',
    slots:q.slots.map(slot=>{const options=shuffled(slot.options.map((text,index)=>({text,index})));return {label:slot.label,options:options.map(x=>x.text),correct:options.findIndex(x=>x.index===0)};})};
  const desc = shuffled(q.description.map((text, index) => ({text,index})));
  const condition = shuffled(q.condition.map((text,index) => ({text,index})));
  return { id:q.id, room:q.room, item:q.item, image:q.image||`/assets/photos/${q.id}.webp`, type:'standard', desc, condition,
    correctDesc:desc.findIndex(x => x.index === 0), correctCondition:condition.findIndex(x => x.index === 0), explain:q.explain,
    scenario:q.scenario||null,prompt:q.prompt||'What are you actually looking at?',descLabel:q.descLabel||'1 · Accurate description',conditionLabel:q.conditionLabel||'2 · Visible condition' };
}
function publicState(room, playerId) {
  const q = room.deck[room.round];
  const player = room.players.find(p => p.secret === playerId);
  const reveal = room.phase === 'feedback' || room.phase === 'results';
  return {
    code:room.code, solo:room.solo, mode:room.mode, host:room.host === player?.id, phase:room.phase,
    matchId:room.matchId, turnId:room.turnId,
    deadline:room.deadline, now:Date.now(), round:room.round + 1, total:room.deck.length,
    players:room.players.map(p => ({id:p.id,name:p.name,avatar:p.avatar,score:p.score,streak:p.streak,answered:!!p.answer,poo:p.poo,attempts:p.attempts||0})),
    activity:room.activity.slice(-8),
    puzzleClues:room.mode==='puzzle'&&q&&room.phase!=='lobby'?room.clues:undefined,
    me: player ? {id:player.id, answered:!!player.answer, answer:reveal ? player.answer : undefined,lastAttempt:player.lastAttempt||null} : null,
    question: q && room.phase !== 'lobby' && room.phase !== 'poo' && room.phase !== 'results' ? q.type==='mix' ? {
      id:q.id,type:'mix',room:q.room,item:q.item,image:q.image,prompt:q.prompt,
      slots:q.slots.map(s=>({label:s.label,options:s.options,...(reveal?{correct:s.correct}:{})})),
      ...(reveal?{explain:q.explain}:{})
    } : {
      id:q.id,type:'standard',room:q.room,item:q.item,image:q.image,scenario:q.scenario,prompt:q.prompt,descLabel:q.descLabel,conditionLabel:q.conditionLabel,
      descriptions:q.desc.map(x => x.text),conditions:q.condition.map(x => x.text),
      ...(reveal ? {correctDesc:q.correctDesc,correctCondition:q.correctCondition,explain:q.explain} : {})
    } : null,
    pooWinner:room.pooWinner || null,
    roundResults:reveal ? room.roundResults : null,
    review:room.phase==='results' ? player?.history.filter(x=>!x.bothCorrect) : undefined
  };
}
function broadcast(room) {
  for (const p of room.players) for (const res of p.streams) {
    try { res.write(`data: ${JSON.stringify(publicState(room,p.secret))}\n\n`); } catch { p.streams.delete(res); }
  }
}
function activity(room,message) {
  room.activity.push({id:token(),message,at:Date.now()});
  if(room.activity.length>30) room.activity.shift();
}
function nextQuestion(room) {
  if (room.round >= room.deck.length) { room.phase='results'; room.deadline=0; broadcast(room); return; }
  room.phase=room.mode==='puzzle'?'puzzle':'question'; room.turnId=token(); room.startedAt=Date.now(); room.deadline=room.mode==='puzzle'?0:room.startedAt+duration.question; room.roundResults=null; room.clues=room.mode==='puzzle'?room.deck[room.round].slots.map(()=>null):[];
  for (const p of room.players) {p.answer=null;p.lastAttempt=null;p.attempts=0;}
  activity(room,room.mode==='puzzle'?`Puzzle ${room.round+1}/${room.deck.length}: solve the ${room.deck[room.round].item} together.`:`Round ${room.round+1}/${room.deck.length}: ${room.deck[room.round].item}.`);
  broadcast(room);
}
function finishQuestion(room) {
  if (room.phase !== 'question') return;
  room.phase='feedback'; room.deadline=Date.now()+duration.feedback;
  const q=room.deck[room.round];
  room.roundResults=room.players.map(p => {
    const a=p.answer;
    if(q.type==='mix') {
      const hits=q.slots.map((slot,i)=>!!a&&a.slots[i]===slot.correct),count=hits.filter(Boolean).length,all=count===q.slots.length;
      p.streak=all?p.streak+1:0;
      const points=count*35+(all?Math.max(0,Math.ceil((duration.question-(a.at-room.startedAt))/(duration.question/120)))+Math.min(p.streak,5)*15:0);
      p.score+=points;
      p.history.push({image:q.image,room:q.room,item:q.item,prompt:q.prompt,chosenDesc:a?q.slots.map((s,i)=>s.options[a.slots[i]]).join(' · '):'No answer',correctDesc:q.slots.map(s=>s.options[s.correct]).join(' · '),explain:q.explain,bothCorrect:all,type:'mix'});
      return {id:p.id,points,hits,count,all};
    }
    const desc=!!a && a.desc === q.correctDesc;
    const cond=!!a && a.condition === q.correctCondition;
    p.streak=desc&&cond ? p.streak+1 : 0;
    const points=(desc?60:0)+(cond?60:0)+(desc&&cond?Math.max(0,Math.ceil((duration.question-(a.at-room.startedAt))/(duration.question/120)))+Math.min(p.streak,5)*15:0);
    p.score+=points;
    p.history.push({image:q.image,room:q.room,item:q.item,scenario:q.scenario,prompt:q.prompt,descLabel:q.descLabel,conditionLabel:q.conditionLabel,
      chosenDesc:a ? q.desc[a.desc].text : 'No answer',chosenCondition:a ? q.condition[a.condition].text : 'No answer',
      correctDesc:q.desc[q.correctDesc].text,correctCondition:q.condition[q.correctCondition].text,
      explain:q.explain,bothCorrect:desc&&cond});
    return {id:p.id,points,desc,cond};
  });
  const top=room.roundResults.filter(r=>q.type==='mix'?r.all:r.desc&&r.cond).length;
  activity(room,`Round ${room.round+1} complete: ${top}/${room.players.length} got the full report right.`);
  broadcast(room);
}
function solvePuzzle(room,player,slots) {
  const q=room.deck[room.round];
  const hits=q.slots.map((slot,i)=>slots[i]===slot.correct);
  player.attempts++;
  player.lastAttempt={hits,count:hits.filter(Boolean).length,at:Date.now()};
  let newClues=0;
  hits.forEach((hit,i)=>{if(hit&&!room.clues[i]){room.clues[i]={label:q.slots[i].label,value:q.slots[i].options[q.slots[i].correct],by:player.name};newClues++;}});
  if(hits.every(Boolean)) {
    player.answer={slots,at:Date.now()};
    room.phase='feedback';room.deadline=Date.now()+Math.max(duration.feedback,3000);
    const points=Math.max(50,200-(room.players.reduce((n,p)=>n+p.attempts,0)-1)*15);
    for(const p of room.players) p.score+=points;
    room.roundResults=room.players.map(p=>({id:p.id,points,all:true,hits}));
    activity(room,`${player.name} solved puzzle ${room.round+1}! Everyone earns ${points} points.`);
  } else activity(room,`${player.name} tried a report: ${player.lastAttempt.count}/${q.slots.length} parts fit${newClues?`; uncovered ${newClues} new ${newClues===1?'clue':'clues'}`:''}.`);
  broadcast(room);
}
function startPoo(room) {
  room.phase='poo'; room.turnId=token(); room.deadline=Date.now()+duration.poo; room.pooWinner=null;
  for (const p of room.players) { p.poo=0; p.pooAt=0; }
  activity(room,'WC break! Tap to race for 80 bonus points.');
  broadcast(room);
}
function finishPoo(room) {
  if(room.phase !== 'poo') return;
  const best=Math.max(...room.players.map(p=>p.poo));
  const winners=room.players.filter(p=>p.poo===best && best>0);
  for(const p of winners) p.score+=80;
  room.pooWinner=winners.length ? winners.map(p=>p.name).join(' & ') : 'The toilet';
  activity(room,`WC break winner: ${room.pooWinner}.`);
  room.round++;
  nextQuestion(room);
}
function createRoom(solo,name,avatar,mode='classic') {
  let c; do { c=code(); } while(rooms.has(c));
  const id=token(),secret=token();
  const room={code:c,solo,mode,host:id,phase:'lobby',deadline:0,round:0,deck:[],players:[],activity:[],roundResults:null,pooRounds:new Set(),pooWinner:null,created:Date.now(),matchId:null,turnId:null};
  room.players.push({id,secret,name,avatar,score:0,streak:0,answer:null,poo:0,pooAt:0,streams:new Set(),history:[],disconnectedAt:Date.now()});
  rooms.set(c,room);
  if(solo) start(room);
  return {room,secret};
}
function start(room) {
  room.matchId=token();
  room.deck=(room.mode==='puzzle'?shuffled(mixQuestions):shuffled([...shuffled(questions).slice(0,8),...shuffled(scenarios).slice(0,2),...shuffled(mixQuestions).slice(0,2)])).map(makeQuestion);
  room.round=0; room.pooWinner=null; room.activity=[]; room.pooRounds=room.mode==='puzzle'?new Set():new Set(shuffled([3,4,5,6,7,8,9]).slice(0,2));
  for(const p of room.players) { p.score=0; p.streak=0; p.poo=0; p.answer=null; p.history=[]; }
  nextQuestion(room);
}
function advance(room) {
  if(!room.deadline || Date.now()<room.deadline) return;
  if(room.phase==='question') finishQuestion(room);
  else if(room.phase==='feedback') {
    if(room.mode==='classic' && room.pooRounds.has(room.round)) startPoo(room);
    else {room.round++; nextQuestion(room);}
  } else if(room.phase==='poo') finishPoo(room);
}
function removePlayer(room,player) {
  for(const stream of player.streams) stream.end();
  room.players=room.players.filter(p=>p!==player);
  if(!room.players.length){rooms.delete(room.code);return;}
  if(room.host===player.id) room.host=room.players[0].id;
  activity(room,`${player.name} left the room.`);
  if(room.phase==='question' && room.players.every(p=>p.answer)) finishQuestion(room);
  else broadcast(room);
}
setInterval(() => {
  for(const [key,room] of rooms) {
    advance(room);
    for(const p of [...room.players]) if(p.disconnectedAt && Date.now()-p.disconnectedAt>60000) removePlayer(room,p);
    if(Date.now()-room.created > 6*60*60*1000) { for(const p of room.players) for(const s of p.streams) s.end(); rooms.delete(key); }
  }
},200).unref();

async function body(req) {
  let raw='';
  for await(const chunk of req) { raw+=chunk; if(raw.length>10000) throw new Error('Request too large'); }
  return JSON.parse(raw || '{}');
}
const cleanName = value => String(value || '').trim().slice(0,20).replace(/[<>]/g,'') || 'Clerk';
const cleanAvatar = value => avatars.has(value) ? value : 'donatas';
const loopback = host => ['localhost','127.0.0.1','::1','[::1]'].includes(host);
function wifiAddress() {
  try {
    const interfaces=networkInterfaces();
    for(const [name,addresses] of Object.entries(interfaces)) {
      if(!/^(wlan|wifi|eth|en|ap|lan)/i.test(name) || /(tun|tap|vpn|rmnet|cell)/i.test(name)) continue;
      for(const entry of addresses||[]) {
        if(entry.family!=='IPv4'||entry.internal) continue;
        const ip=entry.address;
        if(/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return ip;
      }
    }
  } catch {}
  return null;
}
function validManualIp(value) {
  const parts=String(value||'').trim().split('.');
  if(parts.length!==4 || !parts.every(part=>/^\d{1,3}$/.test(part)&&Number(part)<=255)) return null;
  const ip=parts.join('.');
  return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? ip : null;
}
async function inviteInfo(req,url) {
  const originText=url.searchParams.get('origin')||'';
  let browserOrigin;
  try {browserOrigin=new URL(originText);} catch {browserOrigin=new URL(`http://${req.headers.host||`localhost:${port}`}`);}
  if(!['http:','https:'].includes(browserOrigin.protocol)) throw new Error('Invalid invite origin');
  const supplied=url.searchParams.get('wifiIp');
  const manual=validManualIp(supplied);
  if(supplied && !manual) throw new Error('Enter a private Wi‑Fi IPv4 address');
  let origin=browserOrigin.origin;
  if(loopback(browserOrigin.hostname) || (manual && validManualIp(browserOrigin.hostname))) {
    const ip=manual||wifiAddress();
    if(!ip) return {url:null,qr:null,needsAddress:true,scope:'local'};
    const portPart=browserOrigin.port||String(port);
    origin=`http://${ip}:${portPart}`;
  }
  const invite=`${origin}/?room=${encodeURIComponent(String(url.searchParams.get('code')||'').toUpperCase())}`;
  const svg=await QRCode.toString(invite,{type:'svg',errorCorrectionLevel:'M',margin:1,width:220});
  const inviteHost=new URL(origin).hostname;
  const localInvite=loopback(inviteHost)||validManualIp(inviteHost)||inviteHost.endsWith('.local');
  return {url:invite,qr:`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,needsAddress:false,scope:localInvite?'local':'internet',autoWifiIp:manual||((loopback(browserOrigin.hostname)||validManualIp(browserOrigin.hostname))?wifiAddress():null)};
}
function roomAndPlayer(data) {
  const room=rooms.get(String(data.code || '').toUpperCase());
  if(!room) throw new Error('Room not found');
  const player=room.players.find(p=>p.secret===data.playerId);
  if(!player) throw new Error('Join the room first');
  return {room,player};
}
async function handleApi(req,res,url) {
  if(req.method==='POST' && url.pathname==='/api/create') {
    const data=await body(req), {room,secret}=createRoom(!!data.solo,cleanName(data.name),cleanAvatar(data.avatar),data.mode==='puzzle'?'puzzle':'classic');
    json(res,200,{code:room.code,playerId:secret,state:publicState(room,secret)}); return;
  }
  if(req.method==='POST' && url.pathname==='/api/join') {
    const data=await body(req), room=rooms.get(String(data.code||'').toUpperCase());
    if(!room) throw new Error('Room not found');
    if(room.solo || room.phase!=='lobby') throw new Error('That game has already started');
    if(room.players.length>=8) throw new Error('Room is full');
    const id=token(),secret=token();
    room.players.push({id,secret,name:cleanName(data.name),avatar:cleanAvatar(data.avatar),score:0,streak:0,answer:null,poo:0,pooAt:0,streams:new Set(),history:[],disconnectedAt:Date.now()});
    activity(room,`${room.players.at(-1).name} joined the room.`);
    broadcast(room); json(res,200,{code:room.code,playerId:secret,state:publicState(room,secret)}); return;
  }
  if(req.method==='POST' && url.pathname==='/api/start') {
    const {room,player}=roomAndPlayer(await body(req));
    if(player.id!==room.host) throw new Error('Only the host can start');
    if(room.phase!=='lobby' && room.phase!=='results') throw new Error('Game already running');
    start(room); json(res,200,{ok:true}); return;
  }
  if(req.method==='POST' && url.pathname==='/api/restart') {
    const {room,player}=roomAndPlayer(await body(req));
    if(!room.solo && player.id!==room.host) throw new Error('Only the host can restart this room');
    if(room.phase==='lobby') throw new Error('Start the lobby first');
    start(room); json(res,200,{ok:true}); return;
  }
  if(req.method==='POST' && url.pathname==='/api/answer') {
    const data=await body(req),{room,player}=roomAndPlayer(data); advance(room);
    if(room.phase!=='question' || player.answer) throw new Error('Answer window closed');
    if(data.matchId!==room.matchId || data.turnId!==room.turnId) throw new Error('That round has ended');
    const q=room.deck[room.round];
    if(q.type==='mix') {
      if(!Array.isArray(data.slots)||data.slots.length!==q.slots.length||!data.slots.every((value,i)=>Number.isInteger(value)&&value>=0&&value<q.slots[i].options.length)) throw new Error('Choose every report part');
      player.answer={slots:data.slots,at:Date.now()};
    } else {
      if(!Number.isInteger(data.desc)||!Number.isInteger(data.condition)||data.desc<0||data.desc>=q.desc.length||data.condition<0||data.condition>=q.condition.length) throw new Error('Choose both answers');
      player.answer={desc:data.desc,condition:data.condition,at:Date.now()};
    }
    activity(room,`${player.name} locked in a report (${room.players.filter(p=>p.answer).length}/${room.players.length}).`);
    broadcast(room);
    if(room.players.every(p=>p.answer)) finishQuestion(room);
    json(res,200,{ok:true}); return;
  }
  if(req.method==='POST' && url.pathname==='/api/puzzle') {
    const data=await body(req),{room,player}=roomAndPlayer(data);advance(room);
    if(room.mode!=='puzzle'||room.phase!=='puzzle') throw new Error('This puzzle has ended');
    if(data.matchId!==room.matchId||data.turnId!==room.turnId) throw new Error('That puzzle has ended');
    const q=room.deck[room.round];
    if(!Array.isArray(data.slots)||data.slots.length!==q.slots.length||!data.slots.every((value,i)=>Number.isInteger(value)&&value>=0&&value<q.slots[i].options.length)) throw new Error('Choose every report part');
    solvePuzzle(room,player,data.slots);json(res,200,{ok:true});return;
  }
  if(req.method==='POST' && url.pathname==='/api/poo') {
    const data=await body(req),{room,player}=roomAndPlayer(data); advance(room);
    if(room.phase!=='poo') throw new Error('The toilet is occupied');
    if(data.matchId!==room.matchId || data.turnId!==room.turnId) throw new Error('That WC break has ended');
    const now=Date.now();
    if(now-player.pooAt>=90 && player.poo<55) {player.poo++; player.pooAt=now; broadcast(room);}
    json(res,200,{ok:true}); return;
  }
  if(req.method==='POST' && url.pathname==='/api/leave') {
    const {room,player}=roomAndPlayer(await body(req)); removePlayer(room,player);
    json(res,200,{ok:true}); return;
  }
  if(req.method==='GET' && url.pathname==='/api/events') {
    const {room,player}=roomAndPlayer(Object.fromEntries(url.searchParams));
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});
    player.disconnectedAt=null; player.streams.add(res); res.write(`data: ${JSON.stringify(publicState(room,player.secret))}\n\n`);
    const heartbeat=setInterval(()=>res.write(': ping\n\n'),20000);
    req.on('close',()=>{clearInterval(heartbeat);player.streams.delete(res);if(!player.streams.size)player.disconnectedAt=Date.now();}); return;
  }
  if(req.method==='GET' && url.pathname==='/api/state') {
    const {room,player}=roomAndPlayer(Object.fromEntries(url.searchParams));
    json(res,200,publicState(room,player.secret)); return;
  }
  if(req.method==='GET' && url.pathname==='/api/invite') {
    const {room}=roomAndPlayer(Object.fromEntries(url.searchParams));
    json(res,200,await inviteInfo(req,new URL(`${url.pathname}${url.search}`,`http://${req.headers.host||'localhost'}`))); return;
  }
  json(res,404,{error:'Not found'});
}
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(url.pathname.startsWith('/api/')) {await handleApi(req,res,url);return;}
    if(req.method!=='GET') {json(res,405,{error:'Method not allowed'});return;}
    const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(path!==root && !path.startsWith(root+'/')) {json(res,403,{error:'Forbidden'});return;}
    const info=await stat(path);
    if(!info.isFile()) throw new Error('Not found');
    res.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream','cache-control':path.includes('/assets/')?'public, max-age=604800':'no-cache'});
    res.end(await readFile(path));
  } catch(error) { if(!res.headersSent) json(res,error.code==='ENOENT'?404:400,{error:error.message||'Something went wrong'}); else res.end(); }
});
server.listen(port,'0.0.0.0',()=>console.log(`Inventory Mayhem on http://localhost:${port}`));
