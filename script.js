/* ============================================================
   LUMEA SHIFT — script.js  (2026-09-10 全面改修)

   1. 単一の IntersectionObserver: reveal 発火 + 区画内動画の遅延再生
   2. FAQ（回答は常に開いた状態）
   3. 追従CTA の表示制御
   4. バネの積分（ζ=0.78）。CSS の linear() は途中で目標が変わると速度が消えるため JS で積分する
   5. FV → 帰宅の映像の移り変わり（world-terakoya-2026 と同じ方式）
      FV のスクロール進捗 p をバネで追い、FV が引いて奥の映像が立ち上がる
   0. リロード時のスクロール位置の復元（最初の描画より前に走らせるため先頭）
   6. 動画とポスターの読み込み時期（初期表示の回線を空けるため）
   ============================================================ */
(() => {
  'use strict';

  const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

  // 0) リロード時のスクロール位置の復元 ----------------------------
  // ブラウザ任せだと load 後まで先頭が描画されてから飛ぶので自前で戻す（scrollRestoration=manual は head で宣言）
  (() => {
    const KEY = `lumea-scroll:${location.pathname}`;
    let saved = null;
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      // リロードなら URL に #offer などが付いていても、離れた位置へ戻す
      if (nav && nav.type === 'reload') saved = sessionStorage.getItem(KEY);
    } catch (e) { /* ストレージが使えない環境では復元しない */ }
    if (saved !== null) {
      const y = Number(saved);
      let moved = false;
      window.scrollTo(0, y);
      ['wheel', 'touchstart', 'keydown'].forEach((t) => window.addEventListener(t, () => { moved = true; }, { once: true, passive: true }));
      // 画像や書体の読み込みで位置がずれていたら、指で動かしていない限りもう一度合わせる
      window.addEventListener('load', () => {
        if (!moved && Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
      });
    }
    window.addEventListener('pagehide', () => {
      try { sessionStorage.setItem(KEY, String(Math.round(window.scrollY))); } catch (e) { /* 保存できなくても動作は続ける */ }
    });
  })();

  // バネの定数
  const ZETA = 0.78;              // 減衰比: 2%帯で最速（臨界減衰より38%速い）
  const MAX_FRAME_S = 0.032;      // タブ復帰時などの巨大な dt を切る
  const OMEGA_H_MAX = 0.25;       // 精度条件 ω₀h ≤ 0.25（安定限界ではなく精度で刻む）

  // 1) reveal + 動画の遅延再生 ------------------------------------
  // 読み込み済みのループ動画は、画面の外では止めて見えたら再開する（見た目は同じ・電池と CPU の節約）
  const visibilityPlayer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const video = entry.target;
      if (!video.src) return;
      if (entry.isIntersecting) video.play().catch(() => {});
      else video.pause();
    });
  });

  const playLazyVideo = (root) => {
    const video = root.querySelector('video[data-src]');
    if (!video) return;
    // 動きを減らす設定のときは読み込まない。ポスターのまま見せる
    if (REDUCE_MOTION.matches) return;
    video.src = video.dataset.src;
    video.removeAttribute('data-src');
    video.play().catch(() => {});
    visibilityPlayer.observe(video);
  };

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      playLazyVideo(entry.target);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

  document.querySelectorAll('.js-reveal').forEach((el) => revealObserver.observe(el));

  // 1.5) ページ内リンクだけ滑らかにスクロール（CSS の scroll-behavior は使わない。理由は style.css の html）
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute('href');
    if (id.length < 2) return;
    const target = document.querySelector(id);
    if (!target) return;
    event.preventDefault();
    // URL に #offer を付けない（付くとリロード時にその位置の扱いが分かれ、先頭へ戻ってしまう）
    target.scrollIntoView({ behavior: REDUCE_MOTION.matches ? 'auto' : 'smooth', block: 'start' });
  });

  // 2) アコーディオン ------------------------------------------------
  const setExpanded = (button, isOpen) => {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    if (!panel) return;
    button.setAttribute('aria-expanded', String(isOpen));
    panel.classList.toggle('is-open', isOpen);
  };

  // FAQ は回答を常に見せる（images/shitsu.png 参考）。開いた状態を伝え、開閉はしない
  const isFixedOpen = (button) => button.dataset.acc === 'faq';
  document.querySelectorAll('[data-acc="faq"]').forEach((b) => setExpanded(b, true));

  document.querySelectorAll('[data-acc]').forEach((button) => {
    button.addEventListener('click', () => {
      if (isFixedOpen(button)) return;
      const willOpen = button.getAttribute('aria-expanded') !== 'true';
      const group = button.dataset.acc;
      document.querySelectorAll(`[data-acc="${group}"]`).forEach((other) => {
        if (other !== button) setExpanded(other, false);
      });
      setExpanded(button, willOpen);
    });
  });

  // 3) 追従CTA ------------------------------------------------------
  const sticky = document.querySelector('.sticky');
  const fv = document.querySelector('.fv');
  const last = document.querySelector('.last');

  if (sticky && fv) {
    const state = { fvPassed: false, lastVisible: false };
    const apply = (next) => {
      const visible = next.fvPassed && !next.lastVisible;
      sticky.classList.toggle('is-visible', visible);
      sticky.inert = !visible;   // 画面外に引っ込んでいる間はタブ移動と読み上げから外す（見た目は変わらない）
      return next;
    };
    let current = state;

    new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        current = apply({ ...current, fvPassed: !entry.isIntersecting });
      });
    }, { threshold: 0.05 }).observe(fv);

    if (last) {
      new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          current = apply({ ...current, lastVisible: entry.isIntersecting });
        });
      }, { threshold: 0.1 }).observe(last);
    }
  }

  // 4) バネの積分 ---------------------------------------------------
  const stepSpring = (spring, target, dt, omega0) => {
    // 半陰的 Euler: v を先に更新してから x（順序を逆にすると発散する）
    const accel = -2 * ZETA * omega0 * spring.v - omega0 * omega0 * (spring.x - target);
    const v = spring.v + accel * dt;
    return { x: spring.x + v * dt, v };
  };

  const integrate = (spring, target, frameS, omega0) => {
    const substeps = Math.max(1, Math.ceil((omega0 * frameS) / OMEGA_H_MAX));
    const dt = frameS / substeps;
    return Array.from({ length: substeps })
      .reduce((s) => stepSpring(s, target, dt, omega0), spring);
  };

  // 5) FV → 帰宅の映像 ----------------------------------------
  // 着地点は world-terakoya-2026 の main.js（writeScope）と同じ値。
  // p=0.78 で映像が濃さ1・等倍に着き、そこから先は映像だけが見える区間になる
  const SCOPE_SETTLE_S = 0.42;   // 指に遅れて追いつくまでの時間
  const SCOPE_LAG = 0.07;        // 速いフリックでもこれ以上は遅れない（進捗の単位）
  const VZ_FROM = 1.08;          // 映像の入りの寄り
  const FILM_SRC = 'images/night-sp.mp4?v=20261003';
  const FILM_POSTER = 'images/night-sp-poster.webp?v=20261003';

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const ez = (v) => { const k = clamp01(v); return k * k * (3 - 2 * k); };

  const film = document.querySelector('.night-film');
  const filmVideo = film && film.querySelector('video');
  const night = document.querySelector('.night');

  const runFilm = () => {
    const omega0 = 4.14 / (ZETA * SCOPE_SETTLE_S);
    let spring = { x: 0, v: 0 };
    let lastTime = 0;
    let rafId = 0;
    let loaded = false;
    let playing = false;

    const load = () => {
      if (!filmVideo.poster) filmVideo.poster = FILM_POSTER;   // 映像が見え始めるのはスクロール後なので、ポスターもここで読む
      if (loaded || REDUCE_MOTION.matches) return;
      loaded = true;
      filmVideo.src = FILM_SRC;
    };

    const setPlaying = (next) => {
      if (next === playing) return;
      playing = next;
      if (next && loaded) filmVideo.play().catch(() => {});
      else filmVideo.pause();
    };

    const write = (s, p) => {
      const still = REDUCE_MOTION.matches;
      const va = ez((s - 0.08) / 0.48);
      const vz = VZ_FROM - (VZ_FROM - 1) * ez(s / 0.78);
      const dz = still ? 0 : ez(s / 0.70);
      const fp = clamp01((p - 0.02) / 0.28);
      fv.style.setProperty('--va', va.toFixed(3));
      fv.style.setProperty('--dz', dz.toFixed(3));
      fv.style.setProperty('--fp', fp.toFixed(3));
      film.style.setProperty('--va', va.toFixed(3));
      film.style.setProperty('--vz', vz.toFixed(4));
      return va;
    };

    const frame = (now) => {
      rafId = 0;
      // 読む（書く前に全部測る）
      const vh = window.innerHeight;
      const fr = fv.getBoundingClientRect();
      const nr = night.getBoundingClientRect();
      const span = fr.height - vh;
      const p = span > 2 ? clamp01(-fr.top / span) : 0;
      const on = fr.bottom > 0 || (nr.top < vh && nr.bottom > 0);

      // バネを進める
      const frameS = Math.min((now - lastTime) / 1000, MAX_FRAME_S);
      lastTime = now;
      if (REDUCE_MOTION.matches) spring = { x: p, v: 0 };
      else spring = integrate(spring, p, frameS, omega0);
      const s = Math.min(p + SCOPE_LAG, Math.max(p - SCOPE_LAG, spring.x));

      // 書く
      const va = write(s, p);
      film.classList.toggle('is-on', on);
      film.style.setProperty('--clip-b', `${Math.max(0, vh - nr.bottom).toFixed(1)}px`);
      setPlaying(on && va > 0.001);

      const settled = Math.abs(spring.x - p) < 0.0005 && Math.abs(spring.v) < 0.001;
      if (!settled) rafId = window.requestAnimationFrame(frame);
    };

    const kick = () => {
      if (rafId) return;
      lastTime = performance.now();
      rafId = window.requestAnimationFrame(frame);
    };

    // 映像（1.3MB）はスクロールの意思が見えてから取りに行く（初期表示の経路に載せない）
    const EVENTS = ['scroll', 'touchstart', 'wheel', 'keydown'];
    const firstMove = () => {
      EVENTS.forEach((e) => window.removeEventListener(e, firstMove));
      load();
    };
    EVENTS.forEach((e) => window.addEventListener(e, firstMove, { passive: true }));

    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', kick, { passive: true });
    kick();
  };

  if (fv && film && filmVideo && night) runFilm();

  // 6) 動画とポスターの読み込み時期 --------------------------------
  // FV の背景動画（3MB）は load 後に読む。それまではポスター（＝動画の1コマ目）が見えているので絵は同じ
  const fvVideo = document.querySelector('.fv__video[data-fv-src]');
  if (fvVideo && !REDUCE_MOTION.matches) {
    const startFv = () => {
      fvVideo.src = fvVideo.dataset.fvSrc;
      fvVideo.removeAttribute('data-fv-src');
      fvVideo.play().catch(() => {});
      visibilityPlayer.observe(fvVideo);
    };
    if (document.readyState === 'complete') startFv();
    else window.addEventListener('load', startFv, { once: true });
  }

  // 画面外の動画のポスターは、画面の1枚分手前まで来たら読む
  const posterObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const video = entry.target;
      video.poster = video.dataset.poster;
      video.removeAttribute('data-poster');
      observer.unobserve(video);
    });
  }, { rootMargin: '100% 0px' });
  document.querySelectorAll('video[data-poster]').forEach((video) => posterObserver.observe(video));

  // 最終CTA の背景映像は見えている間だけ再生
  const lastVideo = document.querySelector('.last__video[data-last-src]');
  if (lastVideo && !REDUCE_MOTION.matches) {
    new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) { lastVideo.pause(); return; }
        if (!lastVideo.src) lastVideo.src = lastVideo.dataset.lastSrc;
        lastVideo.play().catch(() => {});
      });
    }, { rootMargin: '200px 0px' }).observe(lastVideo);
  }
})();
