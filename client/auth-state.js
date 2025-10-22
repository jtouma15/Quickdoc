(function(){
  'use strict';

  const AUTH_KEY = 'qd_auth_state';
  const PROFILE_PREFIX = 'qd_profile:';

  function safeParse(json){
    try { return JSON.parse(json || '') || null; }
    catch { return null; }
  }

  function normalizeEmail(email){
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
  }

  function getAuth(){
    return safeParse(localStorage.getItem(AUTH_KEY)) || { loggedIn:false };
  }

  function setAuth(state){
    if (!state || typeof state !== 'object') return;
    localStorage.setItem(AUTH_KEY, JSON.stringify(state));
    syncUI();
  }

  function clearAuth(){
    localStorage.removeItem(AUTH_KEY);
    syncUI();
  }

  function rememberProfile(email, profile){
    const key = PROFILE_PREFIX + normalizeEmail(email);
    if (!key.trim()) return;
    localStorage.setItem(key, JSON.stringify(profile));
  }

  function lookupProfile(email){
    const key = PROFILE_PREFIX + normalizeEmail(email);
    if (!key.trim()) return null;
    return safeParse(localStorage.getItem(key));
  }

  function extractFirstName(auth){
    if (!auth || !auth.loggedIn) return '';
    if (auth.name && typeof auth.name === 'string'){
      const trimmed = auth.name.trim();
      if (trimmed) return trimmed.split(/\s+/)[0];
    }
    if (auth.email){
      const profile = lookupProfile(auth.email);
      if (profile?.name){
        const trimmed = profile.name.trim();
        if (trimmed) return trimmed.split(/\s+/)[0];
      }
      const emailUser = String(auth.email).split('@')[0] || '';
      if (emailUser) return emailUser;
    }
    return '';
  }

  function pickLoginEl(){
    return document.getElementById('loginLink')
      || document.getElementById('loginIconLink')
      || document.getElementById('loginButton')
      || document.querySelector('.site-header__login a')
      || document.querySelector('a[href$=\"login.html\"]');
  }

  function pickLogoutEl(){
    return document.querySelector('[data-qd-logout]')
      || document.getElementById('logoutLink')
      || document.querySelector('a[data-logout]');
  }

  function ensureLogoutEl(loginEl){
    if (!loginEl || !loginEl.parentElement) return null;
    let logout = loginEl.parentElement.querySelector('[data-qd-logout]');
    if (logout) return logout;
    logout = document.createElement('a');
    logout.href = '#';
    logout.textContent = 'Logout';
    logout.dataset.qdLogout = 'true';
    logout.className = loginEl.className || 'btn btn-outline';
    if (!logout.style.marginLeft) logout.style.marginLeft = '8px';
    loginEl.parentElement.appendChild(logout);
    return logout;
  }

  function toggleHidden(el, shouldHide){
    if (!el) return;
    if (shouldHide){
      el.classList.add('hidden');
      el.setAttribute('hidden','');
    } else {
      el.classList.remove('hidden');
      el.removeAttribute('hidden');
    }
  }

  function syncUI(){
    const auth = getAuth();
    const loggedIn = !!auth.loggedIn;
    const firstName = extractFirstName(auth);

    document.querySelectorAll('[data-user-firstname]').forEach((node)=>{
      if (loggedIn && firstName){
        node.textContent = firstName;
        node.removeAttribute('hidden');
        node.classList.remove('hidden');
      } else {
        node.textContent = '';
        node.setAttribute('hidden','');
        node.classList.add('hidden');
      }
    });

    const loginEl = pickLoginEl();
    let logoutEl = pickLogoutEl();

    if (loggedIn){
      if (loginEl) toggleHidden(loginEl, true);
      if (!logoutEl) logoutEl = ensureLogoutEl(loginEl);
      if (logoutEl){
        toggleHidden(logoutEl, false);
        logoutEl.onclick = (ev)=>{
          ev.preventDefault();
          clearAuth();
        };
      }
    } else {
      if (logoutEl){
        logoutEl.onclick = null;
        toggleHidden(logoutEl, true);
      }
      if (loginEl) toggleHidden(loginEl, false);
    }
  }

  window.qdAuth = {
    getAuth,
    setAuth,
    clearAuth,
    syncUI,
    rememberProfile,
    lookupProfile
  };

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', syncUI);
  } else {
    syncUI();
  }

  window.addEventListener('storage', (event)=>{
    if (event.key && (event.key === AUTH_KEY || event.key.startsWith(PROFILE_PREFIX))){
      syncUI();
    }
  });
})();
