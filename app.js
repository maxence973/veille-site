const THEMES = {
  conflit:   { nom: "Conflits & opérations", couleur: "var(--conflit)",   hex: "#e5534b" },
  naval:     { nom: "Naval",                 couleur: "var(--naval)",     hex: "#4a9eff" },
  aerien:    { nom: "Aérien & drones",       couleur: "var(--aerien)",    hex: "#3ccfcf" },
  terrestre: { nom: "Terrestre",             couleur: "var(--terrestre)", hex: "#c9a227" },
  missile:   { nom: "Missiles, spatial, nucléaire", couleur: "var(--missile)", hex: "#b083f0" },
  industrie: { nom: "Industrie & contrats",  couleur: "var(--industrie)", hex: "#57ab5a" },
  autre:     { nom: "Autre",                 couleur: "var(--autre)",     hex: "#8b949e" },
};

const $ = (id) => document.getElementById(id);
const etat = { evenements: [], actifs: new Set(Object.keys(THEMES)), marqueurs: new Map() };

// ---------- Carte ----------
const carte = L.map("carte", { worldCopyJump: true, minZoom: 2, zoomControl: true }).setView([30, 20], 2.5);
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
L.tileLayer(ESRI + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Fond &copy; Esri, HERE, Garmin, &copy; OpenStreetMap", maxZoom: 16,
}).addTo(carte);
L.tileLayer(ESRI + "World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, pane: "shadowPane" }).addTo(carte);

const amas = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: 40,
  spiderfyDistanceMultiplier: 1.4,
  iconCreateFunction: (c) => {
    const n = c.getChildCount();
    const t = n < 5 ? 28 : n < 15 ? 36 : 46;
    return L.divIcon({ html: `<div class="amas" style="width:${t}px;height:${t}px">${n}</div>`, className: "", iconSize: [t, t] });
  },
}).addTo(carte);

const legende = L.control({ position: "bottomright" });
legende.onAdd = () => {
  const d = L.DomUtil.create("div", "legende");
  d.innerHTML = Object.values(THEMES).map((t) => `<div><i style="background:${t.hex}"></i>${t.nom}</div>`).join("")
    + `<div style="margin-top:4px;color:#66758a">pointillé = lieu déduit ou siège</div>`;
  return d;
};
legende.addTo(carte);

// ---------- Utilitaires ----------
// Position incertaine : pays déduit d'un indice, ou pays du siège de l'entreprise (article sans lieu cité)
const incertain = (e) => e.precision === "deduit" || e.precision === "source";
const PRECISION = { deduit: " (déduit)", source: " (siège de l'entreprise, aucun lieu cité)" };
const echapper = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sansAccent = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function dateRelative(iso) {
  if (!iso) return "date inconnue";
  const h = (Date.now() - new Date(iso)) / 36e5;
  if (h < 1) return "il y a < 1 h";
  if (h < 24) return `il y a ${Math.round(h)} h`;
  const j = Math.round(h / 24);
  if (j < 8) return `il y a ${j} j`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function lienSur(url) {
  try { const u = new URL(url); return ["http:", "https:"].includes(u.protocol) ? u.href : null; } catch { return null; }
}

const LANGUES = { de: "de l'allemand", es: "de l'espagnol", it: "de l'italien", nl: "du néerlandais", pt: "du portugais",
  pl: "du polonais", uk: "de l'ukrainien", ru: "du russe", sv: "du suédois", no: "du norvégien", da: "du danois",
  fi: "du finnois", cs: "du tchèque", ja: "du japonais", ko: "du coréen", "zh-CN": "du chinois", ar: "de l'arabe",
  iw: "de l'hébreu", he: "de l'hébreu", tr: "du turc", el: "du grec" };
const traduction = (e) => e.titre_original
  ? `<p class="traduction">Traduit automatiquement ${LANGUES[e.langue] || "d'une langue étrangère"} · titre original : « ${echapper(e.titre_original)} »</p>` : "";

function popup(e) {
  const t = THEMES[e.theme] || THEMES.autre;
  const lien = lienSur(e.url);
  const lieux = e.lieux.length > 1 ? ` · cite aussi : ${echapper(e.lieux.slice(1, 4).join(", "))}` : "";
  return `<div class="popup">
    <span class="theme-tag" style="color:${t.hex}">${t.nom}</span>
    <h3>${echapper(e.titre)}</h3>
    <div class="meta"><span>${echapper(e.source)}</span><span>${dateRelative(e.date)}</span>
      <span class="lieu ${incertain(e) ? "deduit" : ""}">${echapper(e.lieu)}${PRECISION[e.precision] || ""}${lieux}</span></div>
    ${e.resume ? `<p style="margin-top:8px">${echapper(e.resume)}</p>` : ""}
    ${traduction(e)}
    ${lien ? `<a class="lire" href="${echapper(lien)}" target="_blank" rel="noopener">Lire l'article →</a>` : ""}
  </div>`;
}

// ---------- Période (curseur) ----------
const PALIERS = [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 365];
const joursPeriode = () => PALIERS[Number($("periode").value)] ?? 7;
function libellePeriode(j) {
  if (j === 1) return "Dernières 24 h";
  if (j === 365) return "Dernière année";
  if (j >= 30 && j % 30 === 0) return `${j / 30} derniers mois`.replace("1 derniers mois", "Dernier mois");
  return `${j} derniers jours`;
}

// ---------- Filtrage ----------
function filtres() {
  const jours = joursPeriode();
  const limite = Date.now() - jours * 864e5;
  const q = sansAccent($("recherche").value.trim());
  const src = $("source").value;
  return (e, ignorerTheme = false) =>
    (ignorerTheme || etat.actifs.has(e.theme)) &&
    (!e.date || new Date(e.date) >= limite) &&
    (!src || e.source === src) &&
    (!q || sansAccent(`${e.titre} ${e.titre_original || ""} ${e.resume} ${e.lieux.join(" ")} ${e.source}`).includes(q));
}

function rendre() {
  const garde = filtres();
  const visibles = etat.evenements.filter((e) => garde(e));

  // marqueurs
  amas.clearLayers();
  etat.marqueurs.clear();
  for (const e of visibles) {
    if (e.lat == null) continue;
    const t = THEMES[e.theme] || THEMES.autre;
    const m = L.circleMarker([e.lat, e.lon], {
      radius: 7, color: t.hex, weight: 2, fillColor: t.hex,
      fillOpacity: incertain(e) ? 0.15 : 0.55,
      dashArray: incertain(e) ? "3 3" : null,
    }).bindPopup(popup(e), { maxWidth: 360 });
    m.on("popupopen", () => surligner(e.id));
    amas.addLayer(m);
    etat.marqueurs.set(e.id, m);
  }

  // pastilles de thème (compte hors filtre de thème)
  const sansTheme = etat.evenements.filter((e) => garde(e, true));
  $("themes").innerHTML = Object.entries(THEMES).map(([cle, t]) => {
    const n = sansTheme.filter((e) => e.theme === cle).length;
    return `<button type="button" class="theme" data-theme="${cle}" aria-pressed="${etat.actifs.has(cle)}">
      <span class="pastille" style="background:${t.hex}"></span>${t.nom}<span class="n">${n}</span></button>`;
  }).join("");

  rendreListe(visibles);
  synthese(sansTheme);
}

function rendreListe(visibles) {
  const zone = $("zone-visible").checked;
  const limites = carte.getBounds();
  let liste = visibles;
  if (zone) liste = visibles.filter((e) => e.lat != null && limites.contains([e.lat, e.lon]));
  $("liste-titre").textContent = zone ? `${liste.length} articles dans la zone visible` : `${liste.length} articles (dont non localisés)`;
  $("articles").innerHTML = liste.length ? liste.map((e) => {
    const t = THEMES[e.theme] || THEMES.autre;
    return `<li class="article" data-id="${e.id}" style="--c:${t.hex}">
      <h3>${echapper(e.titre)}</h3>
      <div class="meta"><span>${echapper(e.source)}</span><span>${dateRelative(e.date)}</span>
        ${e.titre_original ? `<span class="trad" title="${echapper(e.titre_original)}">traduit</span>` : ""}
        <span class="lieu ${incertain(e) ? "deduit" : ""}">${e.lieu ? "◉ " + echapper(e.lieu) + (e.precision === "source" ? " (siège)" : "") : "non localisé"}</span></div>
    </li>`;
  }).join("") : `<li class="vide">Aucun article pour ces filtres.</li>`;
}

function synthese(liste) {
  const periode = libellePeriode(joursPeriode());
  if (!liste.length) { $("synthese").textContent = `Aucun article sur la période (${periode}).`; return; }
  const parLieu = {};
  for (const e of liste) if (e.lieu && e.precision !== "source") parLieu[e.lieu] = (parLieu[e.lieu] || 0) + 1;
  const top = Object.entries(parLieu).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const parTheme = {};
  for (const e of liste) parTheme[e.theme] = (parTheme[e.theme] || 0) + 1;
  const themeTop = Object.entries(parTheme).filter(([k]) => k !== "autre").sort((a, b) => b[1] - a[1])[0];
  $("synthese").innerHTML =
    `<b>${periode}</b> : ${liste.length} articles. ` +
    (top.length ? `Zones les plus citées : ${top.map(([l, n]) => `<b>${echapper(l)}</b> (${n})`).join(", ")}. ` : "") +
    (themeTop ? `Thème dominant : ${THEMES[themeTop[0]].nom.toLowerCase()}.` : "");
}

function surligner(id) {
  document.querySelectorAll(".article.actif").forEach((n) => n.classList.remove("actif"));
  const n = document.querySelector(`.article[data-id="${id}"]`);
  if (n) { n.classList.add("actif"); n.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
}

// ---------- Données ----------
async function charger(url) {
  const bouton = $("rafraichir");
  bouton.disabled = true; bouton.textContent = EN_LIGNE ? "chargement…" : "collecte…";
  try {
    const d = await (await fetch(url)).json();
    etat.evenements = d.evenements || [];
    const ok = (d.sources || []).filter((s) => s.ok).length;
    $("c-total").textContent = etat.evenements.length;
    $("c-loc").textContent = etat.evenements.filter((e) => e.lat != null).length;
    $("c-src").textContent = `${ok}/${(d.sources || []).length}`;
    $("maj").textContent = d.maj ? new Date(d.maj).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
    const choix = $("source").value;
    $("source").innerHTML = `<option value="">Toutes les sources</option>` +
      (d.sources || []).filter((s) => s.ok).map((s) => `<option>${echapper(s.nom)}</option>`).join("");
    $("source").value = choix;
    $("etat-sources").innerHTML = (d.sources || []).map((s) =>
      s.ok ? `<div>✓ ${echapper(s.nom)} — ${s.nb}</div>`
        : s.secours ? `<div class="secours">⚠ ${echapper(s.nom)} — injoignable (${echapper(s.erreur)}), ${s.secours} articles de la collecte précédente conservés</div>`
        : `<div class="err">✗ ${echapper(s.nom)} — ${echapper(s.erreur)}</div>`).join("");
    rendre();
    if (!etat.cadre && amas.getLayers().length) {
      etat.cadre = true;
      carte.fitBounds(amas.getBounds().pad(0.15), { maxZoom: 4 });
    }
  } catch (err) {
    $("synthese").textContent = EN_LIGNE ? "Données indisponibles pour le moment." : "Impossible de joindre le serveur de veille. Lancez « python veille.py ».";
  } finally {
    bouton.disabled = false; bouton.textContent = "Actualiser";
  }
}

// ---------- Événements ----------
$("themes").addEventListener("click", (ev) => {
  const b = ev.target.closest(".theme");
  if (!b) return;
  const cle = b.dataset.theme;
  if (ev.shiftKey || ev.ctrlKey) { etat.actifs = new Set([cle]); }
  else etat.actifs.has(cle) ? etat.actifs.delete(cle) : etat.actifs.add(cle);
  rendre();
});
$("articles").addEventListener("click", (ev) => {
  const li = ev.target.closest(".article");
  if (!li) return;
  const m = etat.marqueurs.get(li.dataset.id);
  if (m) amas.zoomToShowLayer(m, () => m.openPopup());
  else {
    const e = etat.evenements.find((x) => x.id === li.dataset.id);
    const lien = e && lienSur(e.url);
    if (lien) window.open(lien, "_blank", "noopener");
  }
});
$("source").addEventListener("change", rendre);
$("periode").addEventListener("input", () => {
  $("periode-valeur").textContent = libellePeriode(joursPeriode());
  try { localStorage.setItem("veille-periode", $("periode").value); } catch {}
  rendre();
});
try {
  const memo = localStorage.getItem("veille-periode");
  if (memo !== null) $("periode").value = memo;
} catch {}
$("periode-valeur").textContent = libellePeriode(joursPeriode());
$("recherche").addEventListener("input", rendre);
$("zone-visible").addEventListener("change", rendre);
carte.on("moveend", () => rendreListe(etat.evenements.filter(filtres())));
// En local (python veille.py) : collecte en direct via le serveur.
// En ligne (GitHub Pages) : données collectées automatiquement chaque heure dans evenements.json.
const EN_LIGNE = !["localhost", "127.0.0.1"].includes(location.hostname);
const urlDonnees = (forcer) => EN_LIGNE ? `evenements.json?t=${Date.now()}` : forcer ? "/api/rafraichir" : "/api/evenements";
$("rafraichir").addEventListener("click", () => charger(urlDonnees(true)));

charger(urlDonnees(false));

// ---------- Rapport du matin ----------
let rapports = [];
const dateLongue = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

function afficherRapport(r) {
  const regions = r.regions.map((g) => {
    const marquants = g.marquants.map((m) => {
      const lien = lienSur(m.url);
      const titre = lien ? `<a href="${echapper(lien)}" target="_blank" rel="noopener">${echapper(m.titre)}</a>` : echapper(m.titre);
      return `<li>${titre}<span class="rapport-src">${echapper(m.source)}${m.nb_sources > 1 ? ` · repris par ${m.nb_sources} sources` : ""}</span></li>`;
    }).join("");
    const tendance = g.variation == null ? "" : `<span class="tendance ${g.variation >= 15 ? "hausse" : g.variation <= -15 ? "baisse" : ""}">${g.variation > 0 ? "+" : ""}${g.variation} %</span>`;
    return `<article class="rapport-region ${g.n ? "" : "calme"}">
      <h3><button type="button" class="vers-region" data-region="${echapper(g.nom)}" title="Voir sur la carte">${echapper(g.nom)}</button>
        <span class="rapport-n">${g.n} article${g.n > 1 ? "s" : ""}</span>${tendance}</h3>
      <p>${g.texte.map(echapper).join(" ")}</p>
      ${marquants ? `<ul class="rapport-marquants">${marquants}</ul>` : ""}
    </article>`;
  }).join("");
  $("rapport-contenu").innerHTML = `<p class="rapport-intro"><b>${echapper(dateLongue(r.date).replace(/^./, (c) => c.toUpperCase()))}</b> — ${echapper(r.intro)}</p>${regions}`;
}

function chargerRapports() {
  fetch(EN_LIGNE ? `rapports.json?t=${Date.now()}` : "/api/rapports").then((r) => r.ok ? r.json() : { rapports: [] })
    .then((d) => {
      rapports = d.rapports || [];
      if (!rapports.length) return;
      $("ouvrir-rapport").hidden = false;
      $("rapport-date").textContent = dateLongue(rapports[0].date);
      $("rapport-choix").innerHTML = rapports.map((r, i) => `<option value="${i}">${echapper(dateLongue(r.date))}</option>`).join("");
      afficherRapport(rapports[0]);
    }).catch(() => {});
}

function basculerRapport(ouvert) {
  $("rapport").hidden = !ouvert;
  $("ouvrir-rapport").setAttribute("aria-expanded", String(ouvert));
  if (ouvert) $("rapport").scrollTop = 0;
}
$("ouvrir-rapport").addEventListener("click", () => basculerRapport($("rapport").hidden));
$("fermer-rapport").addEventListener("click", () => basculerRapport(false));
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("rapport").hidden) basculerRapport(false); });
$("rapport-choix").addEventListener("change", (ev) => afficherRapport(rapports[Number(ev.target.value)]));
// Clic sur le nom d'une région : ferme le rapport et cadre la carte sur ses articles
$("rapport-contenu").addEventListener("click", (ev) => {
  const b = ev.target.closest(".vers-region");
  if (!b) return;
  const r = rapports[Number($("rapport-choix").value) || 0];
  const lieux = new Set((r.regions.find((g) => g.nom === b.dataset.region)?.pays || []).map((p) => p[0]));
  const points = etat.evenements.filter((e) => e.lat != null && lieux.has(e.lieu)).map((e) => [e.lat, e.lon]);
  basculerRapport(false);
  if (points.length) carte.fitBounds(points, { padding: [40, 40], maxZoom: 5 });
});
chargerRapports();
