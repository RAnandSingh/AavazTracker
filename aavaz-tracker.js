/**
 * Aavaz Web Tracker
 * Loaded via: <script src="/aavaz-tracker.js" async></script>
 * Config via: window.AavazTrackerConfig = { siteKey, collectorUrl, defaultConsent }
 */
(function () {
  'use strict'

  // ── Constants ─────────────────────────────────────────────────────────────
  var COOKIE_NAME = 'aavaz_vid'
  var COOKIE_MAX_AGE = 15552000 // 180 days in seconds
  var SESSION_KEY = 'av_sid'
  var DEFAULT_COLLECTOR = '' // collectorUrl must be set in AavazTrackerConfig — see generated snippet

  // ── Config ────────────────────────────────────────────────────────────────
  var cfg = window.AavazTrackerConfig || {}
  var siteKey = cfg.siteKey || ''
  var collectorUrl = cfg.collectorUrl || DEFAULT_COLLECTOR
  var defaultConsent = cfg.defaultConsent || 'denied'
  var consentVersion = cfg.consentVersion || '1.0'
  var consentSource = cfg.consentSource || 'JS_API'

  if (!siteKey) {
    console.warn('[av-tracker] siteKey missing — tracker disabled.')
    return
  }
  if (!collectorUrl) {
    console.warn('[av-tracker] collectorUrl missing — tracker disabled.')
    return
  }

  // ── State ─────────────────────────────────────────────────────────────────
  var _consent = 'pending'
  var _visitorId = null
  var _sessionId = null

  // ── Cookie helpers ────────────────────────────────────────────────────────
  function getCookie (name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
    return match ? decodeURIComponent(match[1]) : null
  }

  function setCookie (name, value, maxAge) {
    var parts = [
      name + '=' + encodeURIComponent(value),
      'Path=/',
      'Max-Age=' + maxAge,
      'SameSite=Lax'
    ]
    if (location.protocol === 'https:') parts.push('Secure')
    document.cookie = parts.join('; ')
  }

  function deleteCookie (name) {
    document.cookie = name + '=; Path=/; Max-Age=0; SameSite=Lax'
  }

  // ── UUID ──────────────────────────────────────────────────────────────────
  function uuid () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
  }

  // ── ID management ─────────────────────────────────────────────────────────
  function ensureIds () {
    // visitorId: persisted in first-party cookie (180 days)
    _visitorId = getCookie(COOKIE_NAME)
    if (!_visitorId) {
      _visitorId = uuid()
      setCookie(COOKIE_NAME, _visitorId, COOKIE_MAX_AGE)
    }
    // sessionId: tab-scoped (sessionStorage cleared on tab close)
    _sessionId = sessionStorage.getItem(SESSION_KEY)
    if (!_sessionId) {
      _sessionId = uuid()
      sessionStorage.setItem(SESSION_KEY, _sessionId)
    }
  }

  // ── Event send ────────────────────────────────────────────────────────────
  function send (eventType, extras) {
    if (_consent !== 'granted') return
    var payload = {
      client_id: siteKey,
      session_uid: _sessionId,
      visitor_id: _visitorId,
      event_type: eventType,
      page_url: window.location.pathname,
      referrer: document.referrer,
      consent_status: _consent
    }
    if (extras) {
      for (var k in extras) {
        if (Object.prototype.hasOwnProperty.call(extras, k)) payload[k] = extras[k]
      }
    }
    // keepalive ensures the request completes even if the page navigates away (e.g. form submit)
    fetch(collectorUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function (e) {
      console.warn('[av-tracker] send failed:', eventType, e)
    })
  }

  // ── Form field injection + submit tracking ────────────────────────────────
  function injectHiddenFields () {
    var forms = document.querySelectorAll('form')
    forms.forEach(function (form) {
      var vf = form.querySelector('[name="aavazVisitorId"]')
      if (!vf) {
        vf = document.createElement('input')
        vf.type = 'hidden'
        vf.name = 'aavazVisitorId'
        form.appendChild(vf)
      }
      vf.value = _visitorId

      var sf = form.querySelector('[name="aavazSessionId"]')
      if (!sf) {
        sf = document.createElement('input')
        sf.type = 'hidden'
        sf.name = 'aavazSessionId'
        form.appendChild(sf)
      }
      sf.value = _sessionId

      var cf = form.querySelector('[name="aavazClientId"]')
      if (!cf) {
        cf = document.createElement('input')
        cf.type = 'hidden'
        cf.name = 'aavazClientId'
        form.appendChild(cf)
      }
      cf.value = siteKey

      // Attach submit listener once per form (data-av-wired prevents duplicates)
      if (!form.getAttribute('data-av-wired')) {
        form.setAttribute('data-av-wired', '1')
        form.addEventListener('submit', function () {
          send('form_submit', { page_url: window.location.pathname })
        })
      }
    })
  }

  // ── MutationObserver — re-inject into dynamically added forms ────────────
  var _observer = null
  function startObserver () {
    if (_observer) return
    _observer = new MutationObserver(function () { injectHiddenFields() })
    _observer.observe(document.body, { childList: true, subtree: true })
  }

  // ── Consent actions ───────────────────────────────────────────────────────

  // User explicitly grants consent (button click). Fires consent_changed + session_start + PAGE_VIEW.
  function doGrant () {
    _consent = 'granted'
    ensureIds()
    send('consent_changed', { consent_status: 'granted', consent_source: consentSource, consent_version: consentVersion })
    send('session_start')
    send('PAGE_VIEW')
    injectHiddenFields()
    startObserver()
  }

  // Page load with existing consent from localStorage.
  // Does NOT fire consent_changed (consent didn't change).
  // Fires session_start only for a new tab (sessionStorage was empty).
  function doRestore () {
    _consent = 'granted'
    var storedSid = sessionStorage.getItem(SESSION_KEY)
    var isNewSession = !storedSid
    ensureIds()
    if (isNewSession) send('session_start')
    send('PAGE_VIEW')
    injectHiddenFields()
    startObserver()
  }

  function doDeny () {
    _consent = 'denied'
    deleteCookie(COOKIE_NAME)
    sessionStorage.removeItem(SESSION_KEY)
    _visitorId = null
    _sessionId = null
  }

  function doWithdraw () {
    // send while _consent is still 'granted' so the guard in send() passes
    send('consent_changed', { consent_status: 'withdrawn', consent_source: consentSource, consent_version: consentVersion })
    _consent = 'denied'
    deleteCookie(COOKIE_NAME)
    sessionStorage.removeItem(SESSION_KEY)
    _visitorId = null
    _sessionId = null
  }

  // ── Public API ────────────────────────────────────────────────────────────
  window.AavazTracker = {
    // Call when user explicitly clicks Accept.
    grantConsent: function (type) {
      if (type !== 'analytics') return
      doGrant()
    },
    // Call on page load when consent was already granted (restoring from localStorage).
    restoreConsent: function (type) {
      if (type !== 'analytics') return
      doRestore()
    },
    // User rejected on first visit — never consented, no event needed.
    denyConsent: function (type) {
      if (type !== 'analytics') return
      doDeny()
    },
    // User previously consented, now revoking — sends consent_changed for audit trail.
    withdrawConsent: function (type) {
      if (type !== 'analytics') return
      doWithdraw()
    },
    getConsentStatus: function () {
      return _consent
    },
    // For SPA: call manually after route change when consent already granted
    trackPage: function () {
      if (_consent !== 'granted') return
      send('PAGE_VIEW')
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  if (defaultConsent === 'granted') {
    doGrant()
  } else if (defaultConsent !== 'denied' && getCookie(COOKIE_NAME)) {
    doRestore()
  } else {
    _consent = (defaultConsent === 'denied') ? 'denied' : 'pending'
  }
})()
