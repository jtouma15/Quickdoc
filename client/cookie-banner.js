(function(){
  'use strict';

  const COOKIE_KEY_BASE = 'qd_cookie_accept';
  const API_ENDPOINT = '/api/server-info';
  const HIDE_DELAY = 300;

  function createBanner(){
    let banner = document.getElementById('cookieBanner');
    if (banner) return banner;

    banner = document.createElement('div');
    banner.id = 'cookieBanner';
    banner.className = 'cookie-banner-backdrop';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-modal', 'true');
    banner.hidden = true;
    banner.innerHTML = `
      <div class="cookie-banner" role="document">
        <div class="cookie-banner__inner">
          <p class="cookie-banner__text">
            Wir verwenden Cookies für grundlegende Funktionen dieser Demo. Weitere Infos findest du in unserer
            <a href="/img/Datenschutz+.pdf" target="_blank" rel="noopener">Datenschutzerklärung</a>.
          </p>
          <button type="button" class="btn btn-primary btn-sm cookie-banner__accept">Einverstanden</button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);
    return banner;
  }

  function hideBanner(banner){
    banner.classList.remove('cookie-banner--visible');
    banner.classList.add('cookie-banner--hide');
    setTimeout(()=> banner.remove(), HIDE_DELAY);
  }

  async function fetchBootId(){
    try{
      const res = await fetch(API_ENDPOINT, { cache: 'no-store' });
      if (!res.ok) throw new Error('bad status');
      const data = await res.json();
      return data?.bootId ? String(data.bootId) : null;
    } catch {
      return null;
    }
  }

  function cleanupOldKeys(keepKey){
    try{
      for (let i = localStorage.length - 1; i >= 0; i--){
        const key = localStorage.key(i);
        if (key && key.startsWith(`${COOKIE_KEY_BASE}:`) && key !== keepKey){
          localStorage.removeItem(key);
        }
      }
    } catch {}
  }

  function init(){
    const banner = createBanner();
    if (!banner) return;

    const button = banner.querySelector('.cookie-banner__accept');
    if (!button) return;

    (async ()=>{
      const bootId = await fetchBootId();
      const storageKey = bootId ? `${COOKIE_KEY_BASE}:${bootId}` : COOKIE_KEY_BASE;

      if (bootId) cleanupOldKeys(storageKey);

      let accepted = false;
      try{
        accepted = localStorage.getItem(storageKey) === '1';
      } catch {}

      if (accepted){
        banner.remove();
        return;
      }

      banner.hidden = false;
      requestAnimationFrame(()=>{
        banner.classList.add('cookie-banner--visible');
        try {
          button.focus({ preventScroll: true });
        } catch {
          button.focus();
        }
      });

      button.addEventListener('click', ()=>{
        try{
          localStorage.setItem(storageKey, '1');
        } catch {}
        hideBanner(banner);
      }, { once: true });
    })();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
