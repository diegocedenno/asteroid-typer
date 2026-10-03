/* Listas de palabras, agrupadas por dificultad (0 = cortas … 3 = muy largas).
   El español lleva sus tildes y su ñ de verdad; la política de qué tecla vale
   para cada letra está en game.js (fold). Los nombres propios van en minúscula
   a propósito: en el juego no se usa Mayús. */
(function () {
  "use strict";

  var App = (window.AsteroidTyper = window.AsteroidTyper || {});

  // Rango de longitud de cada grupo; lo comprueba la validación del proyecto.
  var RANGES = [
    [3, 4],
    [5, 6],
    [7, 8],
    [9, 16],
  ];

  var es = [
    // 3–4 letras
    "sol luna mar luz gas ion eje red año día mes sur este nube nave cola polo halo masa onda " +
      "roca vía zona faro giro fase gema hilo isla kilo lago nodo orbe peso rayo sima tubo vela " +
      "yodo zinc alba cima duna eco foco guía hito iris jade cubo lupa mapa neón pico base ruta " +
      "ala arco boya cero dato hora aire agua azul frío gris rojo oro sal ola río uno dos tres " +
      "seis ocho diez cien mil",
    // 5–6 letras
    "tierra marte venus plutón cielo cometa fotón átomo astro cráter órbita cohete sonda radar " +
      "motor casco traje lunar solar polvo hielo magma vacío vapor rumbo nivel señal antena " +
      "anillo brillo cuásar púlsar plasma núcleo protón viento fuerza tiempo escudo láser misión " +
      "módulo piloto puerto viaje torre umbral cenit ocaso aurora boreal fusión fisión helio " +
      "litio hierro níquel ozono xenón argón metano océano espejo lente prisma campo carga pulso " +
      "banda clima niebla noche mañana sueño otoño cañón tamaño diseño norte oeste cabina tobera " +
      "empuje afelio cúmulo pársec sirio titán europa fobos ceres tritón apolo pegaso minuto " +
      "década kepler newton hubble lanzar flotar girar",
    // 7–8 letras
    "galaxia planeta estrella satélite nebulosa eclipse gravedad júpiter saturno mercurio " +
      "neptuno cinturón meteoro universo espacio cósmico cápsula despegue orbital impulso " +
      "energía materia neutrón electrón molécula estación lanzador turbina fuselaje oxígeno " +
      "infinito cuántico montaña pequeño compañía ventana brújula vértice espectro magnetar " +
      "latitud longitud altitud presión densidad volumen rotación trópico amanecer marciano " +
      "selenita paneles batería circuito sistema control comando mensaje destello tormenta " +
      "caronte géminis kriptón centauro casiopea escorpio acuario ignición crucero ecuador " +
      "segundo milenio estelar galileo voyager pionero viajero explorar navegar despegar " +
      "orbitar brillar añoranza",
    // 9 o más letras
    "asteroide constelación astronauta telescopio cosmonauta lanzamiento aterrizaje hidrógeno " +
      "nitrógeno horizonte equinoccio solsticio perihelio kilómetro tripulante comandante " +
      "ingeniero cuadrante crepúsculo anochecer criogenia radiación frecuencia relámpago " +
      "telemetría antimateria propulsor escotilla atmósfera estratosfera magnetosfera supernova " +
      "exoplaneta interestelar velocidad aceleración trayectoria gravitación observatorio " +
      "transbordador combustible navegación coordenadas turbulencia meteorito luminosidad " +
      "heliopausa astronomía astrofísica cosmología planetario microgravedad ingravidez " +
      "tripulación exploración descubrimiento galáctico hemisferio ecuatorial magnético " +
      "ultravioleta infrarrojo termómetro barómetro giroscopio paracaídas enseñanza andrómeda " +
      "meridiano aterrizar extraterrestre espectroscopio",
  ];

  var en = [
    // 3–4 letters
    "sun moon star mars gas ion sky orb ray arc axis base beam belt bolt core crew dark dawn " +
      "deck disk dome dust dusk east echo fire flux fuel glow halo heat hull iris jet keel lens " +
      "lift link mass mist nova node path peak pole port quad rock ring rise ship void wave " +
      "wind year zone zoom zero atom aura tide time tail tilt unit vent volt warp west yaw zinc " +
      "ice air day map pod rim fin gap hub lab log net ore",
    // 5–6 letters
    "earth venus pluto comet orbit probe rover solar lunar space light laser radar rocket " +
      "saturn uranus planet galaxy nebula quasar pulsar meteor crater cosmos photon proton " +
      "plasma helium oxygen carbon vacuum shield thrust engine module hatch cabin pilot flight " +
      "launch signal sensor vector zenith aurora corona fusion magma storm cloud frost glide " +
      "drift burst flare spark shine night north south giant dwarf binary object matter energy " +
      "speed apogee cargo radio relay array mirror prism focus pixel track range scope stage " +
      "tower titan europa ceres charon apollo kepler hubble newton canyon",
    // 7–8 letters
    "jupiter mercury neptune gravity eclipse capsule booster mission station landing liftoff " +
      "orbital sunspot starship asteroid universe galactic infinity velocity momentum particle " +
      "neutron electron molecule hydrogen nitrogen spectrum daylight twilight midnight sunrise " +
      "horizon equator latitude altitude pressure density antenna airlock cockpit thruster " +
      "parallax magnetar redshift compass console control payload reentry docking frontier " +
      "explorer voyager pioneer shuttle perigee crystal element isotope uranium silicon thermal " +
      "kinetic quantum wormhole ignition stellar meridian quadrant moonbeam sunlight skyline " +
      "cyclone glacier volcano plateau infrared",
    // 9 or more letters
    "satellite telescope astronaut cosmonaut supernova exoplanet atmosphere trajectory " +
      "radiation moonlight starlight constellation observatory spacecraft propulsion navigation " +
      "coordinate turbulence meteorite luminosity heliopause astronomy cosmology planetary " +
      "gravitation acceleration interstellar weightless exploration discovery hemisphere " +
      "equatorial ultraviolet gyroscope parachute telemetry combustion cryogenic frequency " +
      "wavelength magnetism stratosphere ionosphere magnetosphere astrophysics spaceflight " +
      "touchdown countdown afterburner centrifuge lightyear moonscape starburst singularity " +
      "terraform andromeda microgravity spectroscope extraterrestrial thermometer barometer",
  ];

  function split(groups) {
    return groups.map(function (group) {
      return group.split(" ");
    });
  }

  var lists = { es: split(es), en: split(en) };

  // "mixto": las dos listas juntas, sin repetir las palabras que comparten
  // ambos idiomas (halo, radar, eclipse…).
  lists.mix = lists.es.map(function (group, tier) {
    var seen = {};
    return group.concat(lists.en[tier]).filter(function (word) {
      if (seen[word]) return false;
      seen[word] = true;
      return true;
    });
  });

  App.words = {
    ranges: RANGES,
    lists: lists,
    languages: ["es", "en", "mix"],
  };
})();
