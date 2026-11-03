'use strict';

// Zugriff auf die Modrinth-API und Auflösen von Abhängigkeiten. Läuft nur im Hauptprozess,
// der Renderer hat wegen der CSP keinen Netzzugriff.

const API = 'https://api.modrinth.com/v2';
const USER_AGENT = 'couch-launcher/0.1.0';
const PAGE_SIZE = 24;
const MAX_DEPENDENCIES = 100;
const VERSION_ORDER = ['release', 'beta', 'alpha'];
// Ein Update wird nie instabiler als das Installierte
const UPDATE_TYPES = {
  release: ['release'],
  beta: ['release', 'beta'],
  alpha: ['release', 'beta', 'alpha'],
};

function createFetchJson(fetchFn = fetch) {
  return async function fetchJson(url, options = {}) {
    const res = await fetchFn(url, {
      ...options,
      headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Server antwortet mit Fehler ${res.status}`);
    return res.json();
  };
}

// Bilder lädt der Renderer direkt, die CSP erlaubt nur dieses CDN
function safeIcon(url) {
  return typeof url === 'string' && url.startsWith('https://cdn.modrinth.com/') ? url : null;
}

// Mod-Loader, deren Mods in der Instanz laufen. Quilt kann auch Fabric-Mods laden.
function compatibleLoaders(loader) {
  return loader === 'quilt' ? ['quilt', 'fabric'] : [loader];
}

function searchFacets({ type, mc, loader }) {
  if (type === 'modpack') return [['project_type:modpack']];
  const facets = [[`project_type:${type}`], [`versions:${mc}`]];
  if (type === 'mod') {
    facets.push(compatibleLoaders(loader).map((l) => `categories:${l}`));
    facets.push(['client_side:required', 'client_side:optional']);
  }
  return facets;
}

function toHit(hit) {
  return {
    id: hit.project_id,
    title: hit.title,
    description: hit.description || '',
    author: hit.author || '',
    downloads: hit.downloads || 0,
    icon: safeIcon(hit.icon_url),
  };
}

// Pro Minecraft-Version und Loader die neueste stabile Fassung eines Modpacks, sonst die neueste Beta.
// Die API liefert neueste zuerst, die Reihenfolge bleibt erhalten.
function packChoices(versions) {
  const groups = new Map();
  for (const v of versions) {
    if (!pickFile(v, ['.mrpack'])) continue;
    const key = `${(v.game_versions || [])[0]}|${(v.loaders || [])[0]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  return [...groups.values()].map((list) => {
    const v = pickVersion(list);
    return {
      id: v.id,
      name: v.name || v.version_number,
      mc: (v.game_versions || [])[0] || '',
      loader: (v.loaders || [])[0] || '',
      beta: v.version_type !== 'release',
    };
  });
}

// Neueste stabile Version, sonst die neueste Beta oder Alpha. Die API liefert neueste zuerst.
function pickVersion(versions) {
  for (const kind of VERSION_ORDER) {
    const hit = versions.find((v) => v.version_type === kind);
    if (hit) return hit;
  }
  return versions[0] || null;
}

function pickFile(version, exts) {
  const files = (version.files || []).filter((f) => exts.some((e) => String(f.filename).toLowerCase().endsWith(e)));
  return files.find((f) => f.primary) || files[0] || null;
}

function createClient(fetchFn = fetch) {
  const fetchJson = createFetchJson(fetchFn);

  async function search({ type, query, mc, loader, offset = 0 }) {
    const params = new URLSearchParams({
      query: query || '',
      facets: JSON.stringify(searchFacets({ type, mc, loader })),
      index: query ? 'relevance' : 'downloads',
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    const data = await fetchJson(`${API}/search?${params}`);
    return { hits: data.hits.map(toHit), total: data.total_hits, offset };
  }

  async function packVersions(projectId) {
    const list = await fetchJson(`${API}/project/${encodeURIComponent(projectId)}/version`);
    return packChoices(list);
  }

  function version(versionId) {
    return fetchJson(`${API}/version/${encodeURIComponent(versionId)}`);
  }

  async function project(projectId) {
    const p = await fetchJson(`${API}/project/${encodeURIComponent(projectId)}`);
    return { id: p.id, slug: p.slug, title: p.title, icon: safeIcon(p.icon_url) };
  }

  function projectVersions(projectId, { type, mc, loader }) {
    const params = new URLSearchParams({ game_versions: JSON.stringify([mc]) });
    if (type === 'mod') params.set('loaders', JSON.stringify(compatibleLoaders(loader)));
    return fetchJson(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`);
  }

  async function hasVersion(projectId, ctx) {
    return (await projectVersions(projectId, ctx)).length > 0;
  }

  // Titel und Icons für viele Projekte, in Blöcken wegen der URL-Länge
  async function projects(ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 100) {
      const params = new URLSearchParams({ ids: JSON.stringify(ids.slice(i, i + 100)) });
      for (const p of await fetchJson(`${API}/projects?${params}`)) {
        out.set(p.id, { title: p.title, icon: safeIcon(p.icon_url) });
      }
    }
    return out;
  }

  // Ordnet SHA-1-Hashes lokaler Dateien den Modrinth-Projekten zu: Map(Hash -> Projekt-ID)
  async function identify(hashes) {
    if (!hashes.length) return new Map();
    const data = await fetchJson(`${API}/version_files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes, algorithm: 'sha1' }),
    });
    return new Map(Object.entries(data).map(([hash, version]) => [hash, version.project_id]));
  }

  // Installierte Fassungen zu SHA-1-Hashes: Map(Hash -> Version)
  async function installedVersions(hashes) {
    if (!hashes.length) return new Map();
    const data = await fetchJson(`${API}/version_files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes, algorithm: 'sha1' }),
    });
    return new Map(Object.entries(data));
  }

  async function latestVersions(hashes, types, ctx) {
    const body = { hashes, algorithm: 'sha1', game_versions: [ctx.mc], version_types: types };
    if (ctx.type === 'mod') body.loaders = compatibleLoaders(ctx.loader);
    return fetchJson(`${API}/version_files/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // items: installierte Dateien mit sha1. Dateien, die Modrinth nicht kennt, bleiben unberührt.
  async function findUpdates(items, ctx, exts) {
    const installed = await installedVersions(items.map((i) => i.sha1));
    const updates = [];
    for (const [kind, types] of Object.entries(UPDATE_TYPES)) {
      const group = items.filter((i) => installed.has(i.sha1) && installed.get(i.sha1).version_type === kind);
      if (!group.length) continue;
      const latest = await latestVersions(group.map((i) => i.sha1), types, ctx);
      for (const item of group) {
        const version = latest[item.sha1];
        if (!version || version.id === installed.get(item.sha1).id) continue;
        if ((version.files || []).some((f) => f.hashes && f.hashes.sha1 === item.sha1)) continue;
        const file = pickFile(version, exts);
        if (file) updates.push({ item, projectId: version.project_id, version, file });
      }
    }
    return { updates, known: new Set([...installed.values()].map((v) => v.project_id)) };
  }

  // Plan für ein Projekt samt Pflicht-Abhängigkeiten. Schon installierte Projekte werden übersprungen.
  // missing: Abhängigkeiten ohne passende Version, ohne sie startet das Spiel eventuell nicht.
  async function resolve(rootId, ctx, installed, exts) {
    const plan = new Map();
    const missing = [];
    const queue = [rootId];
    const seen = new Set(installed);
    seen.add(rootId);

    while (queue.length) {
      const id = queue.shift();
      if (seen.size - installed.size > MAX_DEPENDENCIES) throw new Error('Zu viele Abhängigkeiten.');
      const version = pickVersion(await projectVersions(id, ctx));
      const file = version && pickFile(version, exts);
      if (!file) {
        if (id === rootId) throw new Error(`Keine passende Version für Minecraft ${ctx.mc}.`);
        missing.push(id);
        continue;
      }
      plan.set(id, { projectId: id, file });
      // Ressourcenpakete nennen oft Mods als Abhängigkeit, die gehören nicht in ihren Ordner
      if (ctx.type !== 'mod') continue;
      for (const dep of version.dependencies || []) {
        if (dep.dependency_type !== 'required' || !dep.project_id || seen.has(dep.project_id)) continue;
        seen.add(dep.project_id);
        queue.push(dep.project_id);
      }
    }
    return { plan: [...plan.values()], missing };
  }

  return { search, findUpdates, packVersions, version, project, hasVersion, projects, identify, resolve, fetchJson };
}

module.exports = { createClient, createFetchJson, pickVersion, pickFile, packChoices, searchFacets, safeIcon, PAGE_SIZE };
