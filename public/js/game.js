import { clamp, labels } from './common.js';

const COLORS = ['#ff86b8', '#74d9ff'];
const LINKS = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[24,26]];
const DANCE = [
  { key: 'up', text: 'Levante os dois braços!', icon: '🙌' },
  { key: 'wide', text: 'Abra os braços!', icon: '🪽' },
  { key: 'head', text: 'Mãos perto da cabeça!', icon: '🤗' },
  { key: 'down', text: 'Mãos para baixo!', icon: '🧍' },
];

export class MotionGame {
  constructor(canvas, onEvent = () => {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onEvent = onEvent;
    this.mode = 'bolhas';
    this.count = 2;
    this.state = 'lobby';
    this.duration = 60;
    this.left = this.duration;
    this.scores = [0, 0];
    this.poses = [null, null];
    this.poseTimes = [0, 0];
    this.targets = [];
    this.effects = [];
    this.spawnClock = 0;
    this.danceIndex = 0;
    this.danceClock = 0;
    this.danceCompleted = [false, false];
    this.danceStep = DANCE[0];
    this.audioEnabled = true;
    this.audioCtx = null;
    this.lastFrame = 0;
    this.stars = Array.from({length: 65}, (_, i) => ({ x: ((i * 197 + 51) % 997) / 997, y: ((i * 467 + 71) % 991) / 991, r: 0.8 + (i % 3) * 0.6 }));
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.floor(width*dpr) || this.canvas.height !== Math.floor(height*dpr)) {
      this.canvas.width = Math.floor(width*dpr);
      this.canvas.height = Math.floor(height*dpr);
    }
    this.width = width; this.height = height;
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  setMode(mode) {
    if (!labels[mode]) return;
    this.mode = mode;
    if (this.state !== 'lobby') this.reset();
    this.onEvent('mode', mode);
  }
  setCount(n) {
    if (![1,2].includes(Number(n))) return;
    this.count = Number(n);
    if (this.state !== 'lobby') this.reset();
    this.onEvent('count', this.count);
  }
  setPoseData(players) {
    const now = performance.now();
    if (!Array.isArray(players)) return;
    for (const p of players) {
      if (!p || !Number.isInteger(p.slot) || p.slot < 0 || p.slot > 1 || !Array.isArray(p.joints)) continue;
      this.poses[p.slot] = p;
      this.poseTimes[p.slot] = now;
    }
    this.onEvent('seen', [0,1].map((i) => now - this.poseTimes[i] < 1500));
  }
  getPose(i) { return performance.now() - this.poseTimes[i] < 1400 ? this.poses[i] : null; }
  reset() {
    this.scores = [0,0]; this.left = this.duration;
    this.state = 'lobby'; this.targets = []; this.effects = []; this.spawnClock = 0;
    this.danceClock = 0; this.danceIndex = 0; this.danceCompleted = [false,false]; this.danceStep = DANCE[0];
    this.onEvent('score', this.scores);
    this.onEvent('clock', this.left);
    this.onEvent('state', this.state);
  }
  start() {
    this.scores = [0,0]; this.left = this.duration;
    this.targets = []; this.effects = []; this.spawnClock = 0;
    this.danceClock = 0; this.danceIndex = 0; this.danceCompleted = [false,false]; this.danceStep = DANCE[0];
    this.countdown = 3.25;
    this.state = 'countdown';
    this.onEvent('score', this.scores); this.onEvent('clock', this.left); this.onEvent('state', this.state);
    this.onEvent('dance', { ...this.danceStep, seconds: 6, visible: this.mode === 'danca' });
    this.playSound(480, 0.09, 0.08);
  }
  pause() {
    if (this.state !== 'running' && this.state !== 'countdown') return;
    this.previousState = this.state;
    this.state = 'paused'; this.onEvent('state', this.state);
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = this.previousState || 'running'; this.onEvent('state', this.state);
  }
  playSound(frequency = 650, duration = 0.09, volume = 0.08) {
    if (!this.audioEnabled) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.audioCtx ||= new AC();
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(() => {});
      const o = this.audioCtx.createOscillator();
      const g = this.audioCtx.createGain();
      const t = this.audioCtx.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(frequency,t); o.frequency.exponentialRampToValueAtTime(frequency*1.3,t+duration);
      g.gain.setValueAtTime(volume,t); g.gain.exponentialRampToValueAtTime(.001,t+duration);
      o.connect(g);g.connect(this.audioCtx.destination);o.start(t);o.stop(t+duration);
    } catch { /* sound is optional */ }
  }
  addPoints(player, points, x, y) {
    this.scores[player] += points;
    this.onEvent('score', this.scores);
    this.effects.push({player,x,y,t:1.1,points});
    this.playSound(points > 1 ? 870 : 620, 0.11, 0.075);
  }
  getPoint(player, index) {
    const pose = this.getPose(player);
    const joint = pose?.joints?.find(p => Array.isArray(p) && p[0] === index);
    if (!joint || joint.length < 4 || Number(joint[3]) < .32 || !Number.isFinite(joint[1]) || !Number.isFinite(joint[2])) return null;
    const x = clamp(joint[1]);
    const localX = this.count === 1 ? x : clamp((x - player * .5) * 2);
    return {x:localX, y:clamp(joint[2])};
  }
  playerHands(player) { return [this.getPoint(player, 15), this.getPoint(player, 16)].filter(Boolean); }
  spawn() {
    for (let player=0;player<this.count;player++) {
      const special = Math.random();
      this.targets.push({
        player, x:0.12+Math.random()*.76,
        y:this.mode==='bolhas' ? 1.13 : -.13,
        speed:(.093+Math.random()*.105) * (this.mode==='bolhas' ? -1 : 1),
        radius:24+Math.random()*13,
        special:special>.90,
        phase:Math.random()*Math.PI*2,
        wobble:.015 + Math.random()*.015,
        points:special>.90 ? 3 : 1,
      });
    }
  }
  update(dt) {
    for (const fx of this.effects) fx.t-=dt;
    this.effects = this.effects.filter(f=>f.t>0);
    if (this.state === 'countdown') {
      this.countdown-=dt;
      if (this.countdown<=0) { this.state='running';this.onEvent('state',this.state);this.playSound(920, .2, .13); }
      return;
    }
    if (this.state !== 'running') return;
    this.left = Math.max(0,this.left-dt);
    this.onEvent('clock',this.left);
    if (this.left<=0) {
      this.state='ended';this.onEvent('state',this.state);
      this.playSound(510,.3,.1);
      return;
    }
    if (this.mode==='danca') {
      this.danceClock+=dt;
      if (this.danceClock >= 6) {
        this.danceClock-=6;
        this.danceIndex=(this.danceIndex+1)%DANCE.length;
        this.danceStep=DANCE[this.danceIndex];
        this.danceCompleted=[false,false];
      }
      this.onEvent('dance',{...this.danceStep, seconds: Math.ceil(6-this.danceClock), completed:this.danceCompleted, visible:true});
      for (let player=0; player<this.count;player++) {
        const pose = this.getPose(player);
        if (this.danceClock>.65 && !this.danceCompleted[player] && pose?.gestures?.[this.danceStep.key] === true) {
          this.danceCompleted[player]=true;
          this.addPoints(player,10,.5,.5);
        }
      }
      return;
    }
    this.spawnClock+=dt;
    if (this.spawnClock>.75) {this.spawnClock=0;this.spawn();}
    const halfW=this.width/this.count;
    for (const target of this.targets) {
      target.phase+=dt*2;
      target.y+=target.speed*dt;
      target.x=clamp(target.x+Math.sin(target.phase)*target.wobble*dt,.09,.91);
      for (const hand of this.playerHands(target.player)) {
        const dx=(hand.x-target.x)*halfW;
        const dy=(hand.y-target.y)*this.height;
        const hitRadius=target.radius+Math.min(28,this.width/40);
        if (dx*dx+dy*dy < hitRadius*hitRadius) {
          this.addPoints(target.player,target.points,target.x,target.y);
          target.hit=true; break;
        }
      }
    }
    this.targets=this.targets.filter(t=>!t.hit && t.y>-.22 && t.y<1.24).slice(-100);
  }
  pointScreen(player, x, y) {
    return {x: player*(this.width/this.count) + x*(this.width/this.count), y:y*this.height};
  }
  roundedRect(x,y,w,h,r,fill) {
    const ctx=this.ctx;const q=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+q,y);ctx.lineTo(x+w-q,y);ctx.quadraticCurveTo(x+w,y,x+w,y+q);ctx.lineTo(x+w,y+h-q);ctx.quadraticCurveTo(x+w,y+h,x+w-q,y+h);ctx.lineTo(x+q,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-q);ctx.lineTo(x,y+q);ctx.quadraticCurveTo(x,y,x+q,y);ctx.closePath();ctx.fillStyle=fill;ctx.fill();
  }
  drawBackground(now) {
    const ctx=this.ctx,w=this.width,h=this.height;
    const g=ctx.createLinearGradient(0,0,w,h);
    g.addColorStop(0,'#342d75');g.addColorStop(.5,'#1b3a70');g.addColorStop(1,'#202d60');
    ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    // Slowly drifting misty shapes and decorative stars.
    for (let i=0;i<4;i++) {
      const x=w*(i*.38+Math.sin(now*.00017+i)*.12),y=h*(.26+(i%3)*.22);
      const rg=ctx.createRadialGradient(x,y,1,x,y,w*.28);
      rg.addColorStop(0,i%2?'#ff70b019':'#79f5ff17');rg.addColorStop(1,'#ffffff00');
      ctx.fillStyle=rg;ctx.fillRect(0,0,w,h);
    }
    for (const s of this.stars) {
      const a=.45+.4*Math.sin(now*.0015+s.x*16);
      ctx.globalAlpha=a;ctx.fillStyle='#d8e2ff';ctx.beginPath();ctx.arc(s.x*w,s.y*h,s.r,0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=1;
    // gentle hills under the game
    for(let k=0;k<2;k++){
      ctx.beginPath();ctx.moveTo(0,h);ctx.lineTo(0,h*(k?.94:.88));
      ctx.quadraticCurveTo(w*.3,h*(k?.83:.69),w*.63,h*(k?.94:.86));
      ctx.quadraticCurveTo(w*.89,h*(k?.86:.77),w,h*(k?.92:.89));
      ctx.lineTo(w,h);ctx.closePath();ctx.fillStyle=k?'#233c62b8':'#2c547a88';ctx.fill();
    }
    if(this.count===2){
      ctx.beginPath();ctx.setLineDash([7,11]);ctx.strokeStyle='#ffffff44';ctx.lineWidth=2;ctx.moveTo(w/2,h*.18);ctx.lineTo(w/2,h);ctx.stroke();ctx.setLineDash([]);
    }
  }
  drawTargets(now) {
    const ctx=this.ctx;
    for(const t of this.targets){
      const p=this.pointScreen(t.player,t.x,t.y),r=t.radius*Math.max(.67,Math.min(1.2,this.width/1000));
      ctx.save();ctx.translate(p.x,p.y);
      if(this.mode==='bolhas') {
        ctx.shadowBlur=22;ctx.shadowColor=t.special?'#ffdd65':'#96edff';
        const grad=ctx.createRadialGradient(-r*.3,-r*.4,0,0,0,r);
        grad.addColorStop(0,'#fdf9ffbb');grad.addColorStop(.45,t.special?'#ffe66c88':'#a9a4ff69');grad.addColorStop(1,t.special?'#ffe577bb':'#8aedff99');
        ctx.fillStyle=grad;ctx.strokeStyle=t.special?'#ffe278':'#aaebfa';ctx.lineWidth=3;
        ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.beginPath();ctx.ellipse(-r*.3,-r*.34,r*.21,r*.1,-.6,0,Math.PI*2);ctx.fillStyle='#ffffffb5';ctx.fill();
        if(t.special){ctx.font=`${r}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('★',0,2);}
      } else {
        const spin=now*.0017+t.phase;
        ctx.rotate(Math.sin(spin)*.2);ctx.shadowBlur=28;ctx.shadowColor=t.special?'#ff7ed6':'#ffe26f';
        this.starPath(0,0,r,r*.48,5);ctx.fillStyle=t.special?'#ff95d4':'#ffe17d';ctx.strokeStyle='#fff5cc';ctx.lineWidth=2;ctx.fill();ctx.stroke();
        ctx.shadowBlur=0;ctx.fillStyle='#fff7db';ctx.beginPath();ctx.arc(-r*.16,-r*.13,r*.12,0,Math.PI*2);ctx.fill();
      }
      ctx.restore();
    }
  }
  starPath(cx,cy,outer,inner,n){
    const ctx=this.ctx;ctx.beginPath();
    for(let i=0;i<n*2;i++){
      const a=i*Math.PI/n-Math.PI/2;const r=i%2?inner:outer;
      if(i===0)ctx.moveTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);
      else ctx.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);
    }ctx.closePath();
  }
  drawPoses(now) {
    const ctx=this.ctx;
    for(let slot=0;slot<this.count;slot++){
      const pose=this.getPose(slot); if(!pose)continue;
      const jointMap = new Map(pose.joints.filter(j=>Array.isArray(j)&&j.length>=4).map(j=>[j[0],j]));
      const toXY=(idx)=>{const j=jointMap.get(idx);if(!j||j[3]<.30||!Number.isFinite(j[1])||!Number.isFinite(j[2]))return null;return this.pointScreen(slot,this.count===1?clamp(j[1]):clamp((j[1]-slot*.5)*2),clamp(j[2]));};
      ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor=COLORS[slot];ctx.shadowBlur=12;ctx.lineWidth=Math.max(4,Math.min(9,this.width/150));ctx.strokeStyle=COLORS[slot]+'b9';
      for(const [a,b] of LINKS){const x=toXY(a),y=toXY(b);if(!x||!y)continue;ctx.beginPath();ctx.moveTo(x.x,x.y);ctx.lineTo(y.x,y.y);ctx.stroke();}
      for(const id of [11,12,13,14,15,16,23,24]){
        const p=toXY(id);if(!p)continue;ctx.fillStyle=COLORS[slot];ctx.beginPath();ctx.arc(p.x,p.y,id>=15&&id<=16?Math.max(11,this.width/90):5,0,Math.PI*2);ctx.fill();
      }
      const face=toXY(0);
      if(face){ctx.beginPath();ctx.arc(face.x,face.y,Math.max(11,this.width/120),0,Math.PI*2);ctx.fillStyle='#ffe8d8';ctx.fill();}
      for(const hand of this.playerHands(slot)){
        const p=this.pointScreen(slot,hand.x,hand.y);
        ctx.beginPath();ctx.arc(p.x,p.y,Math.min(26,this.width/43)+Math.sin(now*.006)*2,0,Math.PI*2);
        ctx.lineWidth=3;ctx.strokeStyle='#ffffffcc';ctx.stroke();
      }
      ctx.restore();
    }
  }
  drawEffects(dt) {
    const ctx=this.ctx;
    for(const fx of this.effects){
      const p=this.pointScreen(fx.player,fx.x,fx.y-(1.1-fx.t)*.06);
      ctx.save();ctx.globalAlpha=clamp(fx.t/.8);
      ctx.textAlign='center';ctx.font=`900 ${fx.points===10?34:27}px Nunito,system-ui`;
      ctx.shadowColor='#0006';ctx.shadowBlur=6;ctx.fillStyle=fx.points===1?'#fff5b2':'#ffe074';ctx.fillText(`+${fx.points} ✨`,p.x,p.y);ctx.restore();
    }
  }
  drawDance() {
    const ctx=this.ctx;
    for(let p=0;p<this.count;p++){
      const left=p*this.width/this.count,half=this.width/this.count;
      this.roundedRect(left+half*.19,this.height*.72,half*.62,52,22,this.danceCompleted[p]?'#4ddb9f44':'#131e49aa');
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`900 ${Math.min(20,this.width/40)}px Nunito,system-ui`;
      ctx.fillStyle=this.danceCompleted[p]?'#9dffbd':'#d3e7ff';
      ctx.fillText(this.danceCompleted[p]?'✓ MUITO BEM! +10':'FAÇA O MOVIMENTO!',left+half/2,this.height*.72+26);
    }
  }
  drawCountdown() {
    const ctx=this.ctx;
    ctx.fillStyle='#0b143589';ctx.fillRect(0,0,this.width,this.height);
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor='#ffdb84';ctx.shadowBlur=35;
    ctx.font=`900 ${Math.min(156,this.height*.3)}px Nunito,system-ui`;ctx.fillStyle='#fff6d4';
    ctx.fillText(this.countdown>.8?Math.ceil(this.countdown-.2):'JÁ!',this.width/2,this.height/2);
    ctx.shadowBlur=0;ctx.font='900 21px Nunito,system-ui';ctx.fillText('PREPAREM AS MÃOS!',this.width/2,this.height*.67);
  }
  frame(now) {
    try {
      this.resize();
      const dt=Math.min(.05,Math.max(0,(now-(this.lastFrame||now))/1000));this.lastFrame=now;
      this.update(dt);
      this.drawBackground(now);
      if(this.mode!=='danca')this.drawTargets(now);
      this.drawPoses(now);
      if(this.mode==='danca'&&this.state!=='lobby')this.drawDance();
      this.drawEffects(dt);
      if(this.state==='countdown')this.drawCountdown();
    } catch(e) {console.error('Erro ao desenhar jogo',e);}
    requestAnimationFrame(this.frame);
  }
}
