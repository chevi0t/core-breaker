// 対戦サーバーは既存の戦闘処理を20Hzで動かす。クライアントは入力と描画だけを受け持つ。
const idOf = (u) => `${u.team}:${u.idx}`;
const scalars = (o) =>
  Object.fromEntries(
    Object.entries(o).filter(
      ([k, v]) =>
        !k.startsWith("online") &&
        (v === null || ["string", "number", "boolean"].includes(typeof v)),
    ),
  );
const vector = (v) => [v.x, v.y, v.z];
const assignVector = (v, a) => v.set(...a);
const swap = (dst, src) => {
  for (const k of Object.keys(dst)) delete dst[k];
  Object.assign(dst, src);
};
function materialState(m) {
  return m
    ? {
        opacity: m.opacity,
        color: m.color?.getHex(),
        emissive: m.emissive?.getHex(),
      }
    : null;
}
function treeState(root) {
  const nodes = [];
  root.traverse((o) => {
    nodes.push({
      p: o.position.toArray(),
      q: o.quaternion.toArray(),
      s: o.scale.toArray(),
      v: o.visible,
      m: Array.isArray(o.material)
        ? o.material.map(materialState)
        : materialState(o.material),
      // 頂点を毎フレーム動かす火花などだけを送る。機体は既存の描画処理を使う。
      a:
        o.isLineSegments || o.geometry?.attributes.position?.usage === 35048
          ? Array.from(o.geometry.attributes.position.array)
          : undefined,
    });
  });
  return nodes;
}
function applyTree(root, nodes) {
  let i = 0;
  root.traverse((o) => {
    const n = nodes[i++];
    if (!n) return;
    o.position.fromArray(n.p);
    o.quaternion.fromArray(n.q);
    o.scale.fromArray(n.s);
    o.visible = n.v;
    const mats = Array.isArray(o.material) ? o.material : [o.material],
      states = Array.isArray(n.m) ? n.m : [n.m];
    mats.forEach((m, j) => {
      const s = states[j];
      if (!m || !s) return;
      m.opacity = s.opacity;
      if (s.color != null) m.color?.setHex(s.color);
      if (s.emissive != null) m.emissive?.setHex(s.emissive);
    });
    if (n.a && o.geometry?.attributes.position) {
      o.geometry.attributes.position.array.set(n.a);
      o.geometry.attributes.position.needsUpdate = true;
    }
  });
}
function definition(root) {
  const saved = [];
  root.traverse((o) => {
    saved.push([o, o.userData]);
    o.userData = {};
  });
  try {
    return root.toJSON();
  } finally {
    for (const [o, data] of saved) o.userData = data;
  }
}
function dispose(root) {
  const textures = new Set();
  root.traverse((o) => {
    o.geometry?.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m?.map) textures.add(m.map);
      m?.dispose();
    }
  });
  for (const tex of textures) tex.dispose();
}
function facilityRoots(e) {
  return [
    ...e.plants,
    ...e.turrets,
    ...e.radars,
    ...e.barricades,
    ...e.lifts,
  ].flatMap((f) => Object.values(f).filter((v) => v?.isObject3D));
}
export function createAuthority(e) {
  const peers = new Map(),
    controls = new Map(),
    definitions = new Map(),
    sounds = [];
  let baseline,
    facilities,
    frame = 0;
  const withInput = (u, fn) => {
    const c = controls.get(u),
      saved = {
        player: e.player,
        keys: { ...e.keys },
        pressed: { ...e.pressed },
        buttons: e.buttons,
        lock: { ...e.lock },
        camera: e.camera.clone(),
        cursor: e.mapCursor,
        open: e.mapOpen,
      };
    try {
      e.player = u;
      swap(
        e.keys,
        c.input.keys.reduce((a, k) => ((a[k] = true), a), {}),
      );
      swap(
        e.pressed,
        c.input.pressed.reduce((a, k) => ((a[k] = true), a), {}),
      );
      e.buttons = {
        fire: c.input.fire,
        alt: c.input.alt,
        wheel: c.input.wheel,
      };
      swap(e.lock, c.lock);
      e.mapCursor = c.cursor;
      e.mapOpen = false;
      e.camera.fov = c.fov;
      e.camera.updateProjectionMatrix();
      e.updateCamera(u, 0);
      return fn(c);
    } finally {
      c.lock = { ...e.lock };
      c.fov = e.camera.fov;
      c.cursor = e.mapCursor;
      c.input.pressed = [];
      c.input.dx = c.input.dy = c.input.wheel = 0;
      c.input.actions = [];
      e.player = saved.player;
      swap(e.keys, saved.keys);
      swap(e.pressed, saved.pressed);
      e.buttons = saved.buttons;
      swap(e.lock, saved.lock);
      e.mapCursor = saved.cursor;
      e.mapOpen = saved.open;
      e.camera.copy(saved.camera);
      e.camera.updateMatrixWorld();
    }
  };
  const applyActions = (u, c) => {
    for (const a of c.input.actions) {
      if (a.type === "weapon" && Object.hasOwn(u.slots, a.value))
        e.selectWeapon(u, a.value);
      if (a.type === "class") e.classChoice(u, a.value);
      if (
        a.type === "spawn" &&
        e.spawnPoints(u.team).some((p) => p.id === a.value)
      )
        u.spawnChoice = a.value;
      if (a.type === "artillery" && a.point) {
        e.mapCursor = a.point;
        e.artilleryConfirm(u, a.point);
      }
      if (a.type === "cancelArtillery") e.stopArtillery(u);
      if (a.type === "chat" && u.alive)
        e.qchatSend(
          u,
          a.index,
          a.point ? new e.T.Vector3(a.point.x, 0, a.point.z) : null,
        );
    }
  };
  const ref = (target) =>
    target?.kind === "unit"
      ? idOf(target)
      : e.turrets.includes(target)
        ? `turret:${e.turrets.indexOf(target)}`
        : null;
  const game = {
    role: "authority",
    chat(u, text) {
      sounds.push({ chat: text, src: idOf(u) });
    },
    feedback(u, kind) {
      if (u) sounds.push({ feedback: kind, who: idOf(u) });
    },
    sound(name, at, src, rate) {
      if (sounds.length < 128)
        sounds.push({
          name,
          at: at ? vector(at) : null,
          src: src?.kind === "unit" ? idOf(src) : null,
          who: e.player ? idOf(e.player) : null,
          rate,
        });
    },
    updateDown(u, dt) {
      withInput(u, (c) => {
        applyActions(u, c);
        e.downTick(u, dt);
      });
    },
    updatePlayer(u, dt) {
      withInput(u, (c) => {
        applyActions(u, c);
        const sens =
          ((0.0025 * e.camera.fov) / 70) * (u.slots[u.weapon].w.turn || 1);
        u.yaw -= c.input.dx * sens;
        u.pitch = Math.max(-0.9, Math.min(0.7, u.pitch - c.input.dy * sens));
        if (c.input.alt && !c.alt && u.slots[u.weapon].w.scopeHigh)
          u.scopeStep = ((u.scopeStep || 0) + 1) % 3;
        c.alt = c.input.alt;
        if (u.transfer) e.respawnPanel(u);
        e.updateCamera(u, dt);
        e.playerUpdate(u, dt);
        u.target = e.lock.target;
        u.locked = !!e.lock.target;
      });
    },
  };
  function snapshot() {
    const roots = e.scene.children.filter(
      (o) =>
        !baseline.has(o) &&
        !e.pings.some((p) => p.mesh === o) &&
        !e.units.some((u) =>
          [u.group, u.beam, u.fieldMesh, u.barrierMesh].includes(o),
        ),
    );
    const visual = roots.map((o) => {
      const signature = [];
      o.traverse((n) =>
        signature.push(
          n.uuid,
          n.geometry?.uuid,
          n.material?.uuid,
          n.material?.map?.uuid,
        ),
      );
      const rev = signature.join(":");
      let def;
      if (definitions.get(o) !== rev) {
        definitions.set(o, rev);
        def = definition(o);
      }
      return { id: o.uuid, def, nodes: treeState(o) };
    });
    for (const o of definitions.keys())
      if (!roots.includes(o)) definitions.delete(o);
    const weaponKey = (w) => e.weaponKey(w);
    return {
      frame: ++frame,
      time: e.time,
      ended: e.ended,
      cores: { B: e.cores.B.hp, R: e.cores.R.hp },
      units: e.units.map((u) => ({
        ...scalars(u),
        id: idOf(u),
        mech: u.mech,
        onlinePilot: u.onlinePilot,
        pos: vector(u.pos),
        vel: vector(u.vel),
        aimPos: vector(u.aimPos),
        lungeDir: vector(u.lungeDir),
        sc: { ...u.sc },
        partArmor: u.partArmor,
        slots: Object.fromEntries(
          Object.entries(u.slots).map(([k, s]) => [
            k,
            { ...scalars(s), w: weaponKey(s.w) },
          ]),
        ),
        swing: u.swing ? { ...scalars(u.swing), a: u.swing.a, hit: [] } : null,
        transfer: u.transfer ? scalars(u.transfer) : null,
        downBy: u.downBy?.kind === "unit" ? idOf(u.downBy) : null,
        target: u.target?.kind === "unit" ? idOf(u.target) : null,
        healTarget: u.healTarget?.kind === "unit" ? idOf(u.healTarget) : null,
        post: u.post ? {} : null,
        lift: u.lift ? { blocked: u.lift.blocked } : null,
        zip: u.zip ? {} : null,
        jumpPad: u.jumpPad ? {} : null,
      })),
      players: [...peers].map(([id, u]) => ({
        id,
        unit: idOf(u),
        ack: controls.get(u).input.seq,
        lock: ref(controls.get(u).lock.target),
        visible: controls.get(u).lock.visible,
      })),
      plants: e.plants.map((p) => scalars(p)),
      facilities: facilities.map(treeState),
      facilityData: [e.turrets, e.radars, e.barricades].map((list) =>
        list.map((f) => ({
          ...scalars(f),
          target: f.target?.kind === "unit" ? idOf(f.target) : null,
        })),
      ),
      pings: e.pings.map((p) => ({ ...scalars(p), pos: vector(p.pos) })),
      spotSrc: Object.fromEntries(
        ["B", "R"].map((t) => [
          t,
          [...e.spotSrc[t]]
            .filter(([u]) => u.kind === "unit")
            .map(([u, src]) => [idOf(u), [...src]]),
        ]),
      ),
      spotted: Object.fromEntries(
        ["B", "R"].map((t) => [
          t,
          [...e.spotted[t]]
            .filter(([u]) => u.kind === "unit")
            .map(([u, time]) => [idOf(u), time]),
        ]),
      ),
      drones: e.drones.map((d) => ({
        ...scalars(d),
        pos: vector(d.pos),
        spec: scalars(d.spec),
      })),
      gadgets: e.gadgets.map((g) => ({
        ...scalars(g),
        spec: scalars(g.spec),
        pos: vector(g.pos),
        owner: g.owner?.kind === "unit" ? idOf(g.owner) : null,
      })),
      sounds: sounds.splice(0),
      visual,
    };
  }
  return {
    engine: e,
    start(config) {
      e.game = game;
      e.boot(config.map);
      // 人間の枠だけ置き換える。残りは既存と同じBOT。
      for (const p of config.players) {
        const u = e.create(p);
        peers.set(p.id, u);
        controls.set(u, {
          input: {
            seq: -1,
            keys: [],
            pressed: [],
            dx: 0,
            dy: 0,
            wheel: 0,
            fire: false,
            alt: false,
            actions: [],
          },
          lock: { ...e.lock },
          fov: 70,
          cursor: { x: 0, z: 0 },
          seen: performance.now(),
        });
      }
      for (const u of e.units)
        if (!u.isPlayer)
          u.name = (u.team === "B" ? "青" : "橙") + "BOT" + (u.idx + 1);
      e.player = peers.values().next().value;
      e.running = true;
      e.show();
      baseline = new Set(e.scene.children);
      facilities = facilityRoots(e);
      e.scene.updateMatrixWorld(true);
    },
    tick(batch) {
      for (const [id, input] of batch) {
        const u = peers.get(id);
        if (u) {
          const c = controls.get(u);
          c.input = input;
          c.seen = performance.now();
        }
      }
      for (const [u, c] of controls) {
        if (!u.alive) {
          c.lock.target = c.lock.cand = c.lock.prevAng = null;
          c.lock.visible = false;
          c.lock.acqT = 0;
        }
        if (performance.now() - c.seen > 750) {
          c.input.keys = [];
          c.input.fire = c.input.alt = false;
        }
        if (!u.alive && !(u.downT > 0)) {
          withInput(u, (c) => {
            applyActions(u, c);
            if (c.input.pressed.includes("KeyF")) u.downT = 0;
            e.respawnPanel(u);
          });
        }
      }
      e.tick();
      return snapshot();
    },
    disconnect(id) {
      const u = peers.get(id);
      if (u) {
        u.isPlayer = false;
        u.name += "（BOT）";
        controls.delete(u);
        peers.delete(id);
      }
    },
  };
}
export function createReplica(e, config, peerId, send) {
  let current = null,
    lastAt = 0,
    closed = false,
    seq = 0,
    dx = 0,
    dy = 0,
    wheel = 0,
    fire = false,
    alt = false,
    tapFire = false,
    tapAlt = false;
  const held = new Set(),
    pressed = new Set(),
    actions = [],
    visual = new Map(),
    pendingLook = [],
    targets = new Map();
  let facilities = [],
    pingKey = "";
  const loader = new e.T.ObjectLoader();
  const game = {
    role: "replica",
    action(type, value, point, index) {
      actions.push({
        type,
        value,
        point: point ? { x: point.x, z: point.z } : null,
        index,
      });
    },
    renderStep(dt) {
      const k = Math.min(1, dt * 22);
      for (const [u, p] of targets) u.pos.lerp(p, k);
      if (e.player && current) {
        e.annTick();
      }
      if (current && performance.now() - lastAt > 3000) {
        fire = alt = false;
        held.clear();
      }
    },
  };
  e.game = game;
  e.boot(config.map);
  e.running = true;
  e.show();
  facilities = facilityRoots(e);
  const onKey = (eve) => {
    if (!e.running || !document.getElementById("overlay").hidden) return;
    if (eve.target.matches("input,textarea,select")) return;
    if (eve.type === "keydown") {
      held.add(eve.code);
      if (!eve.repeat) pressed.add(eve.code);
    } else held.delete(eve.code);
  };
  const onMouse = (eve) => {
    if (eve.type === "mousedown" && (e.mapOpen || e.isArtilleryMode(e.player)))
      return;
    if (
      eve.target !== document.querySelector("canvas") &&
      eve.type === "mousedown"
    )
      return;
    if (eve.button === 0) {
      fire = eve.type === "mousedown";
      tapFire ||= fire;
    }
    if (eve.button === 2) {
      alt = eve.type === "mousedown";
      tapAlt ||= alt;
    }
  };
  const onMove = (ev) => {
    if (
      !e.running ||
      (!document.pointerLockElement && !fire) ||
      Math.abs(ev.movementX) > 250 ||
      Math.abs(ev.movementY) > 250 ||
      e.lookBlocked
    )
      return;
    dx += ev.movementX;
    dy += ev.movementY;
  };
  const onWheel = (ev) => {
    if (!document.getElementById("overlay").hidden || e.keys.Tab) return;
    wheel = Math.sign(ev.deltaY);
  };
  const clear = () => {
    held.clear();
    pressed.clear();
    swap(e.keys, {});
    swap(e.pressed, {});
    e.buttons = { fire: false, alt: false, wheel: 0 };
    fire = alt = tapFire = tapAlt = false;
  };
  const listeners = [
    ["keydown", onKey],
    ["keyup", onKey],
    ["mousedown", onMouse],
    ["mouseup", onMouse],
    ["mousemove", onMove],
    ["wheel", onWheel],
    ["blur", clear],
  ];
  for (const [t, fn] of listeners) window.addEventListener(t, fn);
  const onPointer = () => {
    if (!document.pointerLockElement) fire = alt = tapFire = tapAlt = false;
  };
  document.addEventListener("pointerlockchange", onPointer);
  const timer = setInterval(() => {
    if (closed || !e.running) return;
    if (!document.getElementById("overlay").hidden) clear();
    const packet = {
      seq: ++seq,
      keys: [...held],
      pressed: [...pressed],
      dx,
      dy,
      wheel,
      fire: fire || tapFire,
      alt: alt || tapAlt,
      actions: actions.splice(0),
    };
    if (dx || dy) pendingLook.push({ seq, dx, dy });
    if (pendingLook.length > 100) pendingLook.shift();
    send({ type: "input", input: packet });
    pressed.clear();
    dx = dy = wheel = 0;
    tapFire = tapAlt = false;
  }, 50);
  return {
    game,
    apply(state) {
      lastAt = performance.now();
      current = state;
      e.time = state.time;
      e.cores.B.hp = state.cores.B;
      e.cores.R.hp = state.cores.R;
      const me = state.players.find((p) => p.id === peerId);
      while (pendingLook.length && pendingLook[0].seq <= (me?.ack ?? -1))
        pendingLook.shift();
      for (const raw of state.units) {
        let u = e.units.find((u) => idOf(u) === raw.id);
        const signature = JSON.stringify([raw.mech, raw.cls]);
        if (u.onlineModel !== signature) {
          targets.delete(u);
          const ld = {
            [raw.cls]: Object.fromEntries(
              Object.entries(raw.slots).map(([k, s]) => [k, s.w]),
            ),
          };
          u = e.create({
            team: raw.team,
            index: raw.idx,
            profile: {
              cls: raw.cls,
              name: raw.name,
              mech: raw.mech,
              loadout: ld,
              pilot: raw.onlinePilot,
            },
          });
          u.onlineModel = signature;
        }
        const first = !targets.has(u),
          wasAlive = u.alive,
          wasDown = u.downT > 0;
        Object.assign(u, scalars(raw));
        u.onlinePilot = raw.onlinePilot;
        u.sc = raw.sc;
        u.partArmor = raw.partArmor;
        u.transfer = raw.transfer;
        u.swing = raw.swing ? { ...raw.swing, hit: new Set() } : null;
        u.post = raw.post;
        u.lift = raw.lift;
        u.zip = raw.zip;
        u.jumpPad = raw.jumpPad;
        u.group.visible = u.alive || raw.downT > 0;
        for (const k of ["vel", "aimPos", "lungeDir"])
          assignVector(u[k], raw[k]);
        const target = new e.T.Vector3(...raw.pos);
        targets.set(u, target);
        if (first || (!wasAlive && u.alive) || u.pos.distanceTo(target) > 15)
          u.pos.copy(target);
        for (const [k, s] of Object.entries(raw.slots))
          u.slots[k] = { ...s, w: e.weapon(s.w) };
        if (raw.id === me?.unit) {
          e.player = u;
          if (!u.alive && raw.downT <= 0 && (wasAlive || wasDown))
            e.deathCamera(
              u,
              e.units.find((v) => idOf(v) === raw.downBy),
            );
          const sens =
            ((0.0025 * e.camera.fov) / 70) * (u.slots[u.weapon].w.turn || 1);
          const look = pendingLook.reduce(
            (a, p) => [a[0] + p.dx, a[1] + p.dy],
            [dx, dy],
          );
          u.yaw -= look[0] * sens;
          u.pitch = Math.max(-0.9, Math.min(0.7, u.pitch - look[1] * sens));
        }
      }
      for (const raw of state.units) {
        const u = e.units.find((u) => idOf(u) === raw.id);
        u.healTarget = e.units.find((v) => idOf(v) === raw.healTarget) || null;
        u.target = e.units.find((v) => idOf(v) === raw.target) || null;
      }
      e.lock.target =
        e.units.find((u) => idOf(u) === me?.lock) ||
        (me?.lock?.startsWith("turret:")
          ? e.turrets[Number(me.lock.split(":")[1])]
          : null) ||
        null;
      e.lock.visible = me?.visible || false;
      state.plants.forEach((p, i) => {
        Object.assign(e.plants[i], p);
        e.paintPlant(e.plants[i]);
      });
      state.facilities.forEach((n, i) => applyTree(facilities[i], n));
      state.facilityData.forEach((list, i) =>
        list.forEach((s, j) =>
          Object.assign([e.turrets, e.radars, e.barricades][i][j], s, {
            target: e.units.find((u) => idOf(u) === s.target) || null,
          }),
        ),
      );
      for (const t of ["B", "R"]) {
        e.spotSrc[t].clear();
        for (const [id, src] of state.spotSrc[t]) {
          const u = e.units.find((v) => idOf(v) === id);
          if (u) e.spotSrc[t].set(u, new Map(src));
        }
        e.spotted[t].clear();
        for (const [id, time] of state.spotted[t]) {
          const u = e.units.find((v) => idOf(v) === id);
          if (u) e.spotted[t].set(u, time);
        }
      }
      e.drones.length = 0;
      for (const d of state.drones)
        e.drones.push({ ...d, pos: new e.T.Vector3(...d.pos) });
      e.gadgets.length = 0;
      for (const g of state.gadgets)
        e.gadgets.push({
          ...g,
          pos: new e.T.Vector3(...g.pos),
          owner: e.units.find((u) => idOf(u) === g.owner),
        });
      const active = new Set();
      for (const v of state.visual) {
        active.add(v.id);
        if (v.def) {
          if (visual.has(v.id)) {
            const old = visual.get(v.id);
            e.scene.remove(old);
            dispose(old);
          }
          const root = loader.parse(v.def);
          visual.set(v.id, root);
          e.scene.add(root);
        }
        const root = visual.get(v.id);
        if (root) applyTree(root, v.nodes);
      }
      for (const [id, root] of visual)
        if (!active.has(id)) {
          e.scene.remove(root);
          dispose(root);
          visual.delete(id);
        }
      const nextPingKey = JSON.stringify(
        (state.pings || []).map((p) => [p.team, p.pos, p.text]),
      );
      if (nextPingKey !== pingKey) {
        e.clearPings();
        for (const p of state.pings || [])
          e.addPing(p.team, new e.T.Vector3(...p.pos), p.text);
        pingKey = nextPingKey;
      }
      for (const s of state.sounds || []) {
        if (s.chat) {
          const u = e.units.find((u) => idOf(u) === s.src);
          if (u) e.chatLine(u, s.chat);
          continue;
        }
        if (s.feedback) {
          if (s.who === me?.unit) {
            if (s.feedback === "hurt") e.flashDamage();
            else e.hitMark(s.feedback === "head");
          }
          continue;
        }
        const src = e.units.find((u) => idOf(u) === s.src);
        if (s.at || s.who === me?.unit)
          e.sfx(s.name, s.at ? new e.T.Vector3(...s.at) : null, src, s.rate);
      }
      if (state.ended && !e.ended) e.finish();
    },
    get state() {
      return current;
    },
    close() {
      closed = true;
      clearInterval(timer);
      document.removeEventListener("pointerlockchange", onPointer);
      for (const [t, fn] of listeners) window.removeEventListener(t, fn);
      for (const root of visual.values()) {
        e.scene.remove(root);
        dispose(root);
      }
      visual.clear();
      targets.clear();
      // 受信した設置物は描画用の情報。モデルの破棄は上のvisualで済ませる。
      e.gadgets.length = e.drones.length = 0;
      clear();
      e.reset();
    },
  };
}
