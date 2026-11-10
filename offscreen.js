// Toca o alarme sonoro (3 sequências de bipes)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen' || msg.type !== 'beep') return;
  const ctx = new AudioContext();
  const notes = [880, 1175, 1568];
  let t = ctx.currentTime + 0.05;
  for (let rep = 0; rep < 3; rep++) {
    for (const f of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.18);
      t += 0.18;
    }
    t += 0.35;
  }
  setTimeout(() => ctx.close(), (t - ctx.currentTime + 0.5) * 1000);
});
