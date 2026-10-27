// A looping tour for recordings, run inside each screen of tour.html: a mouse on the MacBook, a finger on the iPhone.
// Both have the same period, and every loop ends back on Positions.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run(name, app) {
  const $ = (selector) => document.querySelector(selector);

  // Where the pointer is: a ring the size of a fingertip.
  const finger = document.createElement("div");
  finger.className = "finger";
  document.body.append(finger);
  const show = (x, y, down) => {
    finger.style.translate = `${x - 22}px ${y - 22}px`;
    finger.toggleAttribute("data-on", true);
    finger.toggleAttribute("data-down", down);
  };
  const lift = () => finger.removeAttribute("data-on");
  const centre = (element) => {
    const box = element.getBoundingClientRect();
    return { x: box.left + Math.min(box.width / 2, 120), y: box.top + box.height / 2 };
  };
  const ease = (t) => 1 - (1 - t) ** 3;

  async function tap(element) {
    if (!element) return;
    const { x, y } = centre(element);
    show(x, y, true);
    await wait(110);
    show(x, y, false);
    element.click();
    await wait(140);
    lift();
  }
  // A finger drags the content up. A script's touch can't scroll by itself, so the scroll follows it here.
  async function glide(scroller, dy, ms = 700) {
    const target = scroller ?? document.scrollingElement;
    const box = scroller ? scroller.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const from = target.scrollTop;
    const x = box.left + box.width * 0.62;
    const y0 = box.top + box.height * 0.72;
    const steps = Math.round(ms / 16);
    for (let i = 0; i <= steps; i++) {
      const t = ease(i / steps);
      target.scrollTop = from + dy * t;
      show(x, y0 - Math.min(dy, box.height * 0.5) * t, true);
      await wait(16);
    }
    lift();
  }
  const tab = (label) => [...document.querySelectorAll(".wh-tab")].find((button) => button.textContent === label);
  const holder = (n) => document.querySelectorAll(".wh-coin-detail:not([hidden]) .wh-trader")[n];

  function reset() {
    document.querySelector('.wh-coin-head[aria-expanded="true"]')?.click();
    app.setState({ view: "positions", wallet: null, topOnly: false, sort: "traders" });
    document.scrollingElement.scrollTop = 0;
  }

  const scripts = {
    // Open the coin the most top traders hold and see who is long and who is short; open the biggest holder's
    // wallet; then the tape, narrowed to traders on the board; then the board itself.
    async desk(at) {
      await at(600);
      await tap($(".wh-coin-head"));
      await at(2000);
      await tap(holder(0));
      await at(3500);
      await glide($(".wh-wallet-body"), 300, 900);
      await at(5000);
      await tap($(".wh-close"));
      await at(5600);
      await tap(tab("Tape"));
      await at(6800);
      await tap($(".wh-switch"));
      await at(8300);
      await tap(tab("Board"));
      await at(10600);
      reset();
    },
    // On the phone: the same coin, a holder's sheet, the tape and the board.
    async phone(at) {
      await at(600);
      await tap($(".wh-coin-head"));
      await at(1700);
      await glide(null, 300, 600);
      await at(2700);
      await tap(holder(1));
      await at(4000);
      await glide($(".wh-wallet-body"), 360, 900);
      await at(5400);
      await tap($(".wh-close"));
      await at(6000);
      document.scrollingElement.scrollTop = 0;
      await tap(tab("Tape"));
      await at(7200);
      await tap($(".wh-switch"));
      await at(8600);
      await tap(tab("Board"));
      await at(10600);
      reset();
    },
  };

  const script = scripts[name];
  if (!script) return;
  const { start, period } = await new Promise((resolve) => {
    const hello = setInterval(() => parent.postMessage({ tourReady: name }, "*"), 300);
    parent.postMessage({ tourReady: name }, "*");
    addEventListener("message", (event) => {
      if (!event.data?.tourStart) return;
      clearInterval(hello);
      resolve({ start: event.data.tourStart, period: event.data.period });
    });
  });
  for (let k = 0; ; k++) {
    const t0 = start + k * period;
    await script((ms) => wait(Math.max(0, t0 + ms - Date.now())));
    await wait(Math.max(0, t0 + period - Date.now()));
  }
}
