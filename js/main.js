// main.js - Entry point

let game = null;
let menu = null;

window.addEventListener('DOMContentLoaded', () => {
  // Pre-warm Three.js renderer with loading screen
  showLoading();

  setTimeout(() => {
    game = new Game();
    game.start();

    menu = new Menu((options) => {
      startRace(options);
    });
    menu.show();

    hideLoading();
  }, 300);
});

function startRace(options) {
  document.getElementById('race-overlay').style.display = 'block';
  document.getElementById('pause-overlay').style.display = 'none';
  document.getElementById('race-finish-overlay').style.display = 'none';

  game.load(LAS_VEGAS, options);
}

function showLoading() {
  const el = document.getElementById('loading-screen');
  if (el) el.style.display = 'flex';
}

function hideLoading() {
  const el = document.getElementById('loading-screen');
  if (el) el.style.opacity = '0';
  setTimeout(() => { if (el) el.style.display = 'none'; }, 500);
}

// Pause overlay buttons
document.addEventListener('DOMContentLoaded', () => {
  const resumeBtn = document.getElementById('btn-resume');
  if (resumeBtn) resumeBtn.addEventListener('click', () => game.resume());

  const mainMenuBtn = document.getElementById('btn-main-menu');
  if (mainMenuBtn) mainMenuBtn.addEventListener('click', () => {
    document.getElementById('pause-overlay').style.display = 'none';
    document.getElementById('race-overlay').style.display = 'none';
    if (game.hud) game.hud.hide();
    game.state = 'idle';
    menu.show();
  });

  const finishMenuBtn = document.getElementById('btn-finish-menu');
  if (finishMenuBtn) finishMenuBtn.addEventListener('click', () => {
    document.getElementById('race-finish-overlay').style.display = 'none';
    document.getElementById('race-overlay').style.display = 'none';
    if (game.hud) game.hud.hide();
    game.state = 'idle';
    menu.show();
  });

  const finishRestartBtn = document.getElementById('btn-finish-restart');
  if (finishRestartBtn) finishRestartBtn.addEventListener('click', () => {
    document.getElementById('race-finish-overlay').style.display = 'none';
    startRace({ livery: menu.selectedLivery, tire: menu.selectedTire, laps: menu.selectedLaps });
  });
});
