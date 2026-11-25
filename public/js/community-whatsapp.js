
(() => {
  'use strict';

  async function loadCommunityWhatsapp() {
    try {
      const response = await fetch('/api/settings', {
        cache: 'no-store'
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        console.error(
          'تعذر تحميل إعدادات مجتمع واتساب:',
          data.error || response.status
        );
        return;
      }

      const settings = data.settings || {};

      // لا تعرض الزر إذا كانت الخدمة معطّلة
      if (String(settings.community_whatsapp_enabled || '0') !== '1') {
        return;
      }

      const communityUrl = String(
        settings.community_whatsapp_url || ''
      ).trim();

      // التحقق من رابط دعوة المجتمع
      let validUrl;

      try {
        validUrl = new URL(communityUrl);

        if (
          validUrl.protocol !== 'https:' ||
          validUrl.hostname !== 'chat.whatsapp.com'
        ) {
          return;
        }
      } catch (error) {
        return;
      }

      // منع إنشاء الزر أكثر من مرة
      if (document.querySelector('.floating-whatsapp')) {
        return;
      }

      const button = document.createElement('a');

      button.className = 'floating-whatsapp';
      button.href = validUrl.href;
      button.target = '_blank';
      button.rel = 'noopener noreferrer';
      const tooltipText = String(
        settings.community_whatsapp_tooltip ||
        'انضم إلى مجتمع السعدني على واتساب'
      ).trim();

      button.setAttribute('aria-label', tooltipText);

      button.innerHTML = `
        <svg
          viewBox="0 0 32 32"
          width="32"
          height="32"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M16.04 2.003C8.33 2.003 2.06 8.273 2.06 15.983c0 2.46.65 4.86 1.89 6.97L2 30l7.22-1.89a13.94 13.94 0 0 0 6.82 1.78h.01c7.71 0 13.98-6.27 13.98-13.98 0-3.74-1.46-7.25-4.1-9.89a13.9 13.9 0 0 0-9.89-4.01zm0 25.52h-.01a11.6 11.6 0 0 1-5.91-1.62l-.42-.25-4.29 1.12 1.15-4.18-.27-.43a11.6 11.6 0 0 1-1.78-6.18c0-6.39 5.2-11.59 11.6-11.59 3.1 0 6.02 1.21 8.21 3.4a11.53 11.53 0 0 1 3.4 8.21c0 6.39-5.2 11.59-11.59 11.59zm6.36-8.68c-.35-.18-2.08-1.03-2.4-1.15-.32-.12-.55-.18-.78.18-.23.35-.9 1.15-1.1 1.39-.2.23-.4.26-.75.09-.35-.18-1.48-.55-2.82-1.75-1.04-.93-1.75-2.08-1.95-2.43-.2-.35-.02-.54.15-.71.16-.15.35-.4.53-.6.18-.2.23-.35.35-.58.12-.23.06-.44-.03-.62-.09-.18-.78-1.88-1.07-2.57-.28-.67-.56-.58-.78-.59h-.67c-.23 0-.61.09-.93.44-.32.35-1.22 1.19-1.22 2.89s1.25 3.35 1.42 3.58c.18.23 2.45 3.74 5.93 5.25.83.36 1.47.58 1.97.74.83.26 1.59.22 2.19.13.67-.1 2.08-.85 2.37-1.67.29-.82.29-1.52.2-1.67-.09-.15-.32-.23-.67-.41z"/>
        </svg>
        <span class="wa-tooltip"></span>
      `;

      const tooltip = button.querySelector('.wa-tooltip');

      tooltip.textContent = tooltipText;

      document.body.appendChild(button);

    } catch (error) {
      console.error('حدث خطأ أثناء تحميل زر مجتمع واتساب:', error);
    }
  }

  loadCommunityWhatsapp();
})();
