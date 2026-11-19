import { ASSET, IMAGE_TYPES, SLUG, connect } from "./repository.js";

const $ = selector => document.querySelector(selector);
const login = $("#login");
const signOut = $("#sign-out");
const workspace = $("#workspace");
const postForm = $("#post-form");
const fields = postForm.elements;
const body = $("#body");
const preview = $("#preview");
const saveStatus = $("#save-status");
const publishLinks = $("#publish-links");
const finishButton = $("#finish-publish");
const library = $("#entries");
const markdown = window.markdownit({ html: false });
const yaml = window.jsyaml;
const images = new Map();
let repository;
let revision;
let opened;
let metadata = {};
let pendingRelease;
let dirty = false;
let busy = false;
let previewFrame = 0;

const postPath = (slug, isDraft) => `content/${isDraft ? "drafts" : "posts"}/${slug}/index.md`;
const assetsPath = (slug, isDraft) => postPath(slug, isDraft).replace(/index\.md$/, "assets/");

function message(element, text, error = false) {
  element.textContent = text;
  element.toggleAttribute("data-error", error);
}

function clearImages() {
  for (const { url } of images.values()) if (url) URL.revokeObjectURL(url);
  images.clear();
}

function assetName(source) {
  const match = /^(?:\.\/)?assets\/([^/?#]+)$/.exec(source ?? "");
  if (!match) return null;
  try {
    const name = decodeURIComponent(match[1]);
    return ASSET.test(name) ? name : null;
  } catch {
    return null;
  }
}

function visitTokens(tokens, visit) {
  for (const token of tokens) {
    visit(token);
    if (token.children) visitTokens(token.children, visit);
  }
}

function renderPreview() {
  const tokens = markdown.parse(body.value, {});
  visitTokens(tokens, token => {
    if (token.type === "image") {
      const image = images.get(assetName(token.attrGet("src")));
      if (image?.url) token.attrSet("src", image.url);
      else {
        token.type = "text";
        token.content = token.content ? `[Image: ${token.content}]` : "[Image]";
        token.children = null;
      }
    }
    if (token.type === "link_open") token.attrSet("href", "#preview");
  });
  const title = document.createElement("h2");
  title.textContent = fields.title.value.trim();
  // markdown-it escapes raw HTML, and image URLs are restricted to local blobs.
  preview.innerHTML = markdown.renderer.render(tokens, markdown.options, {});
  if (title.textContent) preview.prepend(title);
}

function updatePreview() {
  cancelAnimationFrame(previewFrame);
  previewFrame = requestAnimationFrame(renderPreview);
}

function splitPost(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) throw new Error("This post is missing its YAML frontmatter.");
  const data = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
  if (!data || Array.isArray(data) || typeof data !== "object") throw new Error("Invalid post metadata.");
  return { data, body: source.slice(match[0].length).trimStart() };
}

function renderLibrary() {
  library.replaceChildren();
  const names = new Map();
  for (const path of revision.files.keys()) {
    const match = /^content\/(drafts|posts)\/([a-z0-9-]+)\/index\.md$/.exec(path);
    if (!match || !SLUG.test(match[2])) continue;
    const flags = names.get(match[2]) ?? new Set();
    flags.add(match[1]);
    names.set(match[2], flags);
  }
  for (const [slug, flags] of [...names].sort(([a], [b]) => a.localeCompare(b))) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const status = document.createElement("small");
    button.type = "button";
    button.dataset.slug = slug;
    if (opened === slug) button.setAttribute("aria-current", "true");
    button.textContent = slug;
    status.textContent = pendingRelease?.slug === slug ? "Publication pending" :
      flags.has("drafts") ? (flags.has("posts") ? "Draft changes" : "Draft") : "Public";
    button.append(status);
    item.append(button);
    library.append(item);
  }
}

function resetEditor() {
  clearImages();
  opened = undefined;
  dirty = false;
  metadata = {};
  postForm.reset();
  fields.slug.readOnly = false;
  publishLinks.hidden = true;
  renderPreview();
}

function imageMime(name) {
  return IMAGE_TYPES[name.split(".").at(-1).toLowerCase()];
}

async function openPost(slug) {
  const draft = revision.files.has(postPath(slug, true));
  const sha = revision.files.get(postPath(slug, draft));
  const post = splitPost(await repository.text(sha));
  const prefix = assetsPath(slug, draft);
  const assets = [...revision.files].filter(([path]) => path.startsWith(prefix) && ASSET.test(path.slice(prefix.length)));
  const loaded = await Promise.all(assets.map(async ([path, sha]) => ({
    name: path.slice(prefix.length), sha, bytes: await repository.bytes(sha),
  })));
  resetEditor();
  metadata = post.data;
  opened = slug;
  fields.slug.value = slug;
  fields.slug.readOnly = true;
  for (const name of ["title", "type", "date", "lang", "summary"]) {
    if (typeof metadata[name] === "string") fields[name].value = metadata[name];
  }
  fields.tags.value = Array.isArray(metadata.tags) ? metadata.tags.join("\n") : "";
  body.value = post.body;
  for (const { name, sha, bytes } of loaded) {
    images.set(name, { sha, url: URL.createObjectURL(new Blob([bytes], { type: imageMime(name) })) });
  }
  renderLibrary();
  renderPreview();
}

function canDiscard() {
  return !dirty || window.confirm("Discard unsaved changes?");
}

async function work(task) {
  if (busy) return;
  busy = true;
  $("#fields").disabled = true;
  $("#new-post").disabled = true;
  signOut.disabled = true;
  finishButton.disabled = true;
  try {
    await task();
  } catch (error) {
    message(saveStatus, error.message, true);
  } finally {
    busy = false;
    $("#fields").disabled = false;
    $("#new-post").disabled = false;
    signOut.disabled = false;
    finishButton.disabled = false;
  }
}

function serialize(slug, publishing) {
  const data = {
    ...metadata, title: fields.title.value.trim(), slug, type: fields.type.value, draft: !publishing,
  };
  for (const key of ["date", "lang", "summary"]) {
    const value = fields[key].value.trim();
    if (value) data[key] = value;
    else delete data[key];
  }
  const tags = fields.tags.value.split(/\r?\n/).map(tag => tag.trim()).filter(Boolean);
  if (tags.length) data.tags = tags;
  else delete data.tags;
  if (data.updated && (!data.date || data.updated < data.date)) {
    throw new Error("The publish date must be on or before the existing updated date.");
  }
  return `---\n${yaml.dump(data, { schema: yaml.JSON_SCHEMA, noRefs: true, lineWidth: -1, forceQuotes: true })}---\n\n${body.value.trimEnd()}\n`;
}

function publishAssets() {
  const names = new Set();
  visitTokens(markdown.parse(body.value, {}), token => {
    if (token.type !== "image") return;
    const src = token.attrGet("src");
    const name = assetName(src);
    if (/^(?:\.\/)?assets\//.test(src) && (!name || !images.has(name))) {
      throw new Error(`Image missing from this post: ${src}. Add it before publishing.`);
    }
    if (name) names.add(name);
  });
  return names;
}

function showPublishLinks(release, deployed) {
  $("#public-post").href = `../posts/${release.slug}/`;
  $("#deployment-status").href = deployed ?
    "https://github.com/ThinhDost/fieldnotes/actions" : "https://github.com/ThinhDost/fieldnotes-source/actions";
  publishLinks.hidden = false;
}

function showPublication(release) {
  pendingRelease = release;
  finishButton.hidden = !release;
  renderLibrary();
  if (release) showPublishLinks(release, false);
}

async function finishPublication() {
  const release = pendingRelease;
  if (!release) return;
  message(saveStatus, "Saved privately. Waiting for the generated site…");
  try {
    await repository.publish(release, text => message(saveStatus, text));
  } catch (error) {
    throw new Error("Your post is saved privately. " + error.message);
  }
  showPublication(null);
  showPublishLinks(release, true);
  message(saveStatus, "Sent to GitHub Pages. The public link updates after deployment.");
}

async function save(publishing) {
  const slug = fields.slug.value.trim();
  if (!SLUG.test(slug) || !fields.title.value.trim()) throw new Error("Enter a title and a valid lowercase slug.");
  if (publishing && (!fields.date.value || !body.value.trim())) throw new Error("Add a publish date and article text first.");
  const source = serialize(slug, publishing);
  const selectedImages = publishing ? publishAssets() : images.keys();
  const latest = await repository.snapshot();
  for (const key of [postPath(slug, false), postPath(slug, true)]) {
    if (opened !== slug && latest.files.has(key)) throw new Error("This slug already exists. Open it from the post list.");
    if (revision.files.get(key) !== latest.files.get(key)) throw new Error("This post changed in another session. Reopen the latest version first.");
  }
  const changes = [{ path: postPath(slug, !publishing), content: source }];
  for (const name of selectedImages) {
    const image = images.get(name);
    const sha = image.sha ?? await repository.blob(image.file);
    changes.push({ path: assetsPath(slug, !publishing) + name, sha });
  }
  const release = publishing ? { id: crypto.randomUUID(), slug } : null;
  if (release) {
    changes.push(repository.queue(release));
    const prefix = assetsPath(slug, true);
    for (const path of latest.files.keys()) {
      if (path === postPath(slug, true) || path.startsWith(prefix)) changes.push({ path, sha: null });
    }
  }
  await repository.write(latest, changes, `${publishing ? "Publish" : "Save draft"}: ${slug}`);
  dirty = false;
  const status = publishing ? "Saved for publication in your private repository." : "Draft saved to your private repository.";
  try {
    revision = await repository.snapshot();
    await openPost(slug);
  } catch {
    if (release) showPublication(release);
    message(saveStatus, status + " Sign in again to refresh the editor.");
    return;
  }
  if (release) showPublication(release);
  message(saveStatus, status);
  if (release) await finishPublication();
}

async function validateImage(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error("Images may be up to 5 MB each.");
  const start = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const text = String.fromCharCode(...start);
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => start[i] === byte)) return "png";
  if (start[0] === 255 && start[1] === 216 && start[2] === 255) return "jpg";
  if (/^GIF8[79]a/.test(text)) return "gif";
  if (text.startsWith("RIFF") && text.slice(8) === "WEBP") return "webp";
  throw new Error("Choose PNG, JPEG, GIF or WebP images.");
}

async function addImages(files) {
  const validated = [];
  for (const file of files) validated.push({ file, extension: await validateImage(file) });
  const references = [];
  for (const { file, extension } of validated) {
    const stem = file.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 72).replace(/-+$/, "") || "image";
    let name = `${stem}.${extension}`;
    for (let i = 2; images.has(name); i++) name = `${stem}-${i}.${extension}`;
    const blob = new Blob([file], { type: IMAGE_TYPES[extension] });
    images.set(name, { file, url: URL.createObjectURL(blob) });
    references.push(`![${stem.replaceAll("-", " ")}](assets/${name})`);
  }
  body.setRangeText("\n\n" + references.join("\n\n") + "\n", body.selectionStart, body.selectionEnd, "end");
  dirty = true;
  updatePreview();
  message(saveStatus, "Images added. Save the draft or publish to keep them.");
}

async function signIn(event) {
  event.preventDefault();
  const input = $("#access-token");
  const submit = login.querySelector("button");
  submit.disabled = input.disabled = true;
  message($("#login-status"), "Checking GitHub access…");
  try {
    repository = await connect(input.value.trim());
    revision = await repository.snapshot();
    const release = await repository.pending(revision);
    resetEditor();
    showPublication(release);
    if (release) message(saveStatus, "A post is awaiting publication.");
    login.closest(".login").hidden = true;
    workspace.hidden = signOut.hidden = false;
    $("#studio-subtitle").textContent = "Signed in as ThinhDost.";
    fields.title.focus();
  } catch (error) {
    repository = undefined;
    revision = undefined;
    pendingRelease = undefined;
    message($("#login-status"), error.message, true);
  } finally {
    input.value = "";
    submit.disabled = input.disabled = false;
  }
}

if (window.top === window.self) {
  login.hidden = false;
  login.addEventListener("submit", signIn);
  signOut.addEventListener("click", () => {
    if (!canDiscard()) return;
    resetEditor();
    repository = revision = undefined;
    pendingRelease = undefined;
    finishButton.hidden = true;
    library.replaceChildren();
    workspace.hidden = signOut.hidden = true;
    login.closest(".login").hidden = false;
    $("#studio-subtitle").textContent = "Owner access for ThinhDost.";
    message($("#login-status"), "");
    message(saveStatus, "");
    $("#access-token").focus();
  });
  $("#new-post").addEventListener("click", () => {
    if (!canDiscard()) return;
    resetEditor();
    renderLibrary();
    message(saveStatus, "");
    fields.title.focus();
  });
  finishButton.addEventListener("click", () => work(finishPublication));
  library.addEventListener("click", event => {
    const slug = event.target.closest("button")?.dataset.slug;
    if (slug && canDiscard()) work(async () => {
      revision = await repository.snapshot();
      await openPost(slug);
      message(saveStatus, "");
    });
  });
  postForm.addEventListener("input", () => {
    dirty = true;
    updatePreview();
  });
  postForm.addEventListener("submit", event => {
    event.preventDefault();
    const publishing = event.submitter?.value === "publish";
    work(async () => {
      message(saveStatus, publishing ? "Saving for publication…" : "Saving draft…");
      await save(publishing);
    });
  });
  $("#images").addEventListener("change", event => {
    const files = [...event.target.files];
    event.target.value = "";
    if (files.length) work(() => addImages(files));
  });
  body.addEventListener("paste", event => {
    const files = [...event.clipboardData.files];
    if (files.length) {
      event.preventDefault();
      work(() => addImages(files));
    }
  });
  window.addEventListener("beforeunload", event => {
    if (dirty) event.preventDefault();
  });
}
