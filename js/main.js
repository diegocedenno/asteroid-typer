/* Partida: bucle, entrada de texto, pantallas (inicio, pausa, fin), marcador
   y persistencia del récord. */
(function () {
  "use strict";

  var App = window.AsteroidTyper;
  var logic = App.logic;
  var STORE_KEY = "asteroid-typer:v1";
  var LANG_NAMES = { es: "español", en: "inglés", mix: "mixto" };
  var EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
  var EASE_IN = "cubic-bezier(0.55, 0, 1, 0.45)";

  /* El <input> nunca queda vacío: guarda un espacio centinela. Así un
     retroceso siempre produce un evento `input` (también en los teclados
     virtuales, que no envían keydown útiles) y sirve para soltar el objetivo. */
  var SENTINEL = " ";

  function $(id) {
    return document.getElementById(id);
  }

  var els = {
    stage: $("stage"),
    field: $("field"),
    status: $("status"),
    announce: $("announce"),
    score: $("hud-score"),
    level: $("hud-level"),
    words: $("hud-words"),
    wpm: $("hud-wpm"),
    accuracy: $("hud-accuracy"),
    best: $("hud-best"),
    lives: $("hud-lives"),
    livesText: $("hud-lives-text"),
    levelUp: $("level-up"),
    levelUpNum: $("level-up-num"),
    screens: { menu: $("screen-start"), paused: $("screen-pause"), over: $("screen-over") },
    calm: $("calm"),
    bestLine: $("best-line"),
    start: $("start"),
    resume: $("resume"),
    quit: $("quit"),
    again: $("again"),
    menu: $("menu"),
    badge: $("record-badge"),
    entry: $("entry"),
    entryBox: $("entry-box"),
    typed: $("typed"),
    ghost: $("ghost"),
    combo: $("combo"),
    pause: $("pause"),
  };

  var state = "menu"; // menu | playing | paused | over
  var game = null;
  var frame = 0;
  var lastFrame = 0;
  var hudAt = 0;
  var overAt = 0;
  var overTimer = 0;
  var seen = SENTINEL; // último valor del <input> ya procesado

  function reduced() {
    return window.Pluton.reducedMotion();
  }

  /* ---------- persistencia ---------- */

  function count(value) {
    return typeof value === "number" && isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  function load() {
    var data = null;
    try {
      data = JSON.parse(window.localStorage.getItem(STORE_KEY) || "null");
    } catch (err) {
      data = null;
    }
    var best = (data && data.best) || {};
    return {
      best: { score: count(best.score), wpm: count(best.wpm), level: count(best.level) },
      lang: data && App.words.languages.indexOf(data.lang) !== -1 ? data.lang : "es",
      calm: Boolean(data && data.calm === true),
    };
  }

  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (err) {
      /* almacenamiento no disponible: se juega igual, solo no se guarda el récord */
    }
  }

  var store = load();

  /* ---------- vista ---------- */

  function fmt(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function percent(n) {
    return Math.round(n) + " %";
  }

  function setStatus(label, text) {
    els.status.innerHTML = "";
    els.status.append(label + ": ");
    var strong = document.createElement("b");
    strong.textContent = text;
    els.status.appendChild(strong);
  }

  function announce(text) {
    els.announce.textContent = text;
  }

  function renderHud() {
    var score = game ? game.score : 0;
    var lives = game ? game.lives : logic.LIVES;

    els.score.textContent = fmt(score);
    els.level.textContent = game ? game.level : 1;
    els.words.textContent = game ? game.destroyed : 0;
    els.wpm.textContent = game ? Math.round(game.wpm()) : 0;
    els.accuracy.textContent = percent(game ? game.accuracy() : 100);

    // El récord se va actualizando en vivo en cuanto la partida lo supera.
    var beaten = score > store.best.score;
    els.best.textContent = beaten ? fmt(score) : store.best.score ? fmt(store.best.score) : "—";
    els.best.classList.toggle("is-beaten", beaten);

    var pips = els.lives.querySelectorAll("i");
    for (var i = 0; i < pips.length; i++) pips[i].classList.toggle("is-lost", i >= lives);
    els.livesText.textContent = lives + " de " + logic.LIVES;
  }

  function renderEntry() {
    var a = game && state !== "menu" ? game.target : null;
    els.typed.textContent = a ? a.letters.slice(0, a.typed).join("") : "";
    els.ghost.textContent = a ? a.letters.slice(a.typed).join("") : "";
    els.entryBox.classList.toggle("has-target", Boolean(a));

    var combo = game ? game.combo : 0;
    els.combo.hidden = combo < 2;
    els.combo.textContent = "combo ×" + combo;
  }

  function renderBest() {
    var best = store.best;
    els.bestLine.innerHTML = "";
    els.bestLine.append("récord: ");
    var strong = document.createElement("b");
    strong.textContent = best.score
      ? fmt(best.score) + " pts · " + (best.wpm ? best.wpm + " ppm · " : "") + "nivel " + Math.max(best.level, 1)
      : "sin partidas todavía";
    els.bestLine.appendChild(strong);
  }

  function setState(next) {
    state = next;
    els.stage.dataset.state = next;
    for (var name in els.screens) els.screens[name].hidden = name !== next;
    els.entry.disabled = next !== "playing";
    els.pause.disabled = next !== "playing";
    fitViewport();
  }

  function resetEntry() {
    els.entry.value = SENTINEL;
    seen = SENTINEL;
    // El cursor va detrás del centinela, para que un retroceso tenga qué borrar.
    if (document.activeElement === els.entry) els.entry.setSelectionRange(SENTINEL.length, SENTINEL.length);
  }

  /* Con el teclado en pantalla abierto apenas queda alto: se esconden cabecera
     y pie y el juego ocupa justo el viewport visible, con la nave y la caja de
     texto a la vista. */
  function fitViewport() {
    var viewport = window.visualViewport;
    var height = viewport ? viewport.height : window.innerHeight;
    var playing = state === "playing" || state === "paused";
    var compact = playing && height < 560 && window.innerWidth <= 860;
    document.documentElement.style.setProperty("--vvh", Math.round(height) + "px");
    if (compact !== document.body.classList.contains("is-compact")) {
      document.body.classList.toggle("is-compact", compact);
      if (compact) window.scrollTo(0, 0);
    }
  }

  /* ---------- escena ---------- */

  var scene = App.createScene({
    field: els.field,
    svg: $("scene"),
    onResize: function () {
      // En pausa no hay bucle: se recoloca todo a mano tras un cambio de tamaño.
      if (game && !frame) scene.sync(game.asteroids, game.target, 0);
    },
  });

  /* ---------- bucle ---------- */

  function tick(now) {
    frame = 0;
    var dt = Math.min(now - lastFrame, 100);
    lastFrame = now;

    var events = game.step(dt);
    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      if (event.type === "spawn") {
        scene.add(event.asteroid);
      } else if (event.type === "impact") {
        scene.impact(event.asteroid);
        scene.lives(game.lives);
        renderEntry();
        if (game.lives > 0) {
          announce("Impacto. " + (game.lives === 1 ? "Queda 1 vida." : "Quedan " + game.lives + " vidas."));
        }
      } else if (event.type === "over") {
        finish();
      }
    }

    scene.sync(game.asteroids, game.target, dt);
    if (events.length || now - hudAt > 250) {
      renderHud();
      hudAt = now;
    }
    if (state === "playing") frame = requestAnimationFrame(tick);
  }

  function run() {
    if (frame || state !== "playing" || document.hidden) return;
    lastFrame = performance.now();
    frame = requestAnimationFrame(tick);
  }

  function halt() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  /* ---------- estados ---------- */

  function flightStatus() {
    setStatus("status", "nivel " + game.level + " · " + (store.calm ? "modo calma" : "en vuelo"));
  }

  function start() {
    var checked = document.querySelector('input[name="lang"]:checked');
    store.lang = checked ? checked.value : "es";
    store.calm = els.calm.checked;
    save();

    window.clearTimeout(overTimer);
    game = App.createGame({ tiers: App.words.lists[store.lang], calm: store.calm, cap: scene.cap });
    scene.clear();
    scene.lives(game.lives);
    setState("playing");
    renderHud();
    renderEntry();
    flightStatus();
    announce("Partida en marcha. Palabras en " + LANG_NAMES[store.lang] + ".");
    els.entry.focus({ preventScroll: true });
    resetEntry();
    run();
  }

  function pause() {
    if (state !== "playing") return;
    halt();
    setState("paused");
    setStatus("status", "en pausa");
    announce("Partida en pausa.");
    els.resume.focus({ preventScroll: true });
  }

  function resume() {
    if (state !== "paused") return;
    setState("playing");
    flightStatus();
    announce("Partida reanudada.");
    els.entry.focus({ preventScroll: true });
    resetEntry();
    run();
  }

  function finish(immediate) {
    halt();
    release();
    var isRecord = game.score > store.best.score;
    var wpm = Math.round(game.wpm());

    store.best.score = Math.max(store.best.score, game.score);
    store.best.level = Math.max(store.best.level, game.level);
    // El PPM solo cuenta como récord con una muestra mínima de palabras.
    if (game.destroyed >= 5) store.best.wpm = Math.max(store.best.wpm, wpm);
    save();

    $("sum-score").textContent = fmt(game.score);
    $("sum-level").textContent = game.level;
    $("sum-words").textContent = game.destroyed;
    $("sum-wpm").textContent = wpm;
    $("sum-accuracy").textContent = percent(game.accuracy());
    $("sum-combo").textContent = game.bestCombo;
    els.badge.hidden = !isRecord;

    state = "over";
    els.stage.dataset.state = "over";
    els.entry.disabled = true;
    els.pause.disabled = true;
    els.screens.paused.hidden = true;
    renderHud();
    renderEntry();
    renderBest();
    setStatus("status", isRecord ? "fin de partida · nuevo récord" : "fin de partida");
    announce(
      "Fin de partida. " + fmt(game.score) + " puntos, nivel " + game.level + ", " + wpm +
        " palabras por minuto, precisión " + Math.round(game.accuracy()) + " por ciento." +
        (isRecord ? " Nuevo récord." : "")
    );

    // Un respiro para ver el último impacto antes del resumen.
    overAt = performance.now();
    overTimer = window.setTimeout(function () {
      setState("over");
      els.again.focus({ preventScroll: true });
    }, immediate ? 0 : reduced() ? 200 : 750);
  }

  function toMenu() {
    halt();
    window.clearTimeout(overTimer);
    game = null;
    scene.clear();
    scene.lives(logic.LIVES);
    setState("menu");
    renderHud();
    renderEntry();
    renderBest();
    setStatus("status", "listo para despegar");
    els.start.focus({ preventScroll: true });
  }

  /* ---------- tecleo ---------- */

  function nudge() {
    if (!els.entryBox.animate) return;
    els.entryBox.animate(
      reduced()
        ? [{ opacity: 0.55 }, { opacity: 1 }]
        : [
            { transform: "translateX(0)" },
            { transform: "translateX(-4px)" },
            { transform: "translateX(3px)" },
            { transform: "translateX(0)" },
          ],
      { duration: 240, easing: "cubic-bezier(0.65, 0, 0.35, 1)" }
    );
  }

  function levelUp() {
    els.levelUpNum.textContent = (game.level < 10 ? "0" : "") + game.level;
    els.levelUp.animate(
      // El easing va en cada tramo: entra frenando, espera y sale acelerando.
      reduced()
        ? [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }]
        : [
            { opacity: 0, transform: "translateY(16px)", easing: EASE_OUT },
            { opacity: 1, transform: "translateY(0)", offset: 0.2 },
            { opacity: 1, transform: "translateY(0)", offset: 0.75, easing: EASE_IN },
            { opacity: 0, transform: "translateY(-12px)" },
          ],
      { duration: 1800 }
    );
    flightStatus();
    announce("Nivel " + game.level + ".");
  }

  function typeChar(ch) {
    var result = game.type(ch);
    if (result.type === "hit") {
      scene.progress(result.asteroid);
    } else if (result.type === "miss") {
      scene.miss(result.asteroid);
      nudge();
    } else if (result.type === "destroy") {
      scene.destroy(result.asteroid, result.points);
      if (result.levelUp) levelUp();
    }
    scene.target(game.target); // sin esperar al siguiente frame
  }

  function release() {
    var asteroid = game && game.release();
    if (!asteroid) return;
    scene.progress(asteroid);
    scene.target(null);
  }

  /* El texto llega por el evento `input`, no por keydown: así funcionan las
     teclas muertas (´ + a → á), los métodos de composición y los teclados
     virtuales. Se compara el valor con el último procesado y solo se teclea
     lo nuevo; si el valor se acorta, fue un retroceso. */
  els.entry.addEventListener("input", function (event) {
    var value = els.entry.value;
    if (state !== "playing") {
      resetEntry();
      return;
    }

    var common = 0;
    while (common < seen.length && common < value.length && seen[common] === value[common]) common++;
    var deleting = String(event.inputType || "").indexOf("delete") === 0 || (value.length < seen.length && common === value.length);

    if (deleting) {
      release();
    } else {
      var added = Array.from(value.slice(common));
      for (var i = 0; i < added.length && state === "playing"; i++) typeChar(added[i]);
    }
    seen = value;

    // A mitad de una composición no se toca el valor: se limpia al terminarla.
    if (!event.isComposing) resetEntry();
    renderEntry();
    renderHud();
  });

  els.entry.addEventListener("compositionend", resetEntry);

  els.entry.addEventListener("keydown", function (event) {
    if (event.key === "Backspace") {
      event.preventDefault();
      release();
      renderEntry();
    } else if (event.key === "Enter") {
      event.preventDefault();
    }
  });

  // Perder el foco (otra ventana, Tab, tocar fuera) pausa la partida.
  els.entry.addEventListener("blur", pause);
  window.addEventListener("blur", pause);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) pause();
  });

  // Un clic en el campo de juego no debe robar el foco a la caja de texto.
  els.stage.addEventListener("mousedown", function (event) {
    if (state === "playing" && !event.target.closest("button, input, label")) event.preventDefault();
  });

  // El interruptor de tema tampoco: cambiar de tema a media partida no la pausa
  // y se puede seguir tecleando sin soltar nada.
  var themeToggle = document.querySelector("[data-theme-toggle]");
  if (themeToggle) {
    themeToggle.addEventListener("mousedown", function (event) {
      if (state === "playing") event.preventDefault();
    });
  }

  /* ---------- controles ---------- */

  // Clic de ratón o dedo (detail > 0): se suelta el foco del botón para que
  // un Enter posterior no lo repita.
  function onClick(button, action) {
    button.addEventListener("click", function (event) {
      if (event.detail > 0) button.blur();
      action();
    });
  }

  onClick(els.start, start);
  onClick(els.again, start);
  onClick(els.resume, resume);
  onClick(els.pause, pause);
  onClick(els.menu, toMenu);
  onClick(els.quit, function () {
    if (state === "paused") finish(true);
  });

  document.addEventListener("keydown", function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    var target = event.target;
    var onControl = target instanceof Element && target.closest("button, a") && target.matches(":focus-visible");

    if (event.key === "Escape") {
      if (state === "playing") {
        event.preventDefault();
        // Con un asteroide fijado, Esc lo suelta; sin objetivo, pausa.
        if (game.target) {
          release();
          renderEntry();
        } else {
          pause();
        }
      } else if (state === "paused") {
        event.preventDefault();
        resume();
      }
      return;
    }

    // Si alguien navega con Tab, Enter activa el control enfocado.
    if (event.key !== "Enter" || onControl) return;
    if (state === "menu") {
      event.preventDefault();
      start();
    } else if (state === "paused") {
      event.preventDefault();
      resume();
    } else if (state === "over" && !els.screens.over.hidden && performance.now() - overAt > 500) {
      event.preventDefault();
      start();
    }
  });

  document.querySelectorAll('input[name="lang"]').forEach(function (radio) {
    radio.checked = radio.value === store.lang;
    radio.addEventListener("change", function () {
      if (!radio.checked) return;
      store.lang = radio.value;
      save();
    });
  });

  els.calm.checked = store.calm;
  els.calm.addEventListener("change", function () {
    store.calm = els.calm.checked;
    save();
  });

  if (window.visualViewport) window.visualViewport.addEventListener("resize", fitViewport);
  window.addEventListener("resize", fitViewport);

  setState("menu");
  resetEntry();
  renderHud();
  renderEntry();
  renderBest();
})();
