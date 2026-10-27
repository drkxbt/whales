// Starts both tours together once each has loaded, and tells a recorder the loop's timing.
const PERIOD = 11000;
const frames = [...document.querySelectorAll("iframe")];
const ready = new Set();

addEventListener("message", (event) => {
  if (!event.data?.tourReady) return;
  if (window.tour) return;
  ready.add(event.data.tourReady);
  if (ready.size < frames.length) return;
  const start = Date.now() + 800;
  for (const frame of frames) frame.contentWindow.postMessage({ tourStart: start, period: PERIOD }, "*");
  // For a recorder: the loop's period and its first frame in wall-clock milliseconds, to cut exactly one loop.
  window.tour = { period: PERIOD, start };
});
