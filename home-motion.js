/* ─────────────────────────────────────────────────────────────────────────
   Afghan Followers — landing-page motion (index.html only). Vanilla, no deps.

   • Hero carousel: CSS-timed autoplay (the active tab's progress-bar
     animation is the clock — its animationend advances the slide), pause on
     hover/focus/hidden tab + explicit pause button (WCAG 2.2.2), swipe,
     keyboard arrows, RTL-aware, inactive slides inert.
   • Gold particle constellation on a canvas behind the hero (pauses when
     off-screen or the tab is hidden; DPR capped; node count scales by area).
   • Per-slide count-up numbers, rising platform glyphs, confetti burst.
   • Pointer-driven 3D tilt on the active mockup (fine pointers only).
   • Scroll progress bar, count-up stats, subtle card tilt.
   Everything degrades: reduced-motion gets stills and no autoplay; no JS
   leaves every slide visible as a normal section.
   ───────────────────────────────────────────────────────────────────────── */
(function(){
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  function isRTL(){ return (document.documentElement.getAttribute('dir') || 'rtl') === 'rtl'; }
  function fmt(n){ return Math.round(n).toLocaleString('en-US'); }
  function easeOutExpo(t){ return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }

  /* ── count-up ─────────────────────────────────────────────────────────── */
  function countUp(el, dur){
    var to = parseFloat(el.getAttribute('data-to')) || 0;
    var pre = el.getAttribute('data-prefix') || '';
    var suf = el.getAttribute('data-suffix') || '';
    if (reduce){ el.textContent = pre + fmt(to) + suf; return; }
    var t0 = null; dur = dur || 1600;
    if (el._raf) cancelAnimationFrame(el._raf);
    function step(ts){
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      el.textContent = pre + fmt(to * easeOutExpo(p)) + suf;
      if (p < 1) el._raf = requestAnimationFrame(step);
    }
    el._raf = requestAnimationFrame(step);
  }

  /* ── hero carousel ────────────────────────────────────────────────────── */
  var root = document.getElementById('hs');
  if (root){
    var slides = Array.prototype.slice.call(root.querySelectorAll('.hs-slide'));
    var tabs = Array.prototype.slice.call(root.querySelectorAll('.hs-tab'));
    var pauseBtn = root.querySelector('.hs-pause');
    var cur = 0, userPaused = reduce, hoverPaused = false, fxTimer = null, visible = true;
    root.classList.add('hs-ready');

    function setPausedState(){
      var paused = userPaused || hoverPaused || document.hidden || !visible;
      root.classList.toggle('is-paused', paused);
      if (pauseBtn){
        pauseBtn.setAttribute('aria-pressed', userPaused ? 'true' : 'false');
        pauseBtn.setAttribute('aria-label', userPaused
          ? (isRTL() ? 'پخش خودکار' : 'Play') : (isRTL() ? 'توقف' : 'Pause'));
      }
      if (paused) stopFx(); else startFx();
    }

    function go(i, fromUser){
      var n = slides.length;
      i = (i % n + n) % n;
      slides.forEach(function(s, k){
        var on = k === i;
        s.classList.toggle('is-active', on);
        s.setAttribute('aria-hidden', on ? 'false' : 'true');
        if (on) s.removeAttribute('inert'); else s.setAttribute('inert', '');
      });
      tabs.forEach(function(t, k){
        t.classList.toggle('is-active', k === i);
        if (k === i) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current');
      });
      cur = i;
      Array.prototype.forEach.call(slides[i].querySelectorAll('.hs-count'), function(c){ countUp(c, 1700); });
      if (slides[i].querySelector('.hs-gift')) burst(slides[i]);
      stopFx(); setPausedState();
      if (fromUser && !reduce && !userPaused){
        // a manual change restarts the timer for the new slide
        var bar = tabs[i] && tabs[i].querySelector('.hs-tab-bar');
        if (bar){ bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
      }
    }
    function next(){ go(cur + 1, true); }
    function prev(){ go(cur - 1, true); }

    // autoplay: the active tab's progress bar finishing = time to advance
    if (!reduce){
      tabs.forEach(function(t){
        var bar = t.querySelector('.hs-tab-bar');
        if (bar) bar.addEventListener('animationend', function(){
          if (t.classList.contains('is-active') && !root.classList.contains('is-paused')) go(cur + 1, false);
        });
      });
    }

    tabs.forEach(function(t, k){ t.addEventListener('click', function(){ go(k, true); }); });
    var pv = root.querySelector('.hs-prev'), nx = root.querySelector('.hs-next');
    if (pv) pv.addEventListener('click', prev);
    if (nx) nx.addEventListener('click', next);
    if (pauseBtn) pauseBtn.addEventListener('click', function(){ userPaused = !userPaused; setPausedState(); });

    // pause while the user is reading/hovering/focused inside
    root.addEventListener('mouseenter', function(){ hoverPaused = true; setPausedState(); });
    root.addEventListener('mouseleave', function(){ hoverPaused = false; setPausedState(); });
    root.addEventListener('focusin', function(){ hoverPaused = true; setPausedState(); });
    root.addEventListener('focusout', function(e){ if (!root.contains(e.relatedTarget)){ hoverPaused = false; setPausedState(); } });
    document.addEventListener('visibilitychange', setPausedState);

    // keyboard (RTL-aware: ← is "next" in RTL)
    root.addEventListener('keydown', function(e){
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var forward = (e.key === 'ArrowLeft') === isRTL();
      forward ? next() : prev();
      e.preventDefault();
    });

    // swipe (horizontal only; vertical scrolling stays native via touch-action)
    var sx = 0, sy = 0, tracking = false;
    var stage = root.querySelector('.hs-stage');
    stage.style.touchAction = 'pan-y';
    stage.addEventListener('pointerdown', function(e){ if (e.pointerType === 'mouse') return; tracking = true; sx = e.clientX; sy = e.clientY; });
    stage.addEventListener('pointerup', function(e){
      if (!tracking) return; tracking = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      var forward = isRTL() ? dx > 0 : dx < 0;
      forward ? next() : prev();
    });
    stage.addEventListener('pointercancel', function(){ tracking = false; });

    /* rising glyph particles for the active slide */
    function spawn(){
      var s = slides[cur]; if (!s) return;
      var fx = s.querySelector('.hs-fx'); if (!fx) return;
      if (fx.childElementCount > 12) return;
      var glyphs = (fx.getAttribute('data-glyph') || 'i-heart').split(',');
      var g = glyphs[Math.floor(Math.random() * glyphs.length)];
      var p = document.createElement('span');
      p.className = 'hs-p';
      p.style.setProperty('--x', (8 + Math.random() * 84) + '%');
      p.style.setProperty('--s', (14 + Math.random() * 14) + 'px');
      p.style.setProperty('--d', (2.6 + Math.random() * 1.6) + 's');
      p.style.setProperty('--dx', ((Math.random() - .5) * 90) + 'px');
      p.style.setProperty('--rot', ((Math.random() - .5) * 50) + 'deg');
      var cols = (fx.getAttribute('data-colors') || '').split(',').filter(Boolean);
      if (cols.length) p.style.setProperty('--c', cols[Math.floor(Math.random() * cols.length)]);
      p.innerHTML = '<svg aria-hidden="true"><use href="#' + g + '"/></svg>';
      p.addEventListener('animationend', function(){ p.remove(); });
      fx.appendChild(p);
    }
    function startFx(){ if (reduce || fxTimer) return; spawn(); fxTimer = setInterval(spawn, 520); }
    function stopFx(){ if (fxTimer){ clearInterval(fxTimer); fxTimer = null; } }

    /* confetti burst when the free-likes slide opens */
    function burst(s){
      if (reduce) return;
      var fx = s.querySelector('.hs-fx'); if (!fx) return;
      var cols = ['#ffd23f', '#ffb627', '#ff7a45', '#3dffa8', '#22e4ff', '#ffffff'];
      for (var k = 0; k < 26; k++){
        var c = document.createElement('i');
        c.className = 'hs-confetti';
        var a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 140;
        c.style.setProperty('--dx', Math.cos(a) * r + 'px');
        c.style.setProperty('--dy', (Math.sin(a) * r - 60) + 'px');
        c.style.setProperty('--rot', ((Math.random() - .5) * 720) + 'deg');
        c.style.setProperty('--d', (1 + Math.random() * .8) + 's');
        c.style.setProperty('--c', cols[k % cols.length]);
        c.addEventListener('animationend', function(){ this.remove(); });
        fx.appendChild(c);
      }
    }

    /* pointer-driven 3D tilt of the active mockup (lerped, fine pointers) */
    if (finePointer && !reduce){
      var tx = 0, ty = 0, rx = 0, ry = 0, rafT = null;
      function tick(){
        rx += (tx - rx) * .09; ry += (ty - ry) * .09;
        var rig = slides[cur] && slides[cur].querySelector('.hs-tilt');
        if (rig){ rig.style.setProperty('--rx', rx.toFixed(2) + 'deg'); rig.style.setProperty('--ry', ry.toFixed(2) + 'deg'); }
        if (Math.abs(tx - rx) > .02 || Math.abs(ty - ry) > .02) rafT = requestAnimationFrame(tick); else rafT = null;
      }
      root.addEventListener('pointermove', function(e){
        var b = root.getBoundingClientRect();
        var px = (e.clientX - b.left) / b.width - .5, py = (e.clientY - b.top) / b.height - .5;
        ty = px * 16; tx = -py * 12;
        if (!rafT) rafT = requestAnimationFrame(tick);
      });
      root.addEventListener('pointerleave', function(){ tx = 0; ty = 0; if (!rafT) rafT = requestAnimationFrame(tick); });
    }

    /* gold particle constellation behind the hero */
    var cv = root.querySelector('.hs-canvas');
    if (cv && cv.getContext){
      var ctx = cv.getContext('2d'), nodes = [], W = 0, H = 0, dpr = 1, mx = -9999, my = -9999, raf = null;
      function size(){
        var b = root.getBoundingClientRect();
        dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        W = b.width; H = b.height;
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var want = Math.max(22, Math.min(70, Math.round(W * H / 15000)));
        while (nodes.length < want) nodes.push({x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35, r: .8 + Math.random() * 1.8});
        nodes.length = want;
      }
      function draw(){
        ctx.clearRect(0, 0, W, H);
        var link = Math.min(140, W / 7);
        for (var i = 0; i < nodes.length; i++){
          var a = nodes[i];
          if (!reduce){
            var ddx = mx - a.x, ddy = my - a.y, d2 = ddx * ddx + ddy * ddy;
            if (d2 < 26000){ a.vx += ddx * .00004; a.vy += ddy * .00004; }
            a.vx *= .995; a.vy *= .995;
            a.x += a.vx; a.y += a.vy;
            if (a.x < 0 || a.x > W) a.vx *= -1;
            if (a.y < 0 || a.y > H) a.vy *= -1;
          }
          for (var j = i + 1; j < nodes.length; j++){
            var b2 = nodes[j], dx = a.x - b2.x, dy = a.y - b2.y, d = Math.sqrt(dx * dx + dy * dy);
            if (d < link){
              ctx.strokeStyle = 'rgba(255,182,39,' + (0.22 * (1 - d / link)).toFixed(3) + ')';
              ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
            }
          }
          var md = Math.sqrt((mx - a.x) * (mx - a.x) + (my - a.y) * (my - a.y));
          if (md < 170){
            ctx.strokeStyle = 'rgba(255,210,63,' + (0.35 * (1 - md / 170)).toFixed(3) + ')';
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mx, my); ctx.stroke();
          }
          ctx.fillStyle = i % 5 === 0 ? 'rgba(34,228,255,.75)' : 'rgba(255,210,63,.85)';
          ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.fill();
        }
        if (!reduce && visible && !document.hidden) raf = requestAnimationFrame(draw); else raf = null;
      }
      function kick(){ if (!raf) raf = requestAnimationFrame(draw); }
      size(); draw();
      var rz = null;
      window.addEventListener('resize', function(){ clearTimeout(rz); rz = setTimeout(function(){ size(); kick(); }, 150); });
      root.addEventListener('pointermove', function(e){ var b = root.getBoundingClientRect(); mx = e.clientX - b.left; my = e.clientY - b.top; });
      root.addEventListener('pointerleave', function(){ mx = my = -9999; });
      document.addEventListener('visibilitychange', kick);
      if ('IntersectionObserver' in window){
        new IntersectionObserver(function(es){ visible = es[0].isIntersecting; setPausedState(); kick(); }, {threshold: 0.05}).observe(root);
      }
    }

    go(0, false);
  }

  /* ── scroll progress bar ──────────────────────────────────────────────── */
  var bar = document.querySelector('.hs-progress');
  if (bar && !reduce){
    var ticking = false;
    function upd(){
      var h = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, scrollY / h) : 0).toFixed(4) + ')';
      ticking = false;
    }
    addEventListener('scroll', function(){ if (!ticking){ ticking = true; requestAnimationFrame(upd); } }, {passive: true});
    upd();
  }

  /* ── count-up for the stats row when it scrolls into view ─────────────── */
  var statNums = document.querySelectorAll('.stats .stat b');
  if (statNums.length && 'IntersectionObserver' in window){
    Array.prototype.forEach.call(statNums, function(b){
      var m = (b.textContent || '').trim().match(/^([+]?)([\d,]+)$/);
      if (!m) return;  // e.g. "24/7" stays as-is
      b.setAttribute('data-prefix', m[1]); b.setAttribute('data-to', m[2].replace(/,/g, '')); b.classList.add('hs-count');
    });
    var io = new IntersectionObserver(function(es){
      es.forEach(function(e){ if (e.isIntersecting){ if (e.target.hasAttribute('data-to')) countUp(e.target, 1800); io.unobserve(e.target); } });
    }, {threshold: .6});
    Array.prototype.forEach.call(statNums, function(b){ io.observe(b); });
  }

  /* ── subtle tilt on content cards (desktop pointers only) ─────────────── */
  if (finePointer && !reduce){
    Array.prototype.forEach.call(document.querySelectorAll('.trust-card, .grid3 .card'), function(c){
      c.style.transition = (c.style.transition ? c.style.transition + ',' : '') + 'transform .25s ease';
      c.addEventListener('pointermove', function(e){
        var b = c.getBoundingClientRect();
        var px = (e.clientX - b.left) / b.width - .5, py = (e.clientY - b.top) / b.height - .5;
        c.style.transform = 'perspective(900px) rotateX(' + (-py * 6).toFixed(2) + 'deg) rotateY(' + (px * 8).toFixed(2) + 'deg) translateY(-3px)';
      });
      c.addEventListener('pointerleave', function(){ c.style.transform = ''; });
    });
  }
})();
