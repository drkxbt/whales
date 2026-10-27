// Plays back a recording of Hyperliquid (demo/sample) for the tour: the info reads answer from it, and a stand-in
// websocket hands out all the recorded trades at once when it opens, stamped as just made, so every loop of the tour
// shows the same tape.

export function replay(recorded) {
  const fetch = async (url, init = {}) => {
    if (String(url).endsWith("/board.json")) return Response.json(recorded.board);
    const answer = recorded.info[init.body ?? ""];
    return answer === undefined ? Response.json({ error: "not in the recording" }, { status: 404 }) : Response.json(answer);
  };

  class ReplaySocket extends EventTarget {
    static OPEN = 1;
    readyState = 0;

    constructor() {
      super();
      setTimeout(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
        this.#play();
      }, 50);
    }

    // The recorded order is kept: the latest recorded trade is the newest on the tape.
    #play() {
      const now = Date.now();
      const last = Math.max(...recorded.trades.map((burst) => burst.at), 0);
      const data = recorded.trades.flatMap((burst) => burst.data.map((trade) => ({ ...trade, time: now - Math.round((last - burst.at) / 40) })));
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ channel: "trades", data }) }));
    }

    send() {}

    close() {
      this.readyState = 3;
    }
  }

  return { fetch, WebSocket: ReplaySocket };
}
