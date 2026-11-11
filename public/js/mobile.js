import { $, toast, websocketUrl, clamp } from './common.js';

const input = $('#pair-input');
const joinPanel = $('#join-panel');
const cameraPanel = $('#camera-panel');
const remotePanel = $('#remote-panel');
const video = $('#camera-video');
const canvas = $('#camera-overlay');
const ctx = canvas.getContext('2d');
const phoneStatus = $('#phone-connection');
const phoneToast = $('#phone-toast');
const statusText = $('#camera-status');
const camBadge = $('#camera-badge');
const cameraPeople = $('#camera-people');
const cameraPlaceholder = $('#camera-placeholder');
const stage = $('#camera-window');
let ws = null;
let roomCode = '';
let pendingCode = '';
let cameraStream = null;
let face = 'user';
let landmarker = null;
let currentModelPromise = null;
let isCapturing = false;
let isStarting = false;
let ready = false;
let lastFrameAt = 0;
let lastVideoTime = -1;
let lastStatusAt = 0;
let frameId = 0;
let lock = null;
let gameRunning = false;
let gameState = 'lobby';
const SIDE_COLORS = ['#ff7cb6','#64e2ff'];
const JOINTS = [0,11,12,13,14,15,16,23,24,25,26];
const LINES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[24,26]];

function notify(text){ toast(phoneToast,text,4200); }
function send(data){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));}
function setConnection(connected) {
  phoneStatus.classList.toggle('connected',connected);
  phoneStatus.textContent = connected?'● TV conectada':'○ Desconectado';
  joinPanel.classList.toggle('hidden',connected);
  cameraPanel.classList.toggle('hidden',!connected);
  remotePanel.classList.toggle('hidden',!connected);
  setButtons();
}
function setButtons(){
  $('#camera-start').disabled=isCapturing||isStarting;
  $('#camera-start').textContent=isStarting?'⏳ Preparando...':'📹 Ativar câmera';
  $('#camera-stop').disabled=!isCapturing&&!isStarting;
  $('#camera-flip').disabled=isStarting;
  $('#phone-play').disabled=!ready;
  $('#phone-pause').disabled=!ready||!['running','countdown','paused'].includes(gameState);
  $('#phone-restart').disabled=!ready||gameState==='lobby';
  $('#phone-pause').textContent=gameState==='paused'?'▶ Continuar':'⏸ Pausar';
}
function sendStatus(detected=0){send({type:'camera_status',ready,detected});}
function connect(code) {
  if (!/^\d{6}$/.test(code)) {notify('Informe os 6 números mostrados na TV.');return;}
  pendingCode = code;
  if(ws && (ws.readyState===WebSocket.CONNECTING||ws.readyState===WebSocket.OPEN)) {
    if(ws.readyState===WebSocket.OPEN)send({type:'join_room',code:pendingCode});
    return;
  }
  statusText.textContent='Conectando ao jogo...';
  ws = new WebSocket(websocketUrl());
  ws.addEventListener('open',()=>send({type:'join_room',code:pendingCode}));
  ws.addEventListener('message',(event)=>{
    let msg;try{msg=JSON.parse(event.data);}catch{return;}
    if(msg.type==='joined') {
      roomCode=msg.code;
      history.replaceState(null,'',`/celular?codigo=${roomCode}`);
      setConnection(true);
      statusText.textContent='Conectado à TV! Agora toque em Ativar câmera.';
      notify('🎉 TV conectada! Ative a câmera.');
    } else if(msg.type==='settings') {
      if(['bolhas','estrelas','danca'].includes(msg.mode))$('#phone-game').value=msg.mode;
      if([1,2].includes(Number(msg.count)))$('#phone-count').value=String(msg.count);
      gameRunning=msg.running === true;
      if(['lobby','running','countdown','paused','ended'].includes(msg.state)) gameState=msg.state;
      setButtons();
    } else if(msg.type==='error') {
      notify(msg.message||'Não foi possível conectar.');
      statusText.textContent=msg.message||'Código inválido.';
    } else if(msg.type==='tv_disconnected') {
      notify('A TV foi desconectada. Volte à TV e use o novo código.');
      disconnect();
    }
  });
  ws.addEventListener('close',()=>{
    if(roomCode) {
      notify('Conexão perdida. Confira a TV e use o código novamente.');
      disconnect(false);
    } else if(pendingCode) notify('Não foi possível alcançar o servidor.');
  });
  ws.addEventListener('error',()=>notify('Falha na conexão. Confira sua internet.'));
}
function disconnect(closeSocket=true){
  stopCamera();
  roomCode='';pendingCode='';gameRunning=false;gameState='lobby';
  if(closeSocket)ws?.close();
  ws=null;
  setConnection(false);
}
$('#pair-form').addEventListener('submit',(e)=>{e.preventDefault();connect(input.value.replace(/\D/g,'').slice(0,6));});
input.addEventListener('input',()=>{input.value=input.value.replace(/\D/g,'').slice(0,6);});
const initialCode=new URLSearchParams(location.search).get('codigo')||'';
if(/^\d{6}$/.test(initialCode)){input.value=initialCode;connect(initialCode);}

async function getModel() {
  if(landmarker) return landmarker;
  if(currentModelPromise) return currentModelPromise;
  currentModelPromise = (async()=>{
    const {FilesetResolver,PoseLandmarker}=await import('/vendor/vision_bundle.mjs');
    const vision=await FilesetResolver.forVisionTasks('/vendor/wasm');
    const model=await PoseLandmarker.createFromOptions(vision,{
      baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',delegate:'CPU'},
      runningMode:'VIDEO',numPoses:2,
      minPoseDetectionConfidence:.45,minPosePresenceConfidence:.45,minTrackingConfidence:.45,
    });
    landmarker=model;
    return model;
  })();
  try {return await currentModelPromise;}
  finally {currentModelPromise=null;}
}
async function startCamera(){
  if(isCapturing||isStarting||!roomCode)return;
  if(!navigator.mediaDevices?.getUserMedia){
    notify('Seu navegador não oferece câmera aqui. Use HTTPS e Chrome, Safari ou Firefox atualizado.');return;
  }
  isStarting=true;ready=false;setButtons();
  statusText.textContent='Solicitando permissão da câmera...';
  try {
    cameraStream=await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{facingMode:{ideal:face},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30}}
    });
    video.srcObject=cameraStream;
    await video.play();
    stage.style.aspectRatio=`${video.videoWidth} / ${video.videoHeight}`;
    const mirrored=face==='user';
    video.classList.toggle('front-camera',mirrored);
    canvas.classList.toggle('front-camera',mirrored);
    canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    cameraPlaceholder.hidden=true;
    cameraPeople.hidden=false;
    cameraPeople.textContent='🔎 Iniciando reconhecimento...';
    statusText.textContent='Carregando o detector de movimentos (primeira vez pode levar um pouco)...';
    await getModel();
    if(!cameraStream||!roomCode) return;
    ready=true;isCapturing=true;
    camBadge.textContent='● Ativa';camBadge.classList.add('connected');
    sendStatus(0);lastFrameAt=0;lastStatusAt=0;lastVideoTime=-1;
    statusText.textContent='Câmera funcionando! Aponte para as duas crianças e mostre o corpo inteiro.';
    frameId=requestAnimationFrame(detectLoop);
    try{if(navigator.wakeLock)lock=await navigator.wakeLock.request('screen');}catch{/* optional */}
  } catch(err){
    console.error('Erro de câmera/detecção:',err);
    let errorText='Não foi possível iniciar a câmera. Verifique a permissão e a internet.';
    if(err?.name==='NotAllowedError'||err?.name==='PermissionDeniedError')errorText='Permissão negada. Libere a câmera nas configurações do navegador.';
    else if(err?.name==='NotFoundError')errorText='Nenhuma câmera disponível neste aparelho.';
    else if(err?.name==='NotReadableError')errorText='A câmera está sendo usada por outro aplicativo.';
    else if(String(err?.message||'').includes('fetch'))errorText='Falha ao carregar o modelo de IA. Confira a internet e tente de novo.';
    notify(errorText);
    stopCamera();
    statusText.textContent=errorText;
  } finally {isStarting=false;setButtons();}
}
function stopCamera(){
  isCapturing=false;ready=false;
  cancelAnimationFrame(frameId);
  cameraStream?.getTracks().forEach(track=>track.stop());
  cameraStream=null;video.srcObject=null;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  cameraPlaceholder.hidden=false;
  cameraPeople.hidden=true;
  camBadge.textContent='Inativa';camBadge.classList.remove('connected');
  statusText.textContent='Câmera parada. Toque em Ativar câmera para recomeçar.';
  sendStatus(0);
  try{lock?.release();}catch{/* optional */}lock=null;
  setButtons();
}
$('#camera-start').addEventListener('click',startCamera);
$('#camera-stop').addEventListener('click',stopCamera);
$('#camera-flip').addEventListener('click',async()=>{
  if(isStarting)return;
  face=face==='user'?'environment':'user';
  if(isCapturing){stopCamera();await startCamera();}
  else notify(face==='user'?'Câmera frontal selecionada.':'Câmera traseira selecionada.');
});

function valid(joint){return joint && Number.isFinite(joint.x) && Number.isFinite(joint.y) && (joint.visibility??1)>.32;}
function gestureFlags(p){
  const a=p[11],b=p[12],wl=p[15],wr=p[16],hipL=p[23],hipR=p[24],nose=p[0];
  if(![a,b,wl,wr,hipL,hipR,nose].every(valid))return {up:false,wide:false,head:false,down:false};
  const sy=(a.y+b.y)/2,hy=(hipL.y+hipR.y)/2;
  const shoulderWidth=Math.max(.09,Math.abs(a.x-b.x));
  const up=wl.y<sy-.055&&wr.y<sy-.055;
  const wide=Math.abs(wl.x-wr.x)>shoulderWidth*1.85 && Math.abs(wl.y-sy)<.21 && Math.abs(wr.y-sy)<.21;
  const head=Math.abs(wl.y-nose.y)<.17 && Math.abs(wr.y-nose.y)<.17 && Math.abs(wl.x-nose.x)<shoulderWidth*1.3 && Math.abs(wr.x-nose.x)<shoulderWidth*1.3;
  const down=wl.y>hy-.05 && wr.y>hy-.05;
  return {up,wide,head,down};
}
function trackedCenter(landmarks){
  const points=[11,12,23,24].map(i=>landmarks[i]).filter(valid);
  if(!points.length)return .5;
  return points.reduce((acc,p)=>acc+(face==='user'?1-p.x:p.x),0)/points.length;
}
function makePlayers(poses){
  const count=Number($('#phone-count').value)||2;
  const found=poses.map(p=>({p,center:trackedCenter(p)})).sort((a,b)=>a.center-b.center);
  return found.map((entry,i)=>{
    // Two children play on left/right sides. With only one detected, preserve their half.
    const slot=count===1?0:found.length===2?i:entry.center<.5?0:1;
    const joints=JOINTS.map(idx=>{
      const v=entry.p[idx];
      if(!v||!Number.isFinite(v.x)||!Number.isFinite(v.y))return null;
      return [idx,Math.round(clamp(face==='user'?1-v.x:v.x)*1000)/1000,Math.round(clamp(v.y)*1000)/1000,Math.round(clamp(v.visibility??1)*100)/100];
    }).filter(Boolean);
    return {slot,joints,gestures:gestureFlags(entry.p)};
  });
}
function drawSkeleton(poses){
  const w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);
  const entries=poses.map(p=>({p,center:trackedCenter(p)})).sort((a,b)=>a.center-b.center);
  for(let i=0;i<entries.length;i++){
    const p=entries[i].p;
    const slot=Number($('#phone-count').value)===1?0:entries.length===2?i:entries[i].center<.5?0:1;
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    ctx.strokeStyle=SIDE_COLORS[slot];ctx.lineWidth=Math.max(3,w/210);
    ctx.shadowColor=SIDE_COLORS[slot];ctx.shadowBlur=10;
    for(const [a,b] of LINES){
      if(!valid(p[a])||!valid(p[b]))continue;
      ctx.beginPath();ctx.moveTo(p[a].x*w,p[a].y*h);ctx.lineTo(p[b].x*w,p[b].y*h);ctx.stroke();
    }
    for(const id of [0,11,12,13,14,15,16,23,24]){
      if(!valid(p[id]))continue;
      ctx.beginPath();ctx.arc(p[id].x*w,p[id].y*h,id===15||id===16?Math.max(8,w/80):Math.max(3,w/180),0,Math.PI*2);
      ctx.fillStyle=id===15||id===16?'#ffefc9':SIDE_COLORS[slot];ctx.fill();
    }
    const label=p[0]||p[11];
    if(valid(label)){
      ctx.shadowBlur=0;
      ctx.font=`900 ${Math.max(15,w/38)}px system-ui`;ctx.textAlign='center';ctx.fillStyle=SIDE_COLORS[slot];
      ctx.fillText(`JOGADOR ${slot+1}`,label.x*w,Math.max(35,label.y*h-35));
    }
    ctx.restore();
  }
}
function detectLoop(now){
  if(!isCapturing||!cameraStream||!landmarker) return;
  frameId=requestAnimationFrame(detectLoop);
  if(now-lastFrameAt<90||video.readyState<2||video.currentTime===lastVideoTime)return;
  lastFrameAt=now;lastVideoTime=video.currentTime;
  try{
    const result=landmarker.detectForVideo(video,now);
    const landmarks=result.landmarks||[];
    drawSkeleton(landmarks);
    const players=makePlayers(landmarks);
    send({type:'pose',players});
    cameraPeople.textContent=`${players.length===0?'🔎':'✅'} ${players.length} / ${$('#phone-count').value} pessoa(s) reconhecida(s)`;
    if(now-lastStatusAt>2000){sendStatus(players.length);lastStatusAt=now;}
  }catch(err){
    console.warn('Falha ao processar quadro',err);
    statusText.textContent='Falha ao processar imagem. Tente trocar a câmera ou reativá-la.';
  }
}
$('#phone-game').addEventListener('change',(e)=>send({type:'command',action:'mode',value:e.target.value}));
$('#phone-count').addEventListener('change',(e)=>send({type:'command',action:'count',value:Number(e.target.value)}));
$('#phone-play').addEventListener('click',()=>send({type:'command',action:'start'}));
$('#phone-restart').addEventListener('click',()=>send({type:'command',action:'restart'}));
$('#phone-pause').addEventListener('click',()=>send({type:'command',action:gameState==='paused'?'resume':'pause'}));
window.addEventListener('pagehide',()=>{stopCamera();ws?.close();});
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&isCapturing&&navigator.wakeLock&&!lock)navigator.wakeLock.request('screen').then(l=>{lock=l;}).catch(()=>{});
});
setConnection(false);
