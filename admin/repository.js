const OWNER_ID = 112794021;
const SOURCE = "/repos/ThinhDost/fieldnotes-source";
const PAGES = "/repos/ThinhDost/fieldnotes";
const BRANCH = "main";
const decoder = new TextDecoder("utf-8", { fatal: true });
const RELEASE = "content/fieldnotes-release.json";
const RENDER_MARKER = ".fieldnotes-release.json";
const LIVE_MARKER = "assets/fieldnotes-release.json";
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ASSET = /^[a-z0-9][a-z0-9-]*\.(?:png|jpe?g|gif|webp)$/i;
export const IMAGE_TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
};

export function base64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(new Error("The selected image could not be read."));
    reader.readAsDataURL(file);
  });
}

function parseRelease(source) {
  const release = JSON.parse(source);
  if (!/^[a-f0-9-]{36}$/.test(release.id) || !SLUG.test(release.slug)) {
    throw new Error("Invalid publication record.");
  }
  return release;
}

function isPublicFile(path) {
  if (path === "index.html" || path === ".nojekyll") return true;
  const parts = path.split("/");
  return parts.length > 1 && ["admin", "assets", "posts"].includes(parts[0]) &&
    parts.every(part => part && !part.startsWith(".") && !part.includes("\\"));
}

export async function connect(token) {
  if (!/^github_pat_[a-z0-9_]+$/i.test(token)) {
    throw new Error("Enter a fine-grained GitHub personal access token.");
  }
  async function request(path, method = "GET", payload, allowMissing = false) {
    const response = await fetch("https://api.github.com" + path, {
      method,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2026-03-10",
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (response.ok) return response.json();
    if (allowMissing && response.status === 404) return null;
    if (response.status === 401) throw new Error("GitHub rejected the token. Sign in with a valid token.");
    if (response.status === 403 || response.status === 404) {
      throw new Error("GitHub denied access. Check both selected repositories and Contents: Read and write.");
    }
    if (response.status === 409 || response.status === 422) {
      throw new Error("GitHub rejected the update. Refresh before retrying if another session changed the repository.");
    }
    throw new Error(`GitHub returned HTTP ${response.status}. Try again in a moment.`);
  }

  const profile = await request("/user");
  if (profile.id !== OWNER_ID) throw new Error("Only the Fieldnotes owner can open the studio.");
  const repository = await request(SOURCE);
  if (!repository.private || repository.owner.id !== OWNER_ID || repository.default_branch !== BRANCH) {
    throw new Error("The private content repository is not configured as expected.");
  }

  function git(repo, branch = BRANCH) {
    const api = (path, ...args) => request(repo + path, ...args);
    async function snapshot(allowMissing = false) {
      const ref = await api("/git/ref/heads/" + branch, "GET", undefined, allowMissing);
      if (!ref) return null;
      const head = ref.object.sha;
      const commit = await api("/git/commits/" + head);
      const tree = await api("/git/trees/" + commit.tree.sha + "?recursive=1");
      if (tree.truncated) throw new Error("The content index is too large.");
      const files = new Map(tree.tree.filter(entry => entry.mode === "100644").map(entry => [entry.path, entry.sha]));
      return { head, tree: tree.sha, files };
    }
    async function encoded(sha) {
      const blob = await api("/git/blobs/" + sha);
      if (blob.encoding !== "base64") throw new Error("GitHub returned an unsupported file.");
      return blob.content.replace(/\s/g, "");
    }
    async function bytes(sha) {
      return Uint8Array.from(atob(await encoded(sha)), char => char.charCodeAt(0));
    }
    async function write(snapshot, changes, message) {
      const tree = changes.map(change => ({ mode: "100644", type: "blob", ...change }));
      const created = await api("/git/trees", "POST", { base_tree: snapshot.tree, tree });
      const commit = await api("/git/commits", "POST", {
        message, tree: created.sha, parents: [snapshot.head],
        author: { name: "ThinhDost", email: "112794021+ThinhDost@users.noreply.github.com" },
      });
      await api("/git/refs/heads/" + branch, "PATCH", { sha: commit.sha, force: false });
    }
    return {
      snapshot, encoded, bytes, write,
      text: async sha => decoder.decode(await bytes(sha)),
      blob: async content => (await api("/git/blobs", "POST", { content, encoding: "base64" })).sha,
    };
  }

  const source = git(SOURCE);
  const rendered = git(SOURCE, "rendered");
  const pages = git(PAGES);
  const read = async (target, snapshot, path) => {
    const sha = snapshot?.files.get(path);
    return sha ? parseRelease(await target.text(sha)) : null;
  };

  async function pending(snapshot) {
    const release = await read(source, snapshot, RELEASE);
    if (!release) return null;
    const live = await read(pages, await pages.snapshot(), LIVE_MARKER);
    return live?.id === release.id ? null : release;
  }

  async function publish(release, report) {
    let build;
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = await rendered.snapshot(true);
      const marker = await read(rendered, candidate, RENDER_MARKER);
      if (marker?.id === release.id && marker.slug === release.slug) {
        build = candidate;
        break;
      }
      if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (!build) throw new Error("The private build is still pending. Check Deployment status and try Finish publishing.");
    const target = await request(PAGES);
    if (target.private || target.owner.id !== OWNER_ID || target.default_branch !== BRANCH) {
      throw new Error("The public repository is not configured as expected.");
    }
    const files = [...build.files].filter(([path]) => path !== RENDER_MARKER);
    if (!build.files.has("index.html") || !build.files.has("admin/index.html") ||
        !build.files.has(`posts/${release.slug}/index.html`) ||
        files.some(([path]) => !isPublicFile(path) || path === LIVE_MARKER)) {
      throw new Error("The build contains unexpected files. No public changes were made.");
    }
    const live = await pages.snapshot();
    if ((await read(pages, live, LIVE_MARKER))?.id === release.id) return;
    report("Sending the generated files to GitHub Pages…");
    const changes = [{ path: LIVE_MARKER, content: JSON.stringify(release) + "\n" }];
    for (const [path, sha] of files) {
      if (live.files.get(path) === sha) continue;
      const transferred = await pages.blob(await rendered.encoded(sha));
      if (transferred !== sha) throw new Error("A generated file failed its integrity check.");
      changes.push({ path, sha });
    }
    for (const path of live.files.keys()) {
      if (path !== LIVE_MARKER && isPublicFile(path) && !build.files.has(path)) changes.push({ path, sha: null });
    }
    if ((await read(source, await source.snapshot(), RELEASE))?.id !== release.id) {
      throw new Error("A newer publication is queued. Sign in again to finish the latest one.");
    }
    await pages.write(live, changes, "Publish Fieldnotes: " + release.slug);
  }

  return {
    ...source,
    blob: async file => source.blob(await base64(file)),
    queue: release => ({ path: RELEASE, content: JSON.stringify(release) + "\n" }),
    pending,
    publish,
  };
}
