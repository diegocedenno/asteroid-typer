/* Reglas del juego, sin DOM: qué tecla vale para cada letra, a qué asteroide
   se apunta, cuándo aparece el siguiente, niveles, puntos, PPM y precisión.
   La vista (scene.js) y el bucle (main.js) solo leen este estado. */
(function () {
  "use strict";

  var App = (window.AsteroidTyper = window.AsteroidTyper || {});

  var LIVES = 3;
  var WORDS_PER_LEVEL = 8;

  // Probabilidad de cada grupo de longitud según el nivel (fila = nivel − 1).
  var TIER_WEIGHTS = [
    [0.8, 0.2, 0, 0],
    [0.55, 0.4, 0.05, 0],
    [0.35, 0.45, 0.2, 0],
    [0.2, 0.45, 0.3, 0.05],
    [0.1, 0.4, 0.38, 0.12],
    [0.05, 0.3, 0.42, 0.23],
    [0.03, 0.22, 0.42, 0.33],
    [0, 0.15, 0.4, 0.45],
  ];

  /* ---------- letras ---------- */

  /* Política de tildes: la vocal sin tilde vale por la acentuada (y al revés),
     para no castigar a quien no tiene teclas muertas a mano. La ñ es otra
     letra: "n" no vale por "ñ". */
  function fold(ch) {
    var lower = ch.toLowerCase();
    if (lower === "ñ") return lower;
    return lower.normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  var LETTER = /^\p{L}$/u;

  // Los acentos sueltos de una tecla muerta (´ ` ¨ ^) no son letras: se ignoran.
  function isLetter(ch) {
    return LETTER.test(ch);
  }

  /* ---------- niveles ---------- */

  function levelFor(destroyed) {
    return 1 + Math.floor(destroyed / WORDS_PER_LEVEL);
  }

  function tierWeights(level) {
    return TIER_WEIGHTS[Math.min(Math.max(level, 1), TIER_WEIGHTS.length) - 1];
  }

  // Cada nivel: caída un 7 % más rápida y un 10 % más de asteroides, con tope.
  function levelConfig(level, calm) {
    var fall = Math.max(6, 14 * Math.pow(0.93, level - 1));
    var every = Math.max(0.85, 2.2 * Math.pow(0.9, level - 1));
    if (calm) {
      fall *= 1.6;
      every *= 1.4;
    }
    return {
      fallMs: fall * 1000,
      spawnMs: every * 1000,
      maxActive: Math.min(3 + level, 8),
      weights: tierWeights(level),
    };
  }

  /* ---------- marcador ---------- */

  // El combo (palabras seguidas sin fallo) suma un 10 % por palabra, hasta ×2.
  function wordScore(length, level, combo) {
    var streak = Math.min(Math.max(combo - 1, 0), 10);
    return Math.round(length * 10 * (1 + streak * 0.1)) + (level - 1) * 5;
  }

  // Palabras por minuto con la "palabra" estándar de 5 caracteres.
  function wpm(correctChars, elapsedMs) {
    if (elapsedMs <= 0) return 0;
    return correctChars / 5 / (elapsedMs / 60000);
  }

  function accuracy(hits, misses) {
    var total = hits + misses;
    return total ? (hits / total) * 100 : 100;
  }

  /* ---------- elección de palabra y objetivo ---------- */

  function weightedIndex(weights, r) {
    var acc = 0;
    for (var i = 0; i < weights.length; i++) {
      acc += weights[i];
      if (r < acc) return i;
    }
    return weights.length - 1;
  }

  /* Elige palabra del grupo sorteado. Primero exige inicial libre y que no
     haya salido hace poco; si no hay, relaja lo reciente y, solo al final,
     acepta repetir inicial. */
  function pickWord(tiers, weights, taken, recent, random) {
    var first = weightedIndex(weights, random());
    var order = [0, 1, 2, 3].sort(function (a, b) {
      return Math.abs(a - first) - Math.abs(b - first);
    });

    for (var relax = 0; relax < 3; relax++) {
      for (var k = 0; k < order.length; k++) {
        var candidates = tiers[order[k]].filter(function (word) {
          if (relax < 2 && taken[fold(word[0])]) return false;
          if (relax < 1 && recent.indexOf(word) !== -1) return false;
          return true;
        });
        if (candidates.length) return candidates[Math.floor(random() * candidates.length)];
      }
    }
    return tiers[0][0];
  }

  // El asteroide más cercano a la nave cuya palabra empieza por esa letra.
  function findTarget(asteroids, letter) {
    var best = null;
    for (var i = 0; i < asteroids.length; i++) {
      var a = asteroids[i];
      if (a.folded[0] === letter && (!best || a.t > best.t)) best = a;
    }
    return best;
  }

  /* ---------- partida ---------- */

  function createGame(options) {
    var tiers = options.tiers;
    var calm = Boolean(options.calm);
    var random = options.random || Math.random;
    var cap = options.cap || function () {
      return 8;
    };

    var config = levelConfig(1, calm);
    var spawnIn = 400;
    var nextId = 1;
    var recent = [];

    var game = {
      asteroids: [],
      target: null,
      score: 0,
      level: 1,
      lives: LIVES,
      destroyed: 0,
      hits: 0,
      misses: 0,
      combo: 0,
      bestCombo: 0,
      elapsed: 0,
      over: false,
    };

    /* Columna de salida (0–1): de doce candidatas repartidas por el ancho, la
       más alejada de los asteroides que acaban de entrar, que son los únicos
       con los que su palabra podría pisarse. */
    function pickColumn() {
      var best = 0.5;
      var bestGap = -1;
      var shift = random();
      for (var i = 0; i < 12; i++) {
        var x = (i + shift) / 12;
        var gap = 1;
        for (var k = 0; k < game.asteroids.length; k++) {
          var other = game.asteroids[k];
          if (other.t < 0.3) gap = Math.min(gap, Math.abs(other.x - x));
        }
        gap += random() * 0.05; // desempate: que no salgan siempre por los bordes
        if (gap > bestGap) {
          bestGap = gap;
          best = x;
        }
      }
      return best;
    }

    function spawn() {
      var taken = {};
      game.asteroids.forEach(function (a) {
        taken[a.folded[0]] = true;
      });
      var word = pickWord(tiers, config.weights, taken, recent, random);
      recent.push(word);
      if (recent.length > 24) recent.shift();

      var letters = Array.from(word);
      var asteroid = {
        id: nextId++,
        word: word,
        letters: letters,
        folded: letters.map(fold),
        typed: 0,
        x: pickColumn(),
        t: 0,
        // Las palabras largas reciben un poco más de tiempo de caída.
        fallMs: config.fallMs * (0.94 + random() * 0.12) * (1 + Math.max(0, letters.length - 6) * 0.03),
        seed: Math.floor(random() * 1e9),
      };
      game.asteroids.push(asteroid);
      return asteroid;
    }

    function remove(asteroid) {
      var index = game.asteroids.indexOf(asteroid);
      if (index !== -1) game.asteroids.splice(index, 1);
      if (game.target === asteroid) game.target = null;
    }

    game.step = function (dt) {
      var events = [];
      if (game.over) return events;
      game.elapsed += dt;

      for (var i = game.asteroids.length - 1; i >= 0; i--) {
        var a = game.asteroids[i];
        a.t += dt / a.fallMs;
        if (a.t < 1) continue;
        remove(a);
        game.lives--;
        game.combo = 0;
        events.push({ type: "impact", asteroid: a });
        if (game.lives <= 0) {
          game.over = true;
          events.push({ type: "over" });
          return events;
        }
      }

      spawnIn -= dt;
      // Campo vacío: el siguiente llega enseguida, para no frenar a quien teclea rápido.
      if (!game.asteroids.length) spawnIn = Math.min(spawnIn, 350);
      if (spawnIn <= 0) {
        if (game.asteroids.length < Math.min(config.maxActive, cap())) {
          events.push({ type: "spawn", asteroid: spawn() });
          spawnIn = config.spawnMs * (0.85 + random() * 0.3);
        } else {
          spawnIn = 300;
        }
      }
      return events;
    };

    game.type = function (ch) {
      if (game.over || !isLetter(ch)) return { type: "ignore" };
      var letter = fold(ch);
      var locked = false;

      if (!game.target) {
        game.target = findTarget(game.asteroids, letter);
        locked = Boolean(game.target);
      }

      var a = game.target;
      if (!a || a.folded[a.typed] !== letter) {
        game.misses++;
        game.combo = 0;
        return { type: "miss", asteroid: a };
      }

      a.typed++;
      game.hits++;
      if (a.typed < a.folded.length) return { type: "hit", asteroid: a, locked: locked };

      remove(a);
      game.destroyed++;
      game.combo++;
      game.bestCombo = Math.max(game.bestCombo, game.combo);
      var points = wordScore(a.folded.length, game.level, game.combo);
      game.score += points;

      var level = levelFor(game.destroyed);
      var levelUp = level > game.level;
      if (levelUp) {
        game.level = level;
        config = levelConfig(level, calm);
      }
      return { type: "destroy", asteroid: a, points: points, levelUp: levelUp, locked: locked };
    };

    // Soltar el objetivo también borra lo tecleado en él.
    game.release = function () {
      var a = game.target;
      if (!a) return null;
      a.typed = 0;
      game.target = null;
      return a;
    };

    game.wpm = function () {
      return wpm(game.hits, game.elapsed);
    };

    game.accuracy = function () {
      return accuracy(game.hits, game.misses);
    };

    return game;
  }

  App.logic = {
    LIVES: LIVES,
    WORDS_PER_LEVEL: WORDS_PER_LEVEL,
    fold: fold,
    isLetter: isLetter,
    levelFor: levelFor,
    levelConfig: levelConfig,
    tierWeights: tierWeights,
    wordScore: wordScore,
    wpm: wpm,
    accuracy: accuracy,
    pickWord: pickWord,
    findTarget: findTarget,
  };
  App.createGame = createGame;
})();
