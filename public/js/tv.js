import { $, toast, websocketUrl, labels } from './common.js';
import { MotionGame } from './game.js';

const socketStatus = $('#tv-connection');
const connectionStatus = $('#pair-status');
const overlay = $('#game-overlay');
const title = $('#overlay-welcome h1');
const intro = $('#overlay-welcome p');
const startButton = $('#overlay-start');
const overlaySmall = $('#overlay-small');
const pairGrid = $('#pair-grid');
const tvToast = $('#tv-toast');
const gameLabel = $('#game-label');
let ws;
let phoneConnected = false;
let phoneReady = false;
let roomCode = null;
let reconnectTimer;
let cameraDetected = 0;

function wsSend(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function syncSettings() {
  wsSend({ type: 'settings', mode: game.mode, count: game.count, running: game.state === 'running', state: game.state });
}
function drawStatus() {
  const online = phoneConnected;
  socketStatus.classList.toggle('connected', online);
  socketStatus.textContent = online ? (phoneReady ? `● Câmera ativa · ${cameraDetected} pessoa(s)` : '● Celular conectado') : '○ Aguardando celular';
  connectionStatus.classList.toggle('online', online);
  connectionStatus.textContent = online ? (phoneReady ? '✓ Câmera pronta para jogar!' : '📱 Celular conectado · Ative a câmera') : '⌛ Aguardando conexão...';
  startButton.disabled = !online || !phoneReady;
  if (game.state === 'lobby') updateOverlay();
}
function updateOverlay() {
  const state = game.state;
  if (state === 'running' || state === 'countdown') { overlay.hidden = true; return; }
  overlay.hidden = false;
  pairGrid.hidden = state !== 'lobby';
  if (state === 'lobby') {
    title.textContent = phoneReady ? 'Tudo pronto para jogar!' : 'Prontos para brincar?';
    intro.textContent = phoneReady ? 'Fique de frente para a câmera e escolha a brincadeira abaixo.' : 'Conecte a câmera do celular à TV usando o código abaixo.';
    startButton.textContent = '▶ Começar a brincar';
    overlaySmall.textContent = phoneReady ? 'Faça movimentos amplos sem encostar na TV.' : 'Primeiro conecte o celular e ative a câmera.';
  } else if (state === 'paused') {
    title.textContent = '⏸ Uma pausa para respirar!';
    intro.textContent = `Pontos: ${game.scores[0]}${game.count === 2 ? ` e ${game.scores[1]}` : ''} · Tudo pronto para voltar?`;
    startButton.textContent = '▶ Continuar';
    overlaySmall.textContent = 'A brincadeira continua de onde parou.';
  } else {
    const points = game.scores[0] + (game.count === 2 ? game.scores[1] : 0);
    title.textContent = '🎉 Parabéns, pequenos atletas!';
    intro.textContent = `Vocês somaram ${points} pontos nesta rodada. Mandaram muito bem!`;
    startButton.textContent = '↻ Jogar de novo';
    overlaySmall.textContent = 'Escolha outro jogo ou tente novamente.';
  }
  startButton.disabled = !phoneConnected || !phoneReady;
}
function gameEvent(type, value) {
  if (type === 'score') {
    $('#score-0').textContent = value[0]; $('#score-1').textContent = value[1];
  } else if (type === 'clock') {
    const total = Math.ceil(value);
    $('#clock').textContent = `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
  } else if (type === 'seen') {
    [0,1].forEach(i => {
      const el = $(`#seen-${i}`);
      el.classList.toggle('present', !!value[i]);
      el.textContent = value[i] ? '●' : '○';
    });
  } else if (type === 'mode') {
    gameLabel.textContent = labels[value];
    document.querySelectorAll('[data-game]').forEach(btn => btn.classList.toggle('active',btn.dataset.game === value));
    $('#tv-instructions').textContent = value === 'danca' ? 'Copie a pose mostrada na TV para ganhar pontos!' : 'Use as mãos para alcançar os objetos na sua metade da tela.';
    $('#dance-callout').hidden = value !== 'danca' || game.state === 'lobby';
    syncSettings();
  } else if (type === 'count') {
    document.querySelectorAll('[data-count]').forEach(btn => btn.classList.toggle('active',Number(btn.dataset.count) === value));
    $('.player-two').hidden = value === 1;
    syncSettings();
  } else if (type === 'dance') {
    $('#dance-callout').hidden = !value.visible || game.state === 'lobby';
    if (!value.visible) return;
    $('#dance-icon').textContent = value.icon;
    $('#dance-text').textContent = value.text;
    $('#dance-count').textContent = value.seconds;
  } else if (type === 'state') {
    updateOverlay();
    $('#pause-btn').disabled = !phoneReady || !['running','countdown','paused'].includes(value);
    $('#restart-btn').disabled = !phoneReady || value === 'lobby';
    $('#pause-btn').textContent = value === 'paused' ? '▶ Continuar' : '⏸ Pausar';
    if (game.mode !== 'danca' || value === 'ended' || value === 'lobby' || value === 'paused') $('#dance-callout').hidden = true;
    syncSettings();
  }
}
const game = new MotionGame($('#game-canvas'), gameEvent);
gameEvent('score',[0,0]);
gameEvent('clock',60);

updateOverlay();

function connect() {
  clearTimeout(reconnectTimer);
  ws = new WebSocket(websocketUrl());
  ws.addEventListener('open', () => wsSend({type:'create_room'}));
  ws.addEventListener('message', (event) => {
    let msg; try {msg=JSON.parse(event.data);} catch{return;}
    if (msg.type === 'room_created') {
      roomCode = msg.code;
      $('#room-code').textContent = roomCode;
      $('#pair-qr').src = `/api/qr?codigo=${roomCode}`;
      drawStatus();
    } else if (msg.type === 'phone_connected') {
      phoneConnected = true;
      phoneReady = false;
      cameraDetected = 0;
      drawStatus();
      syncSettings();
      toast(tvToast, '📱 Celular conectado! Ative a câmera.');
    } else if (msg.type === 'phone_disconnected') {
      phoneConnected = false;phoneReady = false;cameraDetected = 0;
      game.poses = [null,null];game.poseTimes=[0,0];
      if (['running','countdown'].includes(game.state)) game.pause();
      drawStatus();toast(tvToast,'Conexão com celular perdida. Confira o celular.');
    } else if (msg.type === 'camera_status') {
      const wasReady = phoneReady;
      phoneReady = msg.ready;
      cameraDetected = msg.detected;
      if (!phoneReady && ['running','countdown'].includes(game.state)) game.pause();
      drawStatus();
      if (phoneReady && !wasReady) toast(tvToast,'✨ Câmera ligada. Prontos para brincar!');
    } else if (msg.type === 'pose_update') {
      if (!phoneReady) return;
      cameraDetected = msg.detected;
      game.setPoseData(msg.players);
      if (cameraDetected >= 0) socketStatus.textContent = `● Câmera ativa · ${cameraDetected} pessoa(s)`;
    } else if (msg.type === 'remote_command') {
      executeCommand(msg.action, msg.value);
    } else if (msg.type === 'session_expired') {
      toast(tvToast,'Sessão expirada. Criando uma nova...');
    }
  });
  ws.addEventListener('close', () => {
    phoneConnected=false;phoneReady=false;roomCode=null;
    $('#room-code').textContent='······';$('#pair-qr').removeAttribute('src');
    game.reset();drawStatus();
    reconnectTimer=setTimeout(connect,2200);
  });
  ws.addEventListener('error',()=>{ /* close event retries */ });
}
function executeCommand(action, value) {
  switch(action) {
    case 'mode': if(labels[value]) game.setMode(value);break;
    case 'count': if ([1,2].includes(Number(value)))game.setCount(Number(value));break;
    case 'start': if (!phoneReady) return toast(tvToast,'Ative a câmera no celular primeiro.'); game.start();break;
    case 'pause':game.pause();break;
    case 'resume': if (phoneReady) game.resume();break;
    case 'restart':if(phoneReady)game.start();break;
  }
}
startButton.addEventListener('click',() => {
  if (!phoneReady) return;
  if (game.state === 'paused') game.resume(); else game.start();
});
$('#pause-btn').addEventListener('click',() => game.state==='paused' ? game.resume() : game.pause());
$('#restart-btn').addEventListener('click',() => executeCommand('restart'));
document.querySelectorAll('[data-game]').forEach(b=>b.addEventListener('click',()=>game.setMode(b.dataset.game)));
document.querySelectorAll('[data-count]').forEach(b=>b.addEventListener('click',()=>game.setCount(Number(b.dataset.count))));
$('#sound-btn').addEventListener('click',() => {game.audioEnabled=!game.audioEnabled;$('#sound-btn').textContent=game.audioEnabled?'🔊':'🔇';});
$('#fullscreen-btn').addEventListener('click',() => {
  if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(()=>toast(tvToast,'Seu navegador não permite tela cheia.'));
});
connect();
