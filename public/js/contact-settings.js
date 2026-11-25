
(() => {
  'use strict';

  const headerActions = document.querySelector('.header-actions');

  const whatsappLinks = headerActions
    ? headerActions.querySelectorAll('a.whatsapp')
    : [];

  const facebookLinks = headerActions
    ? headerActions.querySelectorAll('a.facebook')
    : [];

  const instagramLinks = headerActions
    ? headerActions.querySelectorAll('a.instagram')
    : [];

  const mapButton = document.getElementById('mapLinkBtn');

  function disableLink(link) {
    if (!link) return;

    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
    link.setAttribute('tabindex', '-1');
  }

  function enableLink(link, url) {
    if (!link || !url) return;

    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.removeAttribute('aria-disabled');
    link.removeAttribute('tabindex');
  }

  function getSafeHttpsUrl(value) {
    const input = String(value || '').trim();

    if (!input) return '';

    try {
      const url = new URL(input);

      if (url.protocol !== 'https:') return '';

      return url.href;
    } catch {
      return '';
    }
  }

  async function loadContactSettings() {
    whatsappLinks.forEach(disableLink);
    facebookLinks.forEach(disableLink);
    instagramLinks.forEach(disableLink);
    disableLink(mapButton);

    try {
      const response = await fetch('/api/settings', {
        cache: 'no-store'
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        console.error(
          'تعذر تحميل إعدادات التواصل:',
          data.error || response.status
        );
        return;
      }

      const settings = data.settings || {};

      const whatsappNumber = String(settings.whatsapp_number || '')
        .replace(/\D/g, '');

      const whatsappUrl = whatsappNumber
        ? `https://wa.me/${whatsappNumber}`
        : '';

      const facebookUrl = getSafeHttpsUrl(settings.facebook_url);
      const instagramUrl = getSafeHttpsUrl(settings.instagram_url);
      const mapUrl = getSafeHttpsUrl(settings.google_maps_url);

      if (whatsappUrl) {
        whatsappLinks.forEach(link => {
          enableLink(link, whatsappUrl);
        });
      }

      if (facebookUrl) {
        facebookLinks.forEach(link => {
          enableLink(link, facebookUrl);
        });
      }

      if (instagramUrl) {
        instagramLinks.forEach(link => {
          enableLink(link, instagramUrl);
        });
      }

      if (mapUrl) {
        enableLink(mapButton, mapUrl);
      }

    } catch (error) {
      console.error('تعذر تحميل إعدادات التواصل:', error);
    }
  }

  loadContactSettings();
})();
