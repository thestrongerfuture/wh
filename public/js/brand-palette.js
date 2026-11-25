const DYNAMIC_PALETTE_VARS = [
  '--primary',
  '--primary-dark',
  '--primary-light',
  '--secondary',
  '--secondary-dark',
  '--accent',
  '--accent-dark',
  '--background',
  '--surface',
  '--text',
  '--bg',
  '--card-bg',
  '--border'
];

function clearDynamicPalette() {
  const rootStyle = document.documentElement.style;
  DYNAMIC_PALETTE_VARS.forEach(varName => rootStyle.removeProperty(varName));
}

function applyDynamicPalette(palette) {
  if (!palette || typeof palette !== 'object') {
    clearDynamicPalette();
    return;
  }

  const hexRegex = /^#[0-9A-Fa-f]{6}$/;
  if (!hexRegex.test(String(palette.primary || ''))) {
    clearDynamicPalette();
    return;
  }

  const rootStyle = document.documentElement.style;
  const primary = String(palette.primary).toUpperCase();
  rootStyle.setProperty('--primary', primary);
  rootStyle.setProperty('--primary-dark', primary);
  rootStyle.setProperty('--primary-light', primary);

  if (hexRegex.test(String(palette.secondary || ''))) {
    const secondary = String(palette.secondary).toUpperCase();
    rootStyle.setProperty('--secondary', secondary);
    rootStyle.setProperty('--border', secondary);
  }

  if (hexRegex.test(String(palette.accent || ''))) {
    const accent = String(palette.accent).toUpperCase();
    rootStyle.setProperty('--accent', accent);
  }

  if (hexRegex.test(String(palette.background || ''))) {
    const background = String(palette.background).toUpperCase();
    rootStyle.setProperty('--background', background);
    rootStyle.setProperty('--bg', background);
  }

  if (hexRegex.test(String(palette.surface || ''))) {
    const surface = String(palette.surface).toUpperCase();
    rootStyle.setProperty('--surface', surface);
    rootStyle.setProperty('--card-bg', surface);
  }

  rootStyle.setProperty('--text', '#000000');
}

async function loadStoreBrandPalette() {
  try {
    const response = await fetch('/api/settings', { cache: 'no-store' });

    if (!response.ok) {
      throw new Error('تعذر تحميل إعدادات المتجر');
    }

    const data = await response.json();

    if (!data || data.ok !== true || !data.settings) {
      throw new Error('استجابة إعدادات المتجر غير صالحة');
    }

    const settings = data.settings;
    const isPaletteActive = String(settings.store_brand_palette_active || '0') === '1';
    let parsedPalette = null;

    if (isPaletteActive && settings.store_brand_palette) {
      parsedPalette = typeof settings.store_brand_palette === 'string'
        ? JSON.parse(settings.store_brand_palette)
        : settings.store_brand_palette;
    }

    if (isPaletteActive && parsedPalette) {
      applyDynamicPalette(parsedPalette);
    } else {
      clearDynamicPalette();
    }
  } catch (error) {
    console.error('تعذر تحميل هوية المتجر اللونية:', error);
    clearDynamicPalette();
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    loadStoreBrandPalette();
  }
});

window.addEventListener('focus', () => {
  loadStoreBrandPalette();
});

loadStoreBrandPalette();