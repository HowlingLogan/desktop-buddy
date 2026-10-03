const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function stepBallPhysics(state, elapsedSeconds, workArea, size, config) {
  const dt = clamp(elapsedSeconds, 0, 0.05);
  const friction = config.ballFrictionPerSecond;
  const damping = Math.exp(-friction * dt);
  const travel = friction > 0 ? (1 - damping) / friction : dt;
  let x = state.x + state.velocityX * travel;
  let y = state.y + state.velocityY * travel;
  let velocityX = state.velocityX * damping;
  let velocityY = state.velocityY * damping;
  let bounceX = false;
  let bounceY = false;
  const minX = workArea.x;
  const maxX = Math.max(minX, workArea.x + workArea.width - size.width);
  const minY = workArea.y;
  const maxY = Math.max(minY, workArea.y + workArea.height - size.height);
  if (x <= minX && velocityX < 0 || x >= maxX && velocityX > 0) {
    x = clamp(x, minX, maxX);
    velocityX = -velocityX * config.ballBounceFactor;
    bounceX = true;
  }
  if (y <= minY && velocityY < 0 || y >= maxY && velocityY > 0) {
    y = clamp(y, minY, maxY);
    velocityY = -velocityY * config.ballBounceFactor;
    bounceY = true;
  }
  x = clamp(x, minX, maxX);
  y = clamp(y, minY, maxY);
  const moving = Math.hypot(velocityX, velocityY) >= config.ballStopSpeedPxPerSecond;
  return {
    x, y,
    velocityX: moving ? velocityX : 0,
    velocityY: moving ? velocityY : 0,
    moving, bounceX, bounceY
  };
}
