export const $ = (sel) => document.querySelector(sel);
export const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
export function websocketUrl() { return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`; }
export const labels = { bolhas: 'BOLHAS MÁGICAS', estrelas: 'CAÇA-ESTRELAS', danca: 'DANÇA DAS POSES' };
export function toast(element, text, time = 3400) {
  element.textContent = text;
  element.classList.add('show');
  clearTimeout(element.toastTimer);
  element.toastTimer = setTimeout(() => element.classList.remove('show'), time);
}
