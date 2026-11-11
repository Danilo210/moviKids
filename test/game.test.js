import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionGame } from '../public/js/game.js';

globalThis.window = { devicePixelRatio: 1 };
globalThis.requestAnimationFrame = () => 1;
function fakeCanvas() {
  const noop=()=>{};
  const ctx = new Proxy({ setTransform:noop, createLinearGradient:()=>({addColorStop:noop}), createRadialGradient:()=>({addColorStop:noop}) }, {get:(obj,key)=>key in obj?obj[key]:noop,set:(obj,key,value)=>{obj[key]=value;return true;}});
  return {width:0,height:0,getContext:()=>ctx,getBoundingClientRect:()=>({width:1200,height:650})};
}
function newGame(){const events=[];const game=new MotionGame(fakeCanvas(),(k,v)=>events.push([k,v]));game.resize();return {game,events};}
function pose(slot, x, y, gestures = {}) {return {slot,joints:[[15,x,y,1],[16,x,y,1]],gestures};}

test('modo em dupla utiliza metade da tela por criança',()=>{
  const {game}=newGame();
  game.setPoseData([pose(0,.2,.5),pose(1,.7,.5)]);
  assert.ok(Math.abs(game.getPoint(0,15).x-.4)<.001);
  assert.ok(Math.abs(game.getPoint(1,15).x-.4)<.001);
});
test('pegar objetos com as mãos aumenta a pontuação de cada criança de forma independente',()=>{
  const {game}=newGame();
  game.start(); game.state='running';
  game.setPoseData([pose(0,.2,.5),pose(1,.7,.5)]);
  game.targets=[
    {player:0,x:.4,y:.5,speed:0,radius:36,points:1,phase:0,wobble:0},
    {player:1,x:.4,y:.5,speed:0,radius:36,points:3,phase:0,wobble:0},
  ];
  game.update(.02);
  assert.deepEqual(game.scores,[1,3]);
  assert.equal(game.targets.length,0);
});
test('desafio de pose pontua uma vez por pessoa em cada rodada',()=>{
  const {game}=newGame();
  game.setMode('danca');game.start();game.state='running';
  game.setPoseData([pose(0,.2,.5,{up:true}),pose(1,.7,.5,{up:false})]);
  game.update(.8);
  assert.deepEqual(game.scores,[10,0]);
  game.update(.1);
  assert.deepEqual(game.scores,[10,0]);
});
test('pausar congela o cronômetro',()=>{
  const {game}=newGame();game.start();game.state='running';
  game.pause();game.update(.04);
  assert.equal(game.left,60);
  game.resume();game.update(.04);
  assert.ok(game.left<60);
});
test('modo individual usa o quadro inteiro da câmera',()=>{
  const {game}=newGame();game.setCount(1);
  game.setPoseData([pose(0,.83,.52)]);
  assert.ok(Math.abs(game.getPoint(0,15).x-.83)<.001);
});
