const form = document.getElementById('settings-form');
const status = document.getElementById('status');

function selectValue(id, value, label) {
  const select = document.getElementById(id);
  select.querySelectorAll('[data-current-option]').forEach((option) => option.remove());
  const stringValue = value === null ? '' : String(value);
  if (![...select.options].some((option) => option.value === stringValue)) {
    const option = new Option(label, stringValue);
    option.dataset.currentOption = 'true';
    select.add(option);
  }
  select.value = stringValue;
}

function renderSettings(settings) {
  selectValue('pet-size', settings.petSize, `${settings.petSize} px (current)`);
  selectValue('light-delay', settings.activity.lightAfterSeconds, `${settings.activity.lightAfterSeconds} seconds (current)`);
  selectValue('walk-delay', settings.activity.walkAfterSeconds, `${settings.activity.walkAfterSeconds} seconds (current)`);
  selectValue('sleep-delay', settings.activity.sleepAfterSeconds, `${settings.activity.sleepAfterSeconds} seconds (current)`);
  selectValue('blink-interval', settings.animation.blinkIntervalSeconds,
    `About every ${settings.animation.blinkIntervalSeconds} seconds (current)`);
  document.getElementById('startup-status').textContent =
    `Start with Windows: ${settings.startsWithWindows ? 'On' : 'Off'}. Change this in the cat's right-click menu.`;
}

window.settingsAPI.onChanged(renderSettings);
window.__settingsReady = window.settingsAPI.get().then((settings) => {
  renderSettings(settings);
  return true;
}).catch((error) => {
  status.textContent = `Could not load settings: ${error.message}`;
  throw error;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.classList.remove('success');
  const values = {
    petSize: Number(document.getElementById('pet-size').value),
    activity: {
      lightAfterSeconds: Number(document.getElementById('light-delay').value),
      walkAfterSeconds: Number(document.getElementById('walk-delay').value),
      sleepAfterSeconds: Number(document.getElementById('sleep-delay').value)
    },
    animation: {
      blinkIntervalSeconds: document.getElementById('blink-interval').value === ''
        ? null : Number(document.getElementById('blink-interval').value)
    }
  };
  if (values.activity.sleepAfterSeconds < values.activity.walkAfterSeconds + 30) {
    status.textContent = 'Sleep must begin at least 30 seconds after walking.';
    return;
  }
  try {
    await window.settingsAPI.save(values);
    status.textContent = 'Settings saved.';
    status.classList.add('success');
  } catch (error) {
    status.textContent = `Could not save settings: ${error.message}`;
  }
});

document.getElementById('close').addEventListener('click', () => window.settingsAPI.close());

document.getElementById('reset-defaults').addEventListener('click', async () => {
  try {
    const result = await window.settingsAPI.reset();
    if (!result.reset) return;
    renderSettings(result.settings);
    status.textContent = 'Default settings restored.';
    status.classList.add('success');
  } catch (error) {
    status.classList.remove('success');
    status.textContent = `Could not reset settings: ${error.message}`;
  }
});
