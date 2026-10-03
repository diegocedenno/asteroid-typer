/* Escena: dibuja en SVG lo que dice game.js. Cada asteroide es un grupo con
   una roca low-poly generada, su palabra y `data-word`; por frame solo se
   escribe `transform`. El viewBox mide lo mismo que el contenedor en píxeles,
   así que el texto nunca se escala por debajo de su tamaño real.
   Con prefers-reduced-motion los asteroides siguen cayendo (es la mecánica),
   pero no giran y las destrucciones son fundidos: sin fragmentos ni sacudidas. */
(function () {
  "use strict";

  var App = (window.AsteroidTyper = window.AsteroidTyper || {});
  var SVG_NS = "http://www.w3.org/2000/svg";
  var TAU = Math.PI * 2;

  var DOME = 54; // radio del escudo, igual que el arco dibujado en index.html
  var NOSE = 27; // del centro de la nave a la punta
  var CHAR = 8.4; // avance de JetBrains Mono a 14 px
  var STONE = ["#2b323b", "#3a424c", "#4a525c", "#5d6570", "#768390", "#909dab"];
  var PLUTO = ["#3b2f26", "#5a4535", "#7a5a42", "#8a6548", "#a67d5c", "#c9a27e"];
  var EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
  var EASE_IN = "cubic-bezier(0.55, 0, 1, 0.45)";
  var EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";

  function node(name, attrs, parent) {
    var el = document.createElementNS(SVG_NS, name);
    for (var key in attrs) el.setAttribute(key, attrs[key]);
    if (parent) parent.appendChild(el);
    return el;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function reduced() {
    return window.Pluton && window.Pluton.reducedMotion();
  }

  function fadeAndRemove(el, from, duration, easing) {
    var anim = el.animate([{ opacity: from }, { opacity: 0 }], {
      duration: duration,
      easing: easing || EASE_OUT,
      fill: "forwards",
    });
    anim.onfinish = function () {
      el.remove();
    };
  }

  App.createScene = function (options) {
    var field = options.field;
    var svg = options.svg;
    var layer = svg.querySelector("#asteroids");
    var fx = svg.querySelector("#fx");
    var rings = svg.querySelectorAll("#rings circle");
    var shipEl = svg.querySelector("#ship");
    var rotor = svg.querySelector("#ship-rotor");
    var shield = svg.querySelector("#shield");
    var aim = svg.querySelector("#aim");

    var W = 0;
    var H = 0;
    var small = false;
    var ship = { x: 0, y: 0 };
    var views = {}; // id de asteroide → sus elementos
    var heading = 0; // grados; 0 = nave vertical
    var drawnHeading = null;
    var hold = 0; // ms que la nave mantiene el rumbo del último disparo
    var targetId = 0;

    /* ---------- geometría ---------- */

    function bearing(v) {
      return clamp((Math.atan2(v.x - ship.x, ship.y - v.y) * 180) / Math.PI, -80, 80);
    }

    function nose() {
      var rad = (heading * Math.PI) / 180;
      return { x: ship.x + Math.sin(rad) * NOSE, y: ship.y - Math.cos(rad) * NOSE };
    }

    /* Recta desde el borde superior hasta el escudo. El avance no es lineal:
       p = t·(0,7 + 0,3·t) arranca más lento (da tiempo a leer la palabra) y
       acelera al acercarse, como si la nave tirase del asteroide. */
    function place(a, v, dt) {
      var margin = v.half + 8;
      var sx = margin + a.x * Math.max(0, W - margin * 2);
      var sy = -v.r - 6;
      var dx = sx - ship.x;
      var dy = sy - ship.y;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var stop = DOME + v.r * 0.7;
      var ex = ship.x + (dx / dist) * stop;
      var ey = ship.y + (dy / dist) * stop;
      var p = Math.min(a.t, 1) * (0.7 + 0.3 * Math.min(a.t, 1));

      v.x = sx + (ex - sx) * p;
      v.y = sy + (ey - sy) * p;
      v.g.setAttribute("transform", "translate(" + v.x.toFixed(2) + " " + v.y.toFixed(2) + ")");

      if (v.stale) {
        // La estela apunta hacia atrás en la dirección de caída; solo cambia al redimensionar.
        var tilt = (Math.atan2(dx / dist, -dy / dist) * 180) / Math.PI;
        v.tail.setAttribute("transform", "rotate(" + tilt.toFixed(1) + ")");
        v.stale = false;
      }
      if (dt && !reduced()) {
        v.angle = (v.angle + (v.spin * dt) / 1000) % 360;
        v.rock.setAttribute("transform", "rotate(" + v.angle.toFixed(1) + ")");
      }
    }

    function resize() {
      var rect = field.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      drawnHeading = null;
      W = rect.width;
      H = rect.height;
      small = W < 520;
      svg.setAttribute("viewBox", "0 0 " + W.toFixed(1) + " " + H.toFixed(1));
      ship.x = W / 2;
      ship.y = H - 46;
      shipEl.setAttribute("transform", "translate(" + ship.x.toFixed(1) + " " + ship.y.toFixed(1) + ")");

      // Anillos de alcance alrededor de la nave: el motivo de órbita punteada.
      var reach = Math.sqrt(ship.x * ship.x + ship.y * ship.y);
      for (var i = 0; i < rings.length; i++) {
        rings[i].setAttribute("cx", ship.x.toFixed(1));
        rings[i].setAttribute("cy", ship.y.toFixed(1));
        rings[i].setAttribute("r", (DOME + ((reach - DOME) * (i + 1)) / (rings.length + 0.4)).toFixed(1));
      }
      for (var id in views) views[id].stale = true;
      if (options.onResize) options.onResize();
    }

    /* ---------- asteroides ---------- */

    function build(a) {
      var rand = window.Pluton.random(a.seed);
      var count = a.letters.length;
      var r = clamp(17 + count * 1.6, 22, 35) * (small ? 0.82 : 1);
      var half = (count * CHAR + 18) / 2;
      var palette = rand() < 0.4 ? PLUTO : STONE;

      var g = node("g", { class: "asteroid", "data-id": a.id, "data-word": a.word, "data-typed": 0 }, layer);
      var tail = node(
        "path",
        { class: "ast-tail", d: "M" + (-r * 0.5).toFixed(1) + " 0 L0 " + (-r * 3.6).toFixed(1) + " L" + (r * 0.5).toFixed(1) + " 0 Z" },
        g
      );
      var rock = node("g", { class: "ast-rock" }, g);

      // Contorno irregular y un centro desplazado: cada cara es un triángulo
      // centro–vértice–vértice, sombreado según mire o no hacia la luz.
      var sides = 7 + Math.floor(rand() * 4);
      var points = [];
      for (var i = 0; i < sides; i++) {
        var angle = ((i + (rand() - 0.5) * 0.55) / sides) * TAU;
        var radius = r * (0.74 + rand() * 0.34);
        points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
      }
      var hub = [(rand() - 0.5) * r * 0.35, (rand() - 0.5) * r * 0.35];
      var facets = [];
      for (var k = 0; k < sides; k++) {
        var p = points[k];
        var q = points[(k + 1) % sides];
        var mx = (p[0] + q[0]) / 2 - hub[0];
        var my = (p[1] + q[1]) / 2 - hub[1];
        var ml = Math.sqrt(mx * mx + my * my) || 1;
        var light = (mx * -0.55 + my * -0.83) / ml; // luz desde arriba a la izquierda
        var tone = clamp(Math.round(((light + 1) / 2) * 5 + (rand() - 0.5) * 0.9), 0, 5);
        var d =
          "M" + hub[0].toFixed(1) + " " + hub[1].toFixed(1) +
          "L" + p[0].toFixed(1) + " " + p[1].toFixed(1) +
          "L" + q[0].toFixed(1) + " " + q[1].toFixed(1) + "Z";
        facets.push({ el: node("path", { class: "ast-facet", d: d, fill: palette[tone] }, rock), dx: mx / ml, dy: my / ml });
      }

      node("circle", { class: "ast-ring", r: (r + 7).toFixed(1) }, g);

      var label = node("g", { class: "ast-label", transform: "translate(0 " + (r + 18).toFixed(1) + ")" }, g);
      var box = { x: -half, y: -11, width: half * 2, height: 22, rx: 11 };
      box.class = "ast-pill";
      node("rect", box, label);
      box.class = "ast-flash";
      var flash = node("rect", box, label);
      var text = node("text", { class: "ast-word", "text-anchor": "middle", "dominant-baseline": "central", y: 0.5 }, label);
      var done = node("tspan", { class: "ast-done" }, text);
      var rest = node("tspan", { class: "ast-rest" }, text);
      rest.textContent = a.word;

      return {
        g: g,
        rock: rock,
        tail: tail,
        facets: facets,
        flash: flash,
        done: done,
        rest: rest,
        r: r,
        half: half,
        angle: rand() * 360,
        spin: (rand() - 0.5) * 44,
        x: 0,
        y: 0,
        stale: true,
      };
    }

    function add(a) {
      var v = build(a);
      views[a.id] = v;
      v.rock.setAttribute("transform", "rotate(" + v.angle.toFixed(1) + ")");
      place(a, v, 0);
    }

    // Deja de ser un asteroide "vivo": ya no lo encuentra quien busque data-word.
    function detach(a) {
      var v = views[a.id];
      if (!v) return null;
      delete views[a.id];
      if (targetId === a.id) setTarget(null);
      v.g.setAttribute("class", "debris");
      v.g.removeAttribute("data-word");
      return v;
    }

    function progress(a) {
      var v = views[a.id];
      if (!v) return;
      v.done.textContent = a.letters.slice(0, a.typed).join("");
      v.rest.textContent = a.letters.slice(a.typed).join("");
      v.g.setAttribute("data-typed", a.typed);
    }

    function setTarget(a) {
      var id = a ? a.id : 0;
      if (id === targetId) return;
      if (views[targetId]) views[targetId].g.classList.remove("is-target");
      targetId = id;
      aim.classList.toggle("is-on", Boolean(id && views[id]));
      if (id && views[id]) {
        views[id].g.classList.add("is-target");
        layer.appendChild(views[id].g); // el objetivo se pinta encima del resto
      }
    }

    /* ---------- frame ---------- */

    function sync(asteroids, target, dt) {
      for (var i = 0; i < asteroids.length; i++) {
        var v = views[asteroids[i].id];
        if (v) place(asteroids[i], v, dt);
      }
      setTarget(target);

      var tv = target ? views[target.id] : null;
      var goal = tv ? bearing(tv) : 0;
      // La nave gira hacia el objetivo con un seguimiento exponencial (sin saltos),
      // pero aguanta un instante el rumbo del disparo que acaba de hacer.
      // Con movimiento reducido no hay giro animado: la nave cambia de rumbo de golpe.
      hold = Math.max(0, hold - dt);
      if (!hold) heading = reduced() || !dt ? goal : heading + (goal - heading) * (1 - Math.exp(-dt / 110));
      if (drawnHeading === null || Math.abs(heading - drawnHeading) > 0.02) {
        rotor.setAttribute("transform", "rotate(" + heading.toFixed(2) + ")");
        drawnHeading = heading;
      }

      if (tv) {
        // Línea de puntería: un segmento unitario colocado solo con transform.
        var from = nose();
        var dx = tv.x - from.x;
        var dy = tv.y - from.y;
        var length = Math.max(0, Math.sqrt(dx * dx + dy * dy) - tv.r - 9);
        var angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        aim.setAttribute(
          "transform",
          "translate(" + from.x.toFixed(1) + " " + from.y.toFixed(1) + ") rotate(" + angle.toFixed(2) + ") scale(" + length.toFixed(1) + " 1)"
        );
      }
    }

    /* ---------- efectos ---------- */

    function destroy(a, points) {
      var v = detach(a);
      if (!v) return;
      var calm = reduced();

      // Láser de la punta de la nave al asteroide: la nave apunta a donde dispara.
      heading = bearing(v);
      hold = 260;
      drawnHeading = heading;
      rotor.setAttribute("transform", "rotate(" + heading.toFixed(2) + ")");
      var from = nose();
      var beam = node("g", { class: "beam" }, fx);
      var ends = { x1: from.x.toFixed(1), y1: from.y.toFixed(1), x2: v.x.toFixed(1), y2: v.y.toFixed(1) };
      node("line", ends, beam);
      ends.class = "beam-core";
      node("line", ends, beam);
      fadeAndRemove(beam, 1, calm ? 220 : 420, EASE_IN);

      // Los puntos ganados, sobre el asteroide (o debajo si está pegado al borde).
      var popY = v.y - v.r - 12 < 18 ? v.y + v.r + 22 : v.y - v.r - 12;
      var pop = node("text", { class: "pop", x: v.x.toFixed(1), y: popY.toFixed(1), "text-anchor": "middle" }, fx);
      pop.textContent = "+" + points;

      if (calm) {
        fadeAndRemove(v.g, 1, 200);
        fadeAndRemove(pop, 1, 900, EASE_IN);
        return;
      }

      var rise = pop.animate(
        [
          { transform: "translateY(8px)", opacity: 0, easing: EASE_OUT },
          { transform: "translateY(0)", opacity: 1, offset: 0.15, easing: EASE_IN_OUT },
          { transform: "translateY(-8px)", opacity: 1, offset: 0.65, easing: EASE_IN },
          { transform: "translateY(-18px)", opacity: 0 },
        ],
        { duration: 1000, fill: "forwards" }
      );
      rise.onfinish = function () {
        pop.remove();
      };

      var wave = node("circle", { class: "wave", cx: v.x.toFixed(1), cy: v.y.toFixed(1), r: v.r.toFixed(1) }, fx);
      var ripple = wave.animate(
        [
          { transform: "scale(0.7)", opacity: 0.8 },
          { transform: "scale(2.1)", opacity: 0 },
        ],
        { duration: 520, easing: EASE_OUT, fill: "forwards" }
      );
      ripple.onfinish = function () {
        wave.remove();
      };

      // La roca se rompe por sus propias caras: cada triángulo sale despedido.
      var rand = window.Pluton.random(a.seed + 1);
      v.facets.forEach(function (facet) {
        var reach = v.r * (1.1 + rand() * 1.5);
        var duration = 620 + rand() * 260;
        // Dos animaciones: el vuelo frena (ease-out) y la opacidad aguanta y cae al final.
        facet.el.animate(
          [
            { transform: "translate(0, 0) rotate(0deg)" },
            {
              transform:
                "translate(" + (facet.dx * reach).toFixed(1) + "px, " + (facet.dy * reach).toFixed(1) + "px) rotate(" + ((rand() - 0.5) * 300).toFixed(0) + "deg)",
            },
          ],
          { duration: duration, easing: EASE_OUT, fill: "forwards" }
        );
        facet.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration, easing: EASE_IN, fill: "forwards" });
      });
      window.setTimeout(function () {
        v.g.remove();
      }, 920);
    }

    function impact(a) {
      var v = detach(a);
      if (v) fadeAndRemove(v.g, 1, 320);

      var calm = reduced();
      shield.classList.add("is-hit");
      var blink = shield.animate(
        calm
          ? [{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }]
          : [{ opacity: 1 }, { opacity: 0.1 }, { opacity: 1 }, { opacity: 0.1 }, { opacity: 1 }, { opacity: 0.1 }, { opacity: 1 }],
        { duration: calm ? 500 : 760, easing: EASE_IN_OUT }
      );
      blink.onfinish = function () {
        shield.classList.remove("is-hit");
      };

      if (!calm) {
        svg.animate(
          [
            { transform: "translate(0, 0)" },
            { transform: "translate(-7px, 3px)" },
            { transform: "translate(6px, -2px)" },
            { transform: "translate(-3px, 1px)" },
            { transform: "translate(0, 0)" },
          ],
          { duration: 380, easing: EASE_IN_OUT }
        );
      }
    }

    // Fallo: un destello naranja en la etiqueta del objetivo, nada más.
    function miss(a) {
      var v = a ? views[a.id] : null;
      if (v) v.flash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, easing: EASE_OUT });
    }

    function lives(count) {
      shipEl.setAttribute("data-lives", count);
    }

    function clear() {
      layer.textContent = "";
      fx.textContent = "";
      views = {};
      targetId = 0;
      heading = 0;
      hold = 0;
      drawnHeading = null;
      aim.classList.remove("is-on");
      rotor.setAttribute("transform", "rotate(0)");
    }

    if (window.ResizeObserver) new ResizeObserver(resize).observe(field);
    else window.addEventListener("resize", resize);
    resize();

    return {
      add: add,
      progress: progress,
      target: setTarget,
      sync: sync,
      destroy: destroy,
      impact: impact,
      miss: miss,
      lives: lives,
      clear: clear,
      // Cuántos asteroides caben a la vez sin que las palabras se pisen.
      cap: function () {
        return clamp(Math.round((W * H) / 38000), 4, 8);
      },
    };
  };
})();
