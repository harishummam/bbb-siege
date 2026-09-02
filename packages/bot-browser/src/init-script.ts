export const PROBE_INIT_SCRIPT = `
(function () {
  window.__probe = { ice: [], pcs: [], t0: 0 };
  var orig = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (!orig) return;
  function Patched() {
    var pc = new orig(...arguments);
    if (!window.__probe.t0) window.__probe.t0 = Date.now();
    window.__probe.pcs.push(pc);
    pc.addEventListener('iceconnectionstatechange', function () {
      window.__probe.ice.push({ t: Date.now(), state: pc.iceConnectionState });
    });
    return pc;
  }
  Object.assign(Patched, orig);
  Patched.prototype = orig.prototype;
  window.RTCPeerConnection = Patched;
})();
`;
