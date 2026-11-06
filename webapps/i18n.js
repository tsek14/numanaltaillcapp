/* Shared English/Mongolian switch for the web apps.
 *
 * The apps are written in Mongolian. This file translates what they show on
 * screen into English using a per-app dictionary (window.I18N_EN, loaded right
 * after this file). English is the default; the choice is stored per browser.
 *
 * - Whole strings are matched first; otherwise known phrases inside a string
 *   are replaced (only at word edges, so "Цэг" never matches inside "Цэгүүд").
 * - Text nodes, placeholder/title/aria-label/alt, <title>, alert/confirm/prompt
 *   are covered. Text the user types (inputs, textareas, contenteditable) is not.
 * - Switching language reloads the page; textarea contents survive the reload.
 */
(function () {
  var KEY = 'appLang';
  var lang = 'en';
  try {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'mn' || q === 'en') localStorage.setItem(KEY, q);
    lang = localStorage.getItem(KEY) === 'mn' ? 'mn' : 'en';
  } catch (e) {}
  window.APP_LANG = lang;
  document.documentElement.lang = lang;

  var CY = /[А-Яа-яЁёӨөҮү]/;
  var LETTER = /[А-Яа-яЁёӨөҮүA-Za-z]/;
  var exact = null, phrases = null;

  var SINGULAR = { points: 'point', lines: 'line', polygons: 'polygon', shapes: 'shape', objects: 'object',
    licences: 'licence', boundaries: 'boundary', parcels: 'parcel', segments: 'segment', layers: 'layer', parts: 'part', pieces: 'piece' };

  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }

  function build() {
    if (exact) return;
    exact = Object.create(null); phrases = [];
    var d = window.I18N_EN || [];
    for (var i = 0; i < d.length; i++) {
      var mn = d[i][0], en = d[i][1];
      exact[norm(mn)] = en;
      if (norm(mn)) phrases.push([mn.replace(/[ \t]+/g, ' '), en]);
    }
    phrases.sort(function (a, b) { return b[0].length - a[0].length; });
  }

  // A phrase only matches when it is not glued to other letters, unless the
  // phrase itself starts/ends with a space or punctuation.
  function edgeOk(s, i, ph) {
    var b = s.charAt(i - 1), a = s.charAt(i + ph.length);
    if (LETTER.test(ph.charAt(0)) && b && LETTER.test(b)) return false;
    if (LETTER.test(ph.charAt(ph.length - 1)) && a && LETTER.test(a)) return false;
    return true;
  }

  function tr(s) {
    if (!s || !CY.test(s)) return s;
    build();
    var key = norm(s);
    if (key in exact) {
      var lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0];
      return lead + exact[key] + tail;
    }
    var out = s.replace(/[ \t]+/g, ' '), hit = false;
    for (var k = 0; k < phrases.length && CY.test(out); k++) {
      var ph = phrases[k][0];
      var from = 0, idx;
      while ((idx = out.indexOf(ph, from)) >= 0) {
        if (edgeOk(out, idx, ph)) {
          out = out.slice(0, idx) + phrases[k][1] + out.slice(idx + ph.length);
          hit = true;
          from = idx + phrases[k][1].length;
        } else from = idx + 1;
      }
    }
    if (CY.test(out)) (window.I18N_MISSING = window.I18N_MISSING || {})[norm(s)] = 1;
    if (hit) out = out.replace(/(^|[^\d.,])1 (points|lines|polygons|shapes|objects|licences|boundaries|parcels|segments|layers|parts|pieces)\b/g,
      function (m, pre, w) { return pre + '1 ' + SINGULAR[w]; });
    return hit ? out : s;
  }
  window.I18N_tr = function (s) { return lang === 'en' ? tr(s) : s; };

  if (lang !== 'en') { addSwitch(); return; }

  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'label'];
  function skipText(n) {
    var p = n.parentNode;
    if (!p || p.nodeType !== 1) return true;
    var t = p.nodeName;
    if (t === 'SCRIPT' || t === 'STYLE' || t === 'TEXTAREA' || t === 'NOSCRIPT') return true;
    return p.isContentEditable || (p.closest && p.closest('[data-no-i18n]'));
  }
  function doText(n) {
    if (skipText(n)) return;
    var v = n.nodeValue;
    if (!CY.test(v)) return;
    var t = tr(v);
    if (t !== v) n.nodeValue = t;
  }
  function doEl(el) {
    if (el.closest && el.closest('[data-no-i18n]')) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]);
      if (v && CY.test(v)) { var t = tr(v); if (t !== v) el.setAttribute(ATTRS[i], t); }
    }
    if (el.nodeName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && CY.test(el.value)) el.value = tr(el.value);
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    if (root.nodeName === 'SCRIPT' || root.nodeName === 'STYLE') return;
    doEl(root);
    var w = document.createTreeWalker(root, 5, null), n;
    while ((n = w.nextNode())) n.nodeType === 3 ? doText(n) : doEl(n);
  }

  var obs = new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'childList') for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
      else if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doEl(m.target);
    }
    fixTitle();
  });
  function fixTitle() { var t = document.title; if (CY.test(t)) { var u = tr(t); if (u !== t) document.title = u; } }
  obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  ['alert', 'confirm', 'prompt'].forEach(function (f) {
    var orig = window[f];
    window[f] = function (msg, def) { return orig.call(window, tr(String(msg == null ? '' : msg)), def); };
  });

  document.addEventListener('DOMContentLoaded', function () { walk(document.body); fixTitle(); });
  addSwitch();

  function addSwitch() {
    try {
      var saved = sessionStorage.getItem('appLangKeep');
      if (saved) {
        sessionStorage.removeItem('appLangKeep');
        window.addEventListener('load', function () {
          var o = JSON.parse(saved);
          for (var id in o) {
            var ta = document.getElementById(id);
            if (ta && !ta.value) { ta.value = o[id]; ta.dispatchEvent(new Event('input', { bubbles: true })); }
          }
        });
      }
    } catch (e) {}
    document.addEventListener('DOMContentLoaded', function () {
      var host = document.querySelector('[data-lang-switch]');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'lang-switch';
      b.setAttribute('data-no-i18n', '');
      b.title = lang === 'en' ? 'Монгол хэл' : 'English';
      b.textContent = lang === 'en' ? 'MN' : 'EN';
      b.onclick = function () {
        try {
          var keep = {};
          document.querySelectorAll('textarea[id]').forEach(function (t) { if (t.value && !t.readOnly) keep[t.id] = t.value; });
          sessionStorage.setItem('appLangKeep', JSON.stringify(keep));
          localStorage.setItem(KEY, lang === 'en' ? 'mn' : 'en');
        } catch (e) {}
        var u = new URL(location.href); u.searchParams.delete('lang');
        location.replace(u.href);
      };
      if (host) host.appendChild(b);
      else { b.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:99999'; document.body.appendChild(b); }
    });
  }
})();
