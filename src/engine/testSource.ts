// `?source=test`: a fake camera for trying the site without a webcam.
// Paints a textured "room" that sits still for 3 s, then pans sideways for 3 s
// (like spinning in a chair), on repeat. On the cat cam that flips to spin cat.
export function startTestSource(): MediaStream {
  const W = 640;
  const H = 480;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const room = document.createElement("canvas");
  room.width = W * 3;
  room.height = H;
  const r = room.getContext("2d")!;
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  r.fillStyle = "#cfc6b4";
  r.fillRect(0, 0, room.width, H);
  for (let i = 0; i < 900; i++) {
    const g = Math.floor(rand() * 200 + 30);
    r.fillStyle = `rgb(${g},${Math.floor(g * (0.8 + rand() * 0.3))},${Math.floor(g * (0.7 + rand() * 0.4))})`;
    r.fillRect(rand() * room.width, rand() * H, 8 + rand() * 60, 8 + rand() * 60);
  }

  const t0 = performance.now();
  let x = 0;
  let last = t0;
  const draw = (now: number) => {
    const phase = ((now - t0) / 1000) % 6;
    const dt = Math.min(50, now - last);
    last = now;
    if (phase >= 3) x = (x + dt * 0.45) % (room.width - W); // ~15 px per frame at 30 fps
    ctx.drawImage(room, x, 0, W, H, 0, 0, W, H);
    ctx.fillStyle = "rgba(20,20,19,0.75)";
    ctx.fillRect(10, 10, 210, 26);
    ctx.fillStyle = "#fff";
    ctx.font = "13px ui-monospace, Menlo, monospace";
    ctx.fillText(phase >= 3 ? "TEST SOURCE: panning" : "TEST SOURCE: still", 18, 28);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return canvas.captureStream(30);
}
