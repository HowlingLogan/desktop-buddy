import { stepBallPhysics } from './ball-physics.js';

const ball = document.getElementById('ball');
window.__ballReady = (async () => {
  ball.src = await window.desktopBall.getImage();
  await ball.decode();
  return true;
})();
await window.__ballReady;

let pointerId = null;
let moveRequest = null;
let latestPoint = null;
let physics = null;
let physicsRequest = null;
let physicsLastNow = null;
let paused = false;

function stopPhysics() {
  cancelAnimationFrame(physicsRequest);
  physicsRequest = null;
  physicsLastNow = null;
  physics = null;
}

function tickPhysics(now) {
  if (!physics || paused) return;
  if (physicsLastNow === null) physicsLastNow = now;
  const dt = (now - physicsLastNow) / 1000;
  physicsLastNow = now;
  physics.state = stepBallPhysics(physics.state, dt, physics.workArea, physics.size, physics.config);
  window.desktopBall.physicsFrame(physics.state);
  if (physics.state.moving) physicsRequest = requestAnimationFrame(tickPhysics);
  else stopPhysics();
}

window.desktopBall.onPhysicsStart((options) => {
  stopPhysics();
  physics = {
    state: { x: options.bounds.x, y: options.bounds.y,
      velocityX: options.velocityX, velocityY: options.velocityY, moving: true },
    workArea: options.workArea,
    size: { width: options.bounds.width, height: options.bounds.height },
    config: options.config
  };
  if (!paused) physicsRequest = requestAnimationFrame(tickPhysics);
});
window.desktopBall.onPhysicsStop(stopPhysics);
window.desktopBall.onPausedChanged((value) => {
  paused = value.paused === true;
  if (paused) {
    cancelAnimationFrame(physicsRequest);
    physicsRequest = null;
    physicsLastNow = null;
    if (physics && value.bounds) {
      physics.state.x = value.bounds.x;
      physics.state.y = value.bounds.y;
    }
  } else if (physics && physicsRequest === null) {
    physicsRequest = requestAnimationFrame(tickPhysics);
  }
});
window.__ballPhysicsSnapshot = () => physics
  ? { ...physics.state, paused, running: physicsRequest !== null }
  : { moving: false, paused, running: false };

function release() {
  if (pointerId === null) return;
  if (moveRequest !== null) cancelAnimationFrame(moveRequest);
  moveRequest = null;
  if (latestPoint) window.desktopBall.move(latestPoint.x, latestPoint.y);
  if (ball.hasPointerCapture(pointerId)) ball.releasePointerCapture(pointerId);
  pointerId = null;
  latestPoint = null;
  ball.classList.remove('dragging');
  window.desktopBall.release();
}

ball.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || pointerId !== null) return;
  event.preventDefault();
  stopPhysics();
  pointerId = event.pointerId;
  ball.setPointerCapture(pointerId);
  ball.classList.add('dragging');
  window.desktopBall.grab(event.clientX, event.clientY);
});

ball.addEventListener('pointermove', (event) => {
  if (event.pointerId !== pointerId) return;
  latestPoint = { x: event.screenX, y: event.screenY };
  if (moveRequest !== null) return;
  moveRequest = requestAnimationFrame(() => {
    moveRequest = null;
    if (pointerId !== null && latestPoint) window.desktopBall.move(latestPoint.x, latestPoint.y);
  });
});

ball.addEventListener('pointerup', (event) => {
  if (event.pointerId === pointerId) release();
});
ball.addEventListener('pointercancel', (event) => {
  if (event.pointerId === pointerId) release();
});
window.addEventListener('blur', release);
window.desktopBall.onCancel(release);
