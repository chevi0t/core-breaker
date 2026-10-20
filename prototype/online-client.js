import { createReplica } from "./online-game.js";
export function mountLobby(root, e) {
  root.innerHTML = `<p>10対10・空いている枠はBOT。2〜20人で開始できます。装備と名前は準備完了時の設定を使います。</p>
    <p id="netStatus" role="status">接続中…</p><p id="netError" role="alert" style="color:#ffb38c"></p>
    <div id="netEntry"><button type="button" id="netCreate">部屋を作る</button>
    <label>部屋コード <input id="netCode" maxlength="6" autocomplete="off" style="text-transform:uppercase;width:9em"></label><button type="button" id="netJoin">参加する</button></div>
    <div id="netRoom" hidden><p>部屋コード：<strong id="netRoomCode" style="font-size:1.8em;letter-spacing:.15em"></strong></p>
    <label>マップ <select id="netMap"><option value="city">丘の市街地</option><option value="wide">広域演習場</option><option value="tidal">潮路搬送区 ～屈折前線～</option><option value="tidal-v2">潮路搬送区 ～上層干渉～</option><option value="tidal-v3">潮路搬送区 ～複路争奪～</option></select></label>
    <p id="netCount"></p><ul id="netPlayers"></ul>
    <button type="button" id="netReady">準備完了</button><button type="button" id="netStart">試合開始</button>
    <button type="button" id="netResume" hidden>試合へ戻る</button><button type="button" id="netRematch" hidden>次の試合を準備</button><button type="button" id="netLeave">退出する</button></div>`;
  const $ = (id) => root.querySelector("#" + id);
  let socket = null,
    id = null,
    room = null,
    replica = null;
  const bar = document.createElement("button");
  bar.type = "button";
  bar.textContent = "オンラインの部屋へ";
  bar.hidden = true;
  bar.style.cssText =
    "position:fixed;right:12px;top:12px;z-index:50;background:#122532e8;color:#e1f3ff;border:1px solid #6ab2db;padding:7px;cursor:pointer";
  document.body.append(bar);
  const status = (text) => {
    $("netStatus").textContent = text;
  };
  const send = (msg) => {
    if (socket?.readyState === WebSocket.OPEN) {
      if (msg.type !== "input") $("netError").textContent = "";
      socket.send(JSON.stringify(msg));
    }
  };
  function render() {
    const inRoom = !!room;
    $("netEntry").hidden = inRoom;
    $("netRoom").hidden = !inRoom;
    for (const name of ["netCreate", "netJoin"])
      $(name).disabled = socket?.readyState !== WebSocket.OPEN;
    if (!room) return;
    const host = room.host === id,
      me = room.players.find((p) => p.id === id),
      lobby = room.phase === "lobby";
    $("netRoomCode").textContent = room.code;
    $("netMap").value = room.map;
    $("netMap").disabled = !host || !lobby;
    const n = (t) => room.players.filter((p) => p.team === t).length;
    $("netCount").textContent =
      `青：人間${n("B")}＋BOT${10 - n("B")}　／　橙：人間${n("R")}＋BOT${10 - n("R")}`;
    $("netPlayers").replaceChildren(
      ...room.players.map((p) => {
        const li = document.createElement("li");
        li.textContent = `${p.team === "B" ? "青" : "橙"}　${p.name}${p.id === id ? "（あなた）" : ""}${p.id === room.host ? "［部屋主］" : ""}　${p.ready ? "準備完了" : "準備中"}`;
        return li;
      }),
    );
    $("netReady").hidden = !lobby;
    $("netReady").textContent = me?.ready ? "準備を取り消す" : "準備完了";
    $("netStart").hidden = !host || !lobby;
    $("netStart").disabled =
      room.players.length < 2 || room.players.some((p) => !p.ready);
    $("netResume").hidden = !replica || room.phase !== "match";
    $("netRematch").hidden = !host || room.phase !== "finished";
    if (room.phase === "loading")
      status("サーバーで20機の試合を準備しています…");
    else if (lobby)
      status(
        host
          ? "コードを友達に伝え、全員の準備ができたら開始してください。"
          : "部屋主の開始を待っています。",
      );
    else if (room.phase === "finished")
      status("試合終了。部屋主が次の試合を準備できます。");
    else status("対戦中。退出した人の枠はBOTが引き継ぎます。");
  }
  function closeReplica() {
    replica?.close();
    replica = null;
    bar.hidden = true;
  }
  function connect() {
    socket = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rooms`,
    );
    socket.addEventListener("open", () => {
      status("接続しました。部屋を作るかコードを入力してください。");
      render();
    });
    socket.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "hello") {
        id = msg.id;
        return;
      }
      if (msg.type === "error") {
        $("netError").textContent = msg.message;
        return;
      }
      if (msg.type === "room") {
        if (msg.room.phase === "lobby" && replica) {
          closeReplica();
          e.menu();
        }
        room = msg.room;
        render();
        return;
      }
      if (msg.type === "left") {
        closeReplica();
        room = null;
        e.menu();
        render();
        status("退出しました。");
        return;
      }
      if (msg.type === "match") {
        closeReplica();
        replica = createReplica(e, msg.config, id, send);
        bar.hidden = false;
        return;
      }
      if (msg.type === "state" && replica) replica.apply(msg.state);
    });
    socket.addEventListener("close", () => {
      closeReplica();
      room = null;
      render();
      e.menu();
      status("接続が切れました。再接続してから部屋へ入り直してください。");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "再接続";
      retry.onclick = () => {
        retry.remove();
        connect();
      };
      $("netStatus").append(" ", retry);
    });
    socket.addEventListener("error", () =>
      status(
        "対戦サーバーに接続できません。URLとサーバーの起動状態を確認してください。",
      ),
    );
  }
  $("netCreate").onclick = () => send({ type: "create", profile: e.profile });
  $("netJoin").onclick = () =>
    send({ type: "join", code: $("netCode").value, profile: e.profile });
  $("netReady").onclick = () =>
    send({
      type: "ready",
      ready: !room?.players.find((p) => p.id === id)?.ready,
      profile: e.profile,
    });
  $("netStart").onclick = () => send({ type: "start" });
  $("netLeave").onclick = () => send({ type: "leave" });
  $("netRematch").onclick = () => send({ type: "rematch" });
  $("netMap").onchange = (ev) => send({ type: "map", map: ev.target.value });
  $("netResume").onclick = () => e.show();
  bar.onclick = () => e.menu();
  for (const input of root.querySelectorAll("input,select"))
    for (const type of ["keydown", "keyup"])
      input.addEventListener(type, (ev) => ev.stopPropagation());
  connect();
  render();
  return {
    show() {
      e.menu();
      render();
    },
  };
}
