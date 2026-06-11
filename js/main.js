// main.js — boot: wires Menu ↔ Game and the static overlays.

let game = null;
let menu = null;
let lastOptions = null;

window.addEventListener('DOMContentLoaded', () => {
  const loading = document.getElementById('loading-screen');

  if (typeof THREE === 'undefined') {
    loading.innerHTML = '<div class="loading-text">Three.js 로드 실패 — js/lib/three.min.js 확인</div>';
    return;
  }

  try {
    game = new Game();
  } catch (err) {
    loading.innerHTML = `<div class="loading-text">WebGL을 사용할 수 없습니다<br>${err.message}</div>`;
    return;
  }

  menu = new Menu((options) => {
    lastOptions = options;
    game.load(LAS_VEGAS, options);
  });
  menu.show();

  loading.style.opacity = '0';
  setTimeout(() => { loading.style.display = 'none'; }, 600);

  // pause overlay
  document.getElementById('btn-resume').addEventListener('click', () => game.togglePause());
  document.getElementById('btn-pause-restart').addEventListener('click', () => {
    document.getElementById('pause-overlay').style.display = 'none';
    game.load(LAS_VEGAS, lastOptions);
  });
  document.getElementById('btn-pause-menu').addEventListener('click', () => {
    game.exitToMenu();
    menu.show();
  });

  // results overlay
  document.getElementById('btn-res-restart').addEventListener('click', () => {
    game.hud.hideResults();
    game.load(LAS_VEGAS, lastOptions);
  });
  document.getElementById('btn-res-menu').addEventListener('click', () => {
    game.exitToMenu();
    menu.show();
  });
});
