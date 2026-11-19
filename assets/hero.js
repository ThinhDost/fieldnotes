(() => {
  const runtime = document.querySelector("[data-hero-runtime]");
  if (!runtime) return;

  const visual = runtime.querySelector(".runtime-visual");
  const terminal = runtime.querySelector(".runtime-terminal");
  const canvas = runtime.querySelector("canvas");
  const pen = canvas.getContext("2d");
  if (!pen) return;

  const play = runtime.querySelector(".runtime-play");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const width = canvas.width;
  const height = canvas.height;
  const density = Math.min(3, Math.max(2, devicePixelRatio || 1));
  canvas.width = width * density;
  canvas.height = height * density;
  pen.scale(density, density);

  const caret = document.createElement("span");
  caret.className = "runtime-caret";
  const rows = [...terminal.querySelectorAll("[data-at]")].map(row => {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      parts.push({ node, text: node.data });
    }
    return {
      start: Number(row.dataset.at),
      duration: Number(row.dataset.ms || 0),
      length: parts.reduce((sum, { text }) => sum + text.length, 0),
      parts,
    };
  });

  function drawTerminal(time, playing) {
    let activeNode;
    for (const { parts, start, duration, length } of rows) {
      const fraction = duration ? Math.max(0, Math.min(1, (time - start) / duration)) : Number(time >= start);
      let count = Math.floor(length * fraction);
      for (const { node, text } of parts) {
        const visible = Math.min(text.length, count);
        if (node.length !== visible) node.data = text.slice(0, visible);
        if (visible) activeNode = node;
        count -= visible;
      }
    }
    if (!playing && time >= scenes[0].duration) caret.remove();
    else if (activeNode && activeNode.nextSibling !== caret) activeNode.after(caret);
    else if (!activeNode) terminal.querySelector("code").prepend(caret);
  }

  const mono = 'Consolas, "Courier New", monospace';
  let colors;
  function readColors() {
    const css = getComputedStyle(runtime);
    const keys = ["bg", "panel", "edge", "grid", "text", "muted", "accent", "signal"];
    colors = Object.fromEntries(keys.map(key => [key, css.getPropertyValue(`--runtime-${key}`).trim()]));
  }

  function line(points, color, weight = 1) {
    pen.beginPath();
    pen.moveTo(...points[0]);
    for (const point of points.slice(1)) pen.lineTo(...point);
    pen.strokeStyle = color;
    pen.lineWidth = weight;
    pen.stroke();
  }

  function label(text, x, y, color = colors.muted, size = 12, align = "left") {
    pen.font = `${size}px ${mono}`;
    pen.textAlign = align;
    pen.fillStyle = color;
    pen.fillText(text, x, y);
  }

  function dot(x, y, radius, tint) {
    pen.beginPath();
    pen.arc(x, y, radius, 0, Math.PI * 2);
    pen.fillStyle = tint;
    pen.fill();
  }

  function box(x, y, w, h, fill, stroke) {
    pen.beginPath();
    pen.roundRect(x, y, w, h, 5);
    pen.fillStyle = fill;
    pen.strokeStyle = stroke;
    pen.lineWidth = 1;
    pen.fill();
    pen.stroke();
  }

  function clearFrame() {
    pen.clearRect(0, 0, width, height);
  }

  function wave(x, y, time, output) {
    box(x, y, 96, 62, colors.bg, colors.edge);
    line([[x + 8, y + 31.5], [x + 88, y + 31.5]], colors.grid);
    const points = Array.from({ length: 80 }, (_, i) => {
      const raw = Math.sin(i / 10 - time / 440) * 14;
      const amplitude = output ? Math.tanh(raw / 9) * 13 : raw;
      return [x + 8 + i, y + 31 - amplitude];
    });
    line(points, output ? colors.signal : colors.accent, 1.7);
  }

  const neuralLayers = [
    [[178, 112], [178, 151], [178, 190]],
    [[280, 94], [280, 132], [280, 170], [280, 208]],
    [[382, 112], [382, 151], [382, 190]],
  ];

  function drawNeural(time) {
    clearFrame();
    label("model.forward(x)", 22, 45, colors.text, 23);
    wave(22, 120, time, false);
    wave(442, 120, time, true);
    label("INPUT", 22, 207);
    label("HIDDEN LAYER", 280, 239, colors.muted, 12, "center");
    label("OUTPUT", 538, 207, colors.muted, 12, "right");
    line([[118, 151], [178, 151]], colors.accent);
    line([[382, 151], [442, 151]], colors.signal);

    for (const [index, layer] of neuralLayers.slice(0, -1).entries()) {
      const phase = (time / 1600 + (index ? .5 : 0)) % 1;
      for (const [i, [x, y]] of layer.entries()) {
        for (const [j, [toX, toY]] of neuralLayers[index + 1].entries()) {
          line([[x, y], [toX, toY]], colors.edge, 1.2);
          if ((i + j + index) % 3 === 0) {
            dot(x + (toX - x) * phase, y + (toY - y) * phase, 2.7, colors.signal);
          }
        }
      }
    }
    for (const [index, layer] of neuralLayers.entries()) {
      for (const [x, y] of layer) {
        dot(x, y, 8.8, colors.edge);
        dot(x, y, 7.5, colors.panel);
        dot(x, y, 2.9, index === 2 ? colors.signal : colors.accent);
      }
    }
  }

  const instructions = [
    ["00", "mov eax, 7", "00000007"],
    ["05", "add eax, 5", "0000000C"],
    ["08", "imul eax, eax, 3", "00000024"],
    ["0B", "ret", "00000024"],
  ];
  const stages = ["IF", "ID", "EX", "WB"];

  function drawAssembly(time) {
    clearFrame();
    const tick = Math.min(6, Math.floor(time / 590));
    label("cpu.trace()", 22, 44, colors.text, 23);
    label("CLK", 264, 73);
    const clock = [];
    for (let i = 0; i <= 14; i++) {
      const x = 308 + i * 16;
      const previous = 66 + (i % 2 ? -5 : 5);
      clock.push([x, previous], [x, 132 - previous]);
    }
    line(clock, colors.accent);

    for (const [row, [offset, instruction]] of instructions.entries()) {
      const y = 102 + row * 32;
      const stage = tick - row;
      const executing = stage === 2;
      box(19, y - 12, 231, 25, executing ? colors.panel : colors.bg, executing ? colors.accent : colors.edge);
      label(`+${offset}`, 27, y + 5, colors.muted, 12);
      label(instruction, 67, y + 5, executing ? colors.signal : colors.text, 14);
      for (const [i, name] of stages.entries()) {
        const x = 308 + (row + i) * 32;
        const active = i === stage;
        box(x, y - 12, 28, 25, active ? colors.edge : colors.bg, active ? colors.accent : colors.edge);
        label(name, x + 14, y + 4, active ? colors.text : colors.muted, 11, "center");
      }
    }
    label("EAX", 22, 239, colors.muted, 13);
    label(instructions[tick - 3]?.[2] ?? (tick >= 3 ? instructions[3][2] : "00000000"), 66, 239, colors.signal, 15);
    label("FETCH / DECODE / EXECUTE / WRITE", 538, 239, colors.muted, 11, "right");
  }

  const terrain = [
    [0, 0, 1, 1, 1, 0, 0],
    [0, 1, 1, 2, 1, 1, 0],
    [1, 1, 3, 4, 2, 1, 1],
    [1, 2, 4, 5, 3, 2, 1],
    [1, 1, 3, 4, 3, 1, 1],
    [0, 1, 1, 2, 1, 1, 0],
    [0, 0, 1, 1, 1, 0, 0],
  ];

  function face(points, color, stroke) {
    pen.beginPath();
    pen.moveTo(...points[0]);
    for (const point of points.slice(1)) pen.lineTo(...point);
    pen.closePath();
    pen.fillStyle = color;
    pen.strokeStyle = stroke;
    pen.lineWidth = .9;
    pen.fill();
    pen.stroke();
  }

  function drawGeometry(time) {
    clearFrame();
    label("memory.reshape(3D)", 22, 43, colors.text, 23);
    const angle = .56 + .44 * (time / scenes[3].duration);
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const depth = (x, y) => x * sin + y * cos;
    const project = (x, y, z = 0) => [321 + (x * cos - y * sin) * 24, 173 + depth(x, y) * 11 - z * 13];

    function prism(x, y, size, z, step, accent) {
      const square = [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
      const top = square.map(([u, v]) => project(u, v, z + step));
      const bottom = square.map(([u, v]) => project(u, v, z));
      face([top[1], top[2], bottom[2], bottom[1]], accent ? colors.muted : colors.edge, colors.bg);
      face([top[2], top[3], bottom[3], bottom[2]], accent ? colors.edge : colors.panel, colors.bg);
      face(top, accent ? colors.accent : colors.edge, colors.bg);
    }

    prism(-4.6, -4.6, 9.2, -.46, .46, false);
    for (let i = -4; i <= 4; i++) {
      line([project(i, -4.6), project(i, 4.6)], colors.panel);
      line([project(-4.6, i), project(4.6, i)], colors.panel);
    }
    const tiles = terrain.flatMap((row, y) => row.map((stack, x) => ({ x: x - 3.5, y: y - 3.5, stack })));
    tiles.sort((a, b) => depth(a.x, a.y) - depth(b.x, b.y));
    for (const { x, y, stack } of tiles) {
      const start = 180 + (x + y + 7) * 93;
      const full = Math.max(0, Math.min(1, (time - start) / 1720));
      if (stack && full) prism(x, y, 1, 0, stack * (1 - (1 - full) ** 2), true);
    }
    line([[51, 218], [81, 232]], colors.muted);
    line([[51, 218], [24, 231]], colors.muted);
    line([[51, 218], [51, 185]], colors.signal);
    label("x", 86, 238);
    label("y", 16, 237);
    label("z", 47, 178, colors.signal);
    label("7 × 7 VOXEL GRID", 537, 243, colors.muted, 12, "right");
  }

  const scenes = [
    { duration: 5500, caption: "A simulated terminal types an object-oriented joke: class Hacker extends Human and solves CTF by calling tryAgain.", draw: drawTerminal },
    { duration: 4100, caption: "Neural circuit with an input waveform, three node layers, and an output waveform.", draw: drawNeural },
    { duration: 4300, caption: "A toy CPU pipeline processing x86 arithmetic and updating the EAX register.", draw: drawAssembly },
    { duration: 4600, caption: "A rotating isometric voxel grid with blocks rising to form a memory terrain.", draw: drawGeometry },
  ];

  let index = 0;
  let elapsed = 0;
  let playing = !motion.matches;
  let previous = null;
  let frame = 0;
  let ghost;
  let entrance;
  function draw() {
    scenes[index].draw(elapsed, playing);
  }

  function sync() {
    const scene = scenes[index];
    visual.setAttribute("aria-label", scene.caption);
    terminal.hidden = index !== 0;
    canvas.hidden = index === 0;
    play.hidden = motion.matches;
    play.textContent = playing ? "Pause" : "Play";
    play.setAttribute("aria-label", `${play.textContent} hero animation`);
  }

  function clearTransition() {
    entrance?.cancel();
    entrance = undefined;
    ghost?.remove();
    ghost = undefined;
  }

  function changeScene(next, time = 0) {
    if (next === index || motion.matches) {
      index = next;
      elapsed = time;
      return;
    }

    const current = index === 0 ? terminal : canvas;
    const opacity = getComputedStyle(current).opacity;
    clearTransition();
    const outgoing = current.cloneNode(true);
    outgoing.classList.add("runtime-exit");
    outgoing.setAttribute("aria-hidden", "true");
    if (current === canvas) outgoing.getContext("2d").drawImage(canvas, 0, 0);
    visual.append(outgoing);
    ghost = outgoing;
    index = next;
    elapsed = time;

    const options = { duration: 640, easing: "cubic-bezier(.25,.7,.25,1)" };
    const incoming = index === 0 ? terminal : canvas;
    entrance = incoming.animate(
      [{ opacity: 0, transform: "translateY(9px)" }, { opacity: 1, transform: "none" }],
      options,
    );
    outgoing.animate(
      [{ opacity, transform: "none" }, { opacity: 0, transform: "translateY(-9px)" }],
      options,
    ).onfinish = () => {
      outgoing.remove();
      if (ghost === outgoing) ghost = undefined;
    };
  }

  function tick(now) {
    if (previous !== null) elapsed = Math.min(scenes[index].duration, elapsed + Math.min(80, now - previous));
    previous = now;
    if (elapsed >= scenes[index].duration) {
      draw();
      changeScene((index + 1) % scenes.length);
      sync();
    }
    draw();
    frame = playing ? requestAnimationFrame(tick) : 0;
  }

  function update() {
    cancelAnimationFrame(frame);
    previous = null;
    sync();
    draw();
    frame = playing ? requestAnimationFrame(tick) : 0;
  }

  play.addEventListener("click", () => {
    if (!playing && elapsed >= scenes[index].duration) elapsed = 0;
    playing = !playing;
    update();
  });
  motion.addEventListener("change", () => {
    if (motion.matches) {
      clearTransition();
      playing = false;
      elapsed = scenes[index].duration;
    }
    update();
  });
  new MutationObserver(() => {
    readColors();
    draw();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  if (motion.matches) elapsed = scenes[0].duration;
  readColors();
  update();
})();
