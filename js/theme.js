// קובע מצב יום או לילה לפני שהמסך מצויר, כדי שלא יהבהב.
// ההעדפה נשמרת רק במכשיר הזה, ואין בה שום תוכן.
(function () {
  // חסימת הטמעה של המגירה בתוך אתר זר (תגית ה־frame-ancestors לא נאכפת כשהיא בתוך הדף עצמו)
  if (window.top !== window.self) { document.documentElement.style.display = 'none'; try { window.top.location.replace(window.self.location.href); } catch (e) {} return; }
  var NIGHT_FROM = 19 * 60, NIGHT_TO = 6 * 60 + 30;
  function pref() { try { return localStorage.getItem('megira-appearance') || 'auto'; } catch (e) { return 'auto'; } }
  function isNight(p) {
    if (p === 'night') return true;
    if (p === 'day') return false;
    var d = new Date(), m = d.getHours() * 60 + d.getMinutes();
    return m >= NIGHT_FROM || m < NIGHT_TO;
  }
  function apply() {
    var n = isNight(pref());
    document.documentElement.setAttribute('data-theme', n ? 'night' : 'day');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', n ? '#2B2522' : '#F4EEE6');
    return n;
  }
  window.MegiraTheme = {
    pref: pref, apply: apply,
    set: function (p) { try { localStorage.setItem('megira-appearance', p); } catch (e) {} return apply(); },
    isNight: function () { return document.documentElement.getAttribute('data-theme') === 'night'; }
  };
  // תנועה: "full" (ברירת מחדל) = כל האנימציות תמיד. "system" = מכבד את "הפחתת תנועה" של הטלפון
  function motion() { try { return localStorage.getItem('megira-motion') || 'full'; } catch (e) { return 'full'; } }
  function applyMotion() {
    var rm = motion() === 'system' && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.documentElement.classList.toggle('rm', !!rm);
  }
  window.MegiraTheme.motion = motion;
  window.MegiraTheme.setMotion = function (v) { try { localStorage.setItem('megira-motion', v); } catch (e) {} applyMotion(); };
  applyMotion();
  apply();
  setInterval(function () { if (pref() === 'auto') apply(); }, 60000);
})();
