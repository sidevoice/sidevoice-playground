// The Connector section: whether the connector's test bench answers at connector/ (server.mjs reaches it through
// bench.mjs), and the way to it. The bench's page is the connector's own; this one only links to it. In the macOS app
// there is no server in between: the bench is on this Mac, at its own address.

const $ = (selector) => document.querySelector(selector);

/** The bench's own address, where `cargo xtask bench` listens. */
export const BENCH_URL = "http://127.0.0.1:4477/";

/** @returns {{ show: () => void }} what the page calls each time the section is shown */
export function connectorSection({ inApp }) {
  const line = $("#connector-status");
  const link = $("#connector-open");
  const say = (text, error = false) => {
    line.textContent = text;
    line.classList.toggle("error", error);
  };

  async function probe() {
    say("Asking the bench…");
    try {
      const res = await fetch("connector/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
      await res.json();
      say("The bench answers: open it for its page.");
      link.hidden = false;
    } catch (error) {
      say(error.message, true);
      link.hidden = true;
    }
  }

  return {
    show() {
      if (inApp) {
        link.href = BENCH_URL;
        say(`Run \`cargo xtask bench\` in a sidevoice-connector checkout, then open ${BENCH_URL}`);
        return;
      }
      probe();
    },
  };
}
