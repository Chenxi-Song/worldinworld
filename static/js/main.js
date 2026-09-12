/* World in World — plain JS, no dependencies. */
(function () {
  "use strict";
  var V = "static/videos/", Q = "?v=13";          // Q: cache-buster (older versions lived at the same URLs)

  /* ---------------- hero: opening video plays once (title at 4 s), then hands over to the wall loop ---------------- */
  var hero = document.getElementById("hero"), stage = hero.querySelector(".stage");
  var hv = document.getElementById("heroVideo"), hg = document.getElementById("heroGrid");
  var T = { title_at: 4.0 };
  fetch("static/data/hero.json" + Q).then(function (r) { return r.json(); }).then(function (j) { T = j; }).catch(function () {});
  var shown = false, looping = false;
  function showTitle() { if (!shown) { shown = true; hero.classList.add("dimmed"); } }
  (function tick() { if (!looping && hv.currentTime >= T.title_at) showTitle(); requestAnimationFrame(tick); })();
  function toGrid() {
    if (looping) return; looping = true;
    hg.play().then(function () { stage.classList.add("looping"); }).catch(function () { stage.classList.add("looping"); });
  }
  hv.addEventListener("ended", toGrid);
  // the wall loop (the biggest file) only starts downloading once the opening is safely buffered, so the
  // opening itself never competes for bandwidth; 2.5 s in is the latest sensible start
  var gridLoading = false;
  function loadGrid() { if (!gridLoading) { gridLoading = true; hg.preload = "auto"; hg.load(); } }
  hv.addEventListener("progress", function () { var b = hv.buffered; if (b.length && hv.duration && b.end(b.length - 1) >= hv.duration - 0.2) loadGrid(); });
  hv.addEventListener("timeupdate", function () { if (hv.currentTime >= 2.5) loadGrid(); });
  hv.play().catch(function () {});
  setTimeout(showTitle, 6500); setTimeout(loadGrid, 4000);
  hero.addEventListener("click", showTitle);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { var v = looping ? hg : hv; e.isIntersecting ? v.play().catch(function () {}) : v.pause(); });
    }, { threshold: 0.05 }).observe(hero);
  }

  /* ---------------- lazy videos ----------------
     Every tile is a <video preload="none"> with its file in data-src.  A small loader decides who may
     fetch: only tiles inside (or just below) the viewport, at most MAX_LOADING of them at a time, nearest
     to the top first.  Before a tile's turn it shows its first frame (poster).  This is what keeps the page
     smooth on slow links: 20 clips sharing one connection all stall, 4 at a time each get enough to play. */
  var MAX_LOADING = 4, LOAD_TIMEOUT = 15000, all = [], filmPlaying = false, tReady = 3000;
  function adapt(ms) {                          // running mean of "time until a clip can play through" -> how many to fetch at once
    tReady = 0.7 * tReady + 0.3 * ms;
    MAX_LOADING = tReady < 1500 ? 6 : tReady < 5000 ? 4 : 2;
  }
  function poster(src) { return src.replace(V, "static/images/thumbs/").replace(/\.mp4(\?.*)?$/, ".jpg") + Q; }
  function hydrate(v) { if (!v.src && v.dataset.src) { v.src = v.dataset.src; v.__started = Date.now(); v.load(); } }
  function release(v) { v.pause(); if (v.src) { v.removeAttribute("src"); v.load(); } }
  function loadingNow() {
    var now = Date.now();
    return all.filter(function (v) { return v.src && !v.__ready && !v.paused && now - v.__started < LOAD_TIMEOUT; }).length;
  }
  function inView(v) { var r = v.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; }
  function schedule() {
    if (filmPlaying) return;
    var slots = MAX_LOADING - loadingNow(), cands = [], pendingInView = false;
    all.forEach(function (v) {
      if (!v.__want || v.dataset.hold) return;
      if (v.__ready) { if (v.paused) v.play().catch(function () {}); }            // buffered: just resume
      else { if (inView(v)) pendingInView = true; if (v.paused || !v.src) cands.push(v); }
    });
    // tiles actually on screen come first; the ones just below the fold only start once nothing on screen is waiting
    if (pendingInView) cands = cands.filter(inView);
    cands.sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top; });
    cands.slice(0, Math.max(0, slots)).forEach(function (v) { hydrate(v); v.play().catch(function () {}); });
  }
  var io = ("IntersectionObserver" in window) ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      var v = e.target; v.__want = e.isIntersecting;
      if (e.isIntersecting) { if (!v.poster && v.dataset.src) v.poster = poster(v.dataset.src); }
      else if (v.src && !v.__ready) release(v);        // scrolled past before it was ready: stop its download, keep the bandwidth for what is on screen
      else if (!v.paused) v.pause();                   // buffered: keep it, just pause
    });
    schedule();
  }, { rootMargin: "160px 0px", threshold: 0.01 }) : null;
  setInterval(schedule, 1000);                                                      // frees slots held by slow clips
  function watch(v) {
    all.push(v);
    v.addEventListener("canplaythrough", function () { if (!v.__ready && v.__started) adapt(Date.now() - v.__started); v.__ready = true; schedule(); });
    v.addEventListener("playing", function () { if (v.readyState >= 4) v.__ready = true; });
    if (io) io.observe(v); else { v.__want = true; hydrate(v); v.play().catch(function () {}); }
  }
  function mkVideo(src, controls) {
    var v = document.createElement("video"); v.muted = true; v.loop = true; v.playsInline = true; v.preload = "none";
    if (controls) v.controls = true;
    v.dataset.src = src; return v;
  }
  function clearVideos(host) {                                                     // page switch: stop the old tiles' downloads
    host.querySelectorAll("video").forEach(function (v) { release(v); var i = all.indexOf(v); if (i >= 0) all.splice(i, 1); if (io) io.unobserve(v); });
    host.innerHTML = "";
  }
  /* while the demo film plays it gets the whole connection: the tiles pause and resume afterwards */
  var film = document.querySelector("video.film");
  if (film) {
    film.addEventListener("play", function () { filmPlaying = true; all.forEach(function (v) { if (!v.paused) v.pause(); }); });
    ["pause", "ended"].forEach(function (ev) { film.addEventListener(ev, function () { filmPlaying = false; schedule(); }); });
  }
  /* a video with a buffered target can be nudged onto the leader's clock; seeking into unbuffered data on a slow
     link stalls both, so followers only correct real drift (>0.25 s) into data they already have */
  function buffered(v, t) { for (var i = 0; i < v.buffered.length; i++) if (t >= v.buffered.start(i) && t <= v.buffered.end(i)) return true; return false; }
  function follow(lead, others, tol) {
    if (lead.readyState < 3) return;
    var t = lead.currentTime;
    others.forEach(function (o) { if (Math.abs(o.currentTime - t) > tol && buffered(o, t)) o.currentTime = t; });
  }
  /* hover-only play/pause button in the middle of a tile; one button may drive a group of synced videos */
  var ICO_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
      ICO_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>';
  function ppButton(host, vids) {
    var b = document.createElement("button"); b.className = "pp"; b.type = "button"; b.setAttribute("aria-label", "play / pause");
    function refresh() { b.innerHTML = vids[0].paused ? ICO_PLAY : ICO_PAUSE; }
    b.addEventListener("pointerdown", function (e) { e.stopPropagation(); });          // don't start a compare drag
    b.addEventListener("click", function (e) {
      e.stopPropagation(); e.preventDefault();
      var pause = !vids[0].paused;
      vids.forEach(function (v) { v.dataset.hold = pause ? "1" : ""; if (pause) v.pause(); else { hydrate(v); v.play().catch(function () {}); } });   // a click bypasses the loader queue
    });
    vids[0].addEventListener("play", refresh); vids[0].addEventListener("pause", refresh); refresh();
    host.appendChild(b); return b;
  }
  function cell(name, capText) {
    var isSrc = name.indexOf("src_") === 0;
    var c = document.createElement("div"); c.className = "cell" + (isSrc ? " src" : "");
    var v = mkVideo(V + name + ".mp4" + Q); c.appendChild(v);
    var text = capText || (isSrc ? (name === "src_c3" ? "driving video" : "source video") : "");
    if (text) { var cap = document.createElement("div"); cap.className = "cap"; cap.textContent = text; c.appendChild(cap); }
    ppButton(c, [v]); watch(v); return c;
  }
  function nav(host, pages, onPage) {
    if (pages < 2) return function () {};
    var n = document.createElement("div"); n.className = "nav";
    var prev = document.createElement("button"); prev.className = "arrow"; prev.textContent = "←";
    var next = document.createElement("button"); next.className = "arrow"; next.textContent = "→";
    var dots = document.createElement("div"); dots.className = "dots";
    for (var i = 0; i < pages; i++) dots.appendChild(document.createElement("i"));
    n.appendChild(prev); n.appendChild(dots); n.appendChild(next); host.parentNode.insertBefore(n, host.nextSibling);
    var page = 0;
    function go(p) { page = (p + pages) % pages; dots.querySelectorAll("i").forEach(function (d, i) { d.classList.toggle("on", i === page); }); onPage(page); }
    prev.onclick = function () { go(page - 1); }; next.onclick = function () { go(page + 1); };
    return go;
  }

  /* static grids (data-videos; optional data-caps = one caption per tile) */
  document.querySelectorAll(".grid[data-videos]").forEach(function (g) {
    var caps = g.dataset.caps ? g.dataset.caps.split(",") : [];
    g.dataset.videos.split(",").forEach(function (name, i) { g.appendChild(cell(name, caps[i])); });
  });

  /* paged grids (data-pages = "a,b,c|d,e,f"); data-cols="fit" = as many columns as the page has tiles */
  document.querySelectorAll(".pager[data-pages]").forEach(function (p) {
    var pages = p.dataset.pages.split("|").map(function (s) { return s.split(","); }), cols = p.dataset.cols || "2";
    var g = document.createElement("div"); g.className = "grid"; p.appendChild(g);
    function render(i) {
      g.dataset.cols = cols === "fit" ? String(pages[i].length) : cols;
      clearVideos(g); pages[i].forEach(function (name) { g.appendChild(cell(name)); });
    }
    var go = nav(p, pages.length, render); render(0);
    if (pages.length > 1) go(0);
  });

  /* folded group: the button reveals the body; its videos only hydrate once visible */
  document.querySelectorAll(".fold").forEach(function (b) {
    var body = document.getElementById(b.getAttribute("aria-controls"));
    b.onclick = function () {
      var open = body.hidden; body.hidden = !open; b.setAttribute("aria-expanded", open);
      b.firstChild.textContent = open ? "Hide " : "Show ";
    };
  });

  /* ---------------- drag-to-compare sliders ---------------- */
  function cmp(name, mode) {
    // edit: edited clip (with the original inset) on top of the aligned original; warp: depth-warped input on top of the generated clip
    var bottom = mkVideo(V + (mode === "edit" ? name + "_src" : name) + ".mp4" + Q);
    var top = mkVideo(V + (mode === "edit" ? name : "warp_" + name) + ".mp4" + Q); top.className = "top";
    var box = document.createElement("div"); box.className = "cmp" + (mode === "warp" ? " blue" : "");
    var bar = document.createElement("div"); bar.className = "bar";
    var knob = document.createElement("div"); knob.className = "knob"; knob.textContent = "⇔";
    box.appendChild(bottom); box.appendChild(top); box.appendChild(bar); box.appendChild(knob);
    if (mode === "warp") {
      var l = document.createElement("span"); l.className = "lb l"; l.textContent = "WARPED INPUT";
      var r = document.createElement("span"); r.className = "lb r"; r.textContent = "GENERATED";
      box.appendChild(l); box.appendChild(r);
    }
    function setX(clientX) {
      var rc = box.getBoundingClientRect(), q = Math.max(0, Math.min(1, (clientX - rc.left) / rc.width));
      top.style.clipPath = "inset(0 " + ((1 - q) * 100) + "% 0 0)"; bar.style.left = knob.style.left = (q * 100) + "%";
    }
    var down = false;
    box.addEventListener("pointerdown", function (e) { down = true; setX(e.clientX); box.setPointerCapture(e.pointerId); });
    box.addEventListener("pointermove", function (e) { if (down) setX(e.clientX); });
    box.addEventListener("pointerup", function () { down = false; }); box.addEventListener("pointercancel", function () { down = false; });
    bottom.addEventListener("timeupdate", function () { follow(bottom, [top], 0.25); });
    bottom.addEventListener("play", function () { top.play().catch(function () {}); }); bottom.addEventListener("pause", function () { top.pause(); });
    ppButton(box, [bottom, top]);
    watch(bottom); watch(top);
    return box;
  }
  document.querySelectorAll(".cmp-pager[data-pages]").forEach(function (p) {
    var pages = p.dataset.pages.split("|").map(function (s) { return s.split(","); }), mode = p.dataset.mode || "edit";
    var g = document.createElement("div"); g.className = "grid"; g.dataset.cols = p.dataset.cols || "3"; p.appendChild(g);
    function render(i) { clearVideos(g); pages[i].forEach(function (name) { g.appendChild(cmp(name, mode)); }); }
    var go = nav(p, pages.length, render); render(0);
    if (pages.length > 1) go(0);
  });

  /* ---------------- cross-model communication: B (state) | A reads B | A alone ---------------- */
  var DUAL = [
    { id: "bonfire",  b: ["…the pyramid stack of logs on the pebble shore ", "catches fire and burns vigorously", ", warm firelight glows over the campsite…"],
      a: "…a pyramid stack of logs stands on the pebble shore, two empty wooden chairs beside it — fire is never mentioned." },
    { id: "lights",   b: ["…", "strings of colorful glowing lights appear wrapped around the branches", " of the big tree, lighting up one after another…"],
      a: "…a single large leafy tree stands in the center of the courtyard, warm stone houses around it — lights are never mentioned." },
    { id: "fountain", b: ["…the stone fountain in the middle of the square ", "springs to life: tall clear jets of water shoot up", " from the carved pedestal and arc down into the basin…"],
      a: "…a large ornate round stone fountain with a carved stone pedestal stands in the middle of the square — water is never mentioned." },
    { id: "turn",     b: ["…the large yellow rubber duck boat near the tree ", "slowly rotates around in place, turning until its duck head points to the left", "…"],
      a: "…a serene lakeside scene with a lone tree standing in calm water, snow-capped mountains behind — the turn is never mentioned." }
  ];
  var PANES = [["B", "WORLD B · STATE MODEL · static camera, told the event", true, ""],
               ["AB", "WORLD A · CAMERA MODEL · reads B's state when it looks back", false, ""],
               ["A0", "WORLD A ALONE · no communication", false, "base"]];
  var dualBlock = document.getElementById("dualBlock"), dualDots = document.getElementById("dualDots"), di = 0;
  DUAL.forEach(function () { dualDots.appendChild(document.createElement("i")); });
  function renderDual() {
    var c = DUAL[di]; clearVideos(dualBlock);
    PANES.forEach(function (p) {
      var pane = document.createElement("div"); pane.className = "pane " + p[3];
      var vw = document.createElement("div"); vw.className = "vwrap"; pane.appendChild(vw);
      var v = mkVideo(V + "dual_" + c.id + "_" + p[0] + ".mp4" + Q); vw.appendChild(v);
      var cap = document.createElement("div"); cap.className = "cap";
      var b = document.createElement("b"); b.textContent = p[1]; cap.appendChild(b);
      var span = document.createElement("span"); span.textContent = "prompt → ";
      if (p[2]) { span.append(c.b[0]); var kw = document.createElement("span"); kw.className = "kw"; kw.textContent = c.b[1]; span.appendChild(kw); span.append(c.b[2]); }
      else span.append(c.a);
      cap.appendChild(span); pane.appendChild(cap); dualBlock.appendChild(pane); watch(v);
    });
    dualDots.querySelectorAll("i").forEach(function (d, i) { d.classList.toggle("on", i === di); });
    var vs = Array.prototype.slice.call(dualBlock.querySelectorAll("video"));
    vs[0].addEventListener("timeupdate", function () { follow(vs[0], vs.slice(1), 0.25); });
    // the three panes are one comparison: any pane's button pauses / resumes all three
    dualBlock.querySelectorAll(".vwrap").forEach(function (w) { ppButton(w, vs); });
  }
  document.querySelectorAll("#dualNav .arrow").forEach(function (b) {
    b.onclick = function () { di = (di + parseInt(b.dataset.dir, 10) + DUAL.length) % DUAL.length; renderDual(); };
  });
  renderDual();

  /* ---------------- players with 1x / 2x / 4x ---------------- */
  document.querySelectorAll(".player").forEach(function (p) {
    var v = mkVideo(p.dataset.src + Q, true); p.appendChild(v);
    var bar = document.createElement("div"); bar.className = "bar";
    var lab = document.createElement("span"); lab.className = "lab"; lab.textContent = p.dataset.label || ""; bar.appendChild(lab);
    var rate = parseFloat(p.dataset.rate || "1");
    [1, 2, 4].forEach(function (r) {
      var b = document.createElement("button"); b.className = "speed" + (r === rate ? " on" : ""); b.textContent = r + "×"; b.dataset.r = r;
      b.onclick = function () { v.playbackRate = r; };
      bar.appendChild(b);
    });
    p.appendChild(bar);
    v.addEventListener("ratechange", function () { bar.querySelectorAll(".speed").forEach(function (x) { x.classList.toggle("on", parseFloat(x.dataset.r) === v.playbackRate); }); });
    v.addEventListener("loadedmetadata", function () { v.playbackRate = rate; });
    watch(v);
  });
  /* side-by-side players that must stay in step (stabilisation; clips are cut to the same length):
     the first video's clock leads, followers are nudged only on real drift and never around the loop point */
  document.querySelectorAll(".two[data-sync]").forEach(function (row) {
    var vs = row.querySelectorAll("video"), lead = vs[0];
    lead.addEventListener("timeupdate", function () {
      var t = lead.currentTime, d = lead.duration;
      if (!d || t < 0.5 || t > d - 0.5) return;
      follow(lead, Array.prototype.slice.call(vs, 1), 0.25);
    });
    vs.forEach(function (v) {
      v.addEventListener("ratechange", function () { vs.forEach(function (o) { if (o.playbackRate !== v.playbackRate) o.playbackRate = v.playbackRate; }); });
    });
  });
})();
