import { AnimationController } from './animation/controller.js';
import { AudioManager } from './audio.js';

window.__petReady = window.desktopBuddy.getInitialPet().then(async ({ pet, settings, desktop, systemIdle, smokeTest }) => {
  const art = document.getElementById('pet-art');
  const base = document.getElementById('pet-image');
  const overlay = document.getElementById('pet-overlay');
  const walkLayer = document.getElementById('walk-frames');
  const reactionLayer = document.getElementById('reaction-frames');
  const playLayer = document.getElementById('play-frames');
  const jumpLayer = document.getElementById('jump-frames');
  const ball = document.getElementById('yarn-ball');
  const effectLayer = document.getElementById('effect-layer');
  base.alt = pet.name;
  const applyLayout = (current) => {
    const { top, right, bottom, left } = current.windowPadding;
    art.style.left = `${left}px`;
    art.style.top = `${top}px`;
    art.style.width = `min(${current.petSize}px, calc(100% - ${left + right}px))`;
    art.style.height = `min(${current.petSize}px, calc(100% - ${top + bottom}px))`;
    effectLayer.style.left = `${left + current.petSize * 0.55}px`;
    effectLayer.style.top = `${Math.max(0, top - 24)}px`;
  };
  applyLayout(settings);
  const audio = new AudioManager(settings.muted);

  const controller = new AnimationController(
    pet,
    { art, base, overlay, walkLayer, reactionLayer, playLayer, jumpLayer, ball, effectLayer },
    desktop,
    (x) => window.desktopBuddy.setHorizontalPosition(x),
    settings.activity,
    settings.animation,
    settings.play,
    {
      localFrame: (frame) => window.desktopBuddy.ballLocalFrame(frame),
      handoffReady: () => window.desktopBuddy.ballHandoffReady(),
      reattach: () => window.desktopBuddy.ballReattach(),
      moveExternal: (position) => window.desktopBuddy.moveExternalBall(position),
      hideWindow: () => window.desktopBuddy.hideBallWindow(),
      stopPhysics: () => window.desktopBuddy.stopBallPhysics(),
      setChasePosition: (x, y) => window.desktopBuddy.setChasePosition(x, y),
      getDesktop: () => window.desktopBuddy.getDesktop(),
      getBallState: () => window.desktopBuddy.getBallState()
    }
  );
  await controller.start();
  controller.handleSystemIdle(systemIdle);
  window.desktopBuddy.onSystemIdle((sample) => controller.handleSystemIdle(sample));
  window.desktopBuddy.onWorkAreaChanged((area) => controller.updateDesktop(area));
  window.desktopBuddy.onPausedChanged((paused) => controller.setPaused(paused));
  window.desktopBuddy.onResetPosition(() => controller.resetToIdle());
  window.desktopBuddy.onStartYarnPlay(() => controller.startYarnPlay());
  window.desktopBuddy.onBallGrabbed((info) => controller.onBallGrabbed(info));
  window.desktopBuddy.onBallReleased((info) => void controller.onBallReleased(info));
  window.desktopBuddy.onBallMotion((info) => controller.onBallMotion(info));
  window.desktopBuddy.onSettingsUpdated(({ settings: updated, desktop: area }) => {
    if (area) applyLayout(updated);
    audio.setMuted(updated.muted);
    controller.updateActivityConfig(updated.activity);
    controller.setBlinkIntervalSeconds(updated.animation.blinkIntervalSeconds);
    controller.updatePlayConfig(updated.play);
    controller.updateVisualBottomGap(updated.visualBottomGapPx);
    if (area) controller.updateDesktop(area);
  });
  window.addEventListener('resize', () => controller.alignFrames());

  let gesture = null;
  const finishGesture = async (shouldClick) => {
    if (!gesture) return;
    const finished = gesture;
    gesture = null;
    if (finished.moveRequest !== null) cancelAnimationFrame(finished.moveRequest);
    if (art.hasPointerCapture(finished.pointerId)) art.releasePointerCapture(finished.pointerId);
    if (finished.dragging) {
      window.desktopBuddy.moveDrag();
      try {
        const releasedDesktop = await window.desktopBuddy.endDrag();
        controller.endDrag(releasedDesktop);
      } catch (error) {
        console.error('Could not finish pet drag:', error);
      }
    } else if (shouldClick) {
      controller.triggerHappy();
    }
  };

  art.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || gesture) return;
    event.preventDefault();
    art.setPointerCapture(event.pointerId);
    gesture = {
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      anchorX: event.clientX,
      anchorY: event.clientY,
      dragging: false,
      moveRequest: null
    };
  });

  art.addEventListener('pointermove', (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.dragging) {
      const distance = Math.hypot(event.screenX - gesture.startScreenX, event.screenY - gesture.startScreenY);
      if (distance < 6) return;
      gesture.dragging = controller.beginDrag();
      if (!gesture.dragging) return;
      window.desktopBuddy.beginDrag(gesture.anchorX, gesture.anchorY);
    }
    if (gesture.moveRequest !== null) return;
    const activeGesture = gesture;
    gesture.moveRequest = requestAnimationFrame(() => {
      activeGesture.moveRequest = null;
      if (gesture === activeGesture && gesture.dragging) window.desktopBuddy.moveDrag();
    });
  });

  art.addEventListener('pointerup', (event) => {
    if (gesture?.pointerId === event.pointerId) void finishGesture(true);
  });
  art.addEventListener('pointercancel', (event) => {
    if (gesture?.pointerId === event.pointerId) void finishGesture(false);
  });
  art.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    window.desktopBuddy.showContextMenu();
  });
  window.addEventListener('blur', () => { if (gesture) void finishGesture(false); });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) controller.stop();
    else controller.resume();
  });

  if (smokeTest) {
    window.__petTest = {
      triggerBlink: () => controller.triggerBlink(),
      triggerHappy: () => controller.triggerHappy(),
      triggerWave: () => controller.triggerWave(),
      startYarnPlay: () => controller.startYarnPlay(),
      endYarnPlay: () => controller.endYarnPlay(),
      beginDrag: (x = 120, y = 150) => {
        const started = controller.beginDrag();
        if (started) window.desktopBuddy.beginDrag(x, y);
        return started;
      },
      endDrag: async () => {
        const releasedDesktop = await window.desktopBuddy.endDrag();
        controller.endDrag(releasedDesktop);
        return releasedDesktop;
      },
      setSystemIdle: (seconds, generation = 0) => controller.handleSystemIdle({ seconds, generation }),
      snapshot: () => ({ ...controller.snapshot, audioMuted: audio.muted, petSize: art.clientWidth })
    };
  }

  return {
    loaded: controller.snapshot.baseLoaded && controller.snapshot.overlayLoaded
      && controller.snapshot.walkFramesLoaded && controller.snapshot.reactionFramesLoaded
      && controller.snapshot.playFramesLoaded && controller.snapshot.jumpFramesLoaded
      && controller.snapshot.ballLoaded,
    width: base.naturalWidth,
    height: base.naturalHeight,
    state: controller.state
  };
}).catch((error) => {
  console.error('Could not display the pet:', error);
  throw error;
});
