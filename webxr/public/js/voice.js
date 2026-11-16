// Optional voice chat for players who are NOT in the same real room (in the same room it would echo).
// Off until someone presses the MIC button. Audio goes straight between the browsers (WebRTC);
// the room server only passes along the short "handshake" messages.

const ICE = [{ urls: "stun:stun.l.google.com:19302" }];

export class Voice {
  constructor(net) {
    this.net = net;
    this.on = false;
    this.stream = null;
    this.peers = new Map();        // player id -> { pc, audio }
    this.error = "";
    net.on("say", (from, d) => { if (d && d.voice === "on") this._peerOn(from); if (d && d.voice === "off") this._drop(from); });
    net.on("rtc", (from, d) => this._signal(from, d));
    net.on("leave", (id) => this._drop(id));
    net.on("welcome", () => { for (const id of [...this.peers.keys()]) this._drop(id); if (this.on) this.net.say({ voice: "on" }); });
  }
  get connected() { let n = 0; for (const p of this.peers.values()) if (p.pc.connectionState === "connected") n++; return n; }

  async enable() {
    if (this.on) return true;
    this.error = "";
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { this.error = "microphone blocked"; return false; }
    this.on = true;
    this.net.say({ voice: "on" });
    return true;
  }
  disable() {
    if (!this.on) return;
    this.on = false;
    this.net.say({ voice: "off" });
    for (const id of [...this.peers.keys()]) this._drop(id);
    if (this.stream) { for (const t of this.stream.getTracks()) t.stop(); this.stream = null; }
  }

  // Someone else switched their mic on. The player with the lower id makes the call.
  _peerOn(id) {
    if (!this.on || !this.net.me) return;
    if (this.net.me.id < id) this._call(id);
    else this.net.rtc(id, { hello: 1 });
  }
  _pc(id) {
    let p = this.peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const audio = new Audio(); audio.autoplay = true;
    p = { pc, audio };
    this.peers.set(id, p);
    for (const t of this.stream.getTracks()) pc.addTrack(t, this.stream);
    pc.onicecandidate = (e) => { if (e.candidate) this.net.rtc(id, { ice: e.candidate }); };
    pc.ontrack = (e) => { audio.srcObject = e.streams[0]; const pr = audio.play(); if (pr && pr.catch) pr.catch(() => {}); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") this._drop(id); };
    return p;
  }
  async _call(id) {
    this._drop(id);
    const { pc } = this._pc(id);
    try { await pc.setLocalDescription(await pc.createOffer()); this.net.rtc(id, { sdp: pc.localDescription }); } catch (e) { this._drop(id); }
  }
  async _signal(from, d) {
    if (!this.on || !d) return;
    try {
      if (d.hello) { if (this.net.me.id < from) this._call(from); return; }
      if (d.sdp && d.sdp.type === "offer") {
        this._drop(from);
        const { pc } = this._pc(from);
        await pc.setRemoteDescription(d.sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        this.net.rtc(from, { sdp: pc.localDescription });
      } else if (d.sdp) {
        const p = this.peers.get(from); if (p) await p.pc.setRemoteDescription(d.sdp);
      } else if (d.ice) {
        const p = this.peers.get(from); if (p) await p.pc.addIceCandidate(d.ice);
      }
    } catch (e) { /* a dropped handshake just means no voice with that player */ }
  }
  _drop(id) {
    const p = this.peers.get(id); if (!p) return;
    this.peers.delete(id);
    try { p.pc.close(); } catch (e) {}
    p.audio.srcObject = null;
  }
}
