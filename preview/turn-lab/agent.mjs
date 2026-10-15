import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { connectorEnv } from "../runs.mjs";

const longReply = "I am walking through the result carefully. ".repeat(22) + "The final point is é🐙ab.";
export const SCRIPTS = {
  T01: { title: "Interrupt a long reply", lines: [], autoReply: longReply, instruction: "Select this script, then speak. The agent answers with a long reply; speak again for at least one second while it plays." },
  T02a: { title: "Accepted before speech, with words", lines: [longReply], instruction: "Begin speaking just as playback would start." },
  T02b: { title: "Accepted before speech, empty", lines: [longReply], instruction: "Begin speaking, then stop without words." },
  T02c: { title: "Reply during open turn, with words", lines: ["This should be refused immediately."], delay: 400, instruction: "Start speaking before you run this script; finish with words." },
  T02d: { title: "Reply during open turn, empty", lines: ["This should be refused immediately."], delay: 400, instruction: "Start a turn, run this, then cancel with no words." },
  T03: { title: "Late stale reply", lines: ["This reply belongs to the earlier turn."], delay: 3000, pullDelayMs: 3500, instruction: "Speak a new message before the delayed reply." },
  T04a: { title: "Three replies, one epoch", lines: ["Acknowledged.", "Checkpoint: I found the first fact.", "Result: all three messages should play in order."] },
  T04b: { title: "Withdraw several replies", lines: [longReply, "Second queued reply.", "Third queued reply."], instruction: "Open a new spoken turn during the first reply." },
  T05: { title: "Acknowledgement, checkpoint, result", lines: ["I understand. I will check.", longReply, "Here is the result."], instruction: "Interrupt the checkpoint." },
  T06a: { title: "Mute agents", lines: [longReply], afterMute: "This second reply should be saved while agents are muted.", instruction: "Run once and wait for playback. Mute agents while it plays, then click Run script again while muted; the second click continues this same case." },
  T06b: { title: "Turn voice off", lines: [longReply], instruction: "Turn voice off, then run the script." },
  T06c: { title: "Switch conversation", lines: [longReply], instruction: "Switch conversation while this plays." },
  T06d: { title: "Return with misses", lines: [longReply], instruction: "Mute agents, run, unmute, and wait five seconds." },
  T06e: { title: "Return without misses", lines: ["This should play fully."], instruction: "Return to this conversation after hearing the reply." },
  T07: { title: "Disconnect and reconnect", lines: [longReply], instruction: "Disconnect the browser during playback, then reconnect." },
  T08: { title: "Type during playback", lines: [longReply, "This second reply should also play."], instruction: "Type a message during the first reply." },
  T09a: { title: "Short overlap", lines: [longReply], instruction: "Say a short ajá over the reply, under one second." },
  T09b: { title: "Short word in silence", lines: [], instruction: "Say vale while the agent is silent." },
  T10: { title: "Speaker echo", lines: [longReply], instruction: "Let speakers play without speaking. Check with the physical microphone." },
  T11: { title: "Two conversations and duplicates", lines: [longReply], instruction: "Switch between two conversations and speak in each." },
  T12: { title: "Skip first reply", lines: [longReply, "This next reply must still play."], instruction: "Press Skip during the first reply." },
  T13: { title: "Mute microphone mid-turn", lines: [], instruction: "Speak, then mute the microphone before the turn ends." },
  T14: { title: "Two device hearing", lines: [longReply], instruction: "Hear this on another device, then switch to this one." },
  T15: { title: "Working after three seconds", lines: [], autoReply: "I finished checking.", autoReplyDelayMs: 4500, instruction: "Select this script, then speak. The agent stays active for 4.5 seconds; watch Working appear after three seconds and clear when the reply arrives." },
  T16: { title: "Push and pull parity", lines: [longReply], pullDelayMs: 5000, instruction: "Repeat notice cases once per delivery mode. In Get messages mode, this script delays the next pull by five seconds." },
};

export function scriptedAgent({ program, profile, emit, now = Date.now, spawnProcess = spawn, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let child, receiver, inputMode, conversation, context, script = null, nextPullAt = 0, counter = 0, generation = 0, rolloutFile = null;
  let mutePhase = 0, muteRunId = null;
  const pending = new Map();
  const received = new Set();
  const record = (kind, data) => emit({ at: now(), kind, data });
  const decode = (value) => {
    const content = value?.result?.content?.find((part) => part.type === "text")?.text;
    try { return content ? JSON.parse(content) : value?.result ?? value?.error; } catch { return content ?? value?.result ?? value?.error; }
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP ${method} timed out`)); }, 15_000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    record("mcp-request", { id, method, params });
    try { if (!child) throw new Error("MCP is disconnected"); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); }
    catch (error) { pending.get(id).reject(error); pending.delete(id); }
  });
  const tool = async (name, args) => {
    const packet = await send("tools/call", { name, arguments: args });
    const decoded = decode(packet);
    const result = packet?.result?.isError ? { status: "error", message: String(decoded) } : decoded;
    record("tool-result", { name, args, result });
    if (packet?.result?.isError) throw new Error(`MCP ${name}: ${result.message}`);
    return result;
  };
  const say = async (text, replyContext = context) => {
    const id = randomUUID();
    // The HTTP harness is not an editor chat. Connector routes this single joined
    // conversation by the explicit core-issued session/revision/epoch below.
    const args = { text, event_id: id, utterance_id: id };
    if (replyContext?.session_id && replyContext.epoch != null) Object.assign(args, replyContext);
    return tool("voice_say", args);
  };
  const activity = async (phase, turnId) => {
    if (!rolloutFile) return;
    await appendFile(rolloutFile, JSON.stringify({ type: "event_msg", payload: { type: phase, turn_id: turnId } }) + "\n");
    record("script-activity", { phase, turn_id: turnId, conversation });
  };
  const receive = (message) => {
    record("agent-input", { ...message, conversation });
    const id = message.message_id;
    if (id && received.has(id)) return;
    if (id) received.add(id);
    if (message.session_id && message.epoch != null) context = { session_id: message.session_id, revision: message.revision, epoch: message.epoch };
    if (script?.autoReply && message.channel === "voice" && message.text) {
      const selected = script;
      const replyContext = { session_id: message.session_id, revision: message.revision, epoch: message.epoch };
      const reply = async () => {
        const turnId = selected === SCRIPTS.T15 ? randomUUID() : null;
        if (turnId) await activity("task_started", turnId);
        try {
          if (selected.autoReplyDelayMs) await wait(selected.autoReplyDelayMs);
          if (child) await say(selected.autoReply, replyContext);
        } finally { if (turnId) await activity("task_complete", turnId); }
      };
      void reply().catch((error) => record("auto-reply-error", { message: String(error?.message ?? error) }));
    }
  };
  return {
    get state() { return { inputMode, conversation, ready: Boolean(conversation) }; },
    async start(mode) {
      if (child) await this.stop();
      inputMode = mode;
      script = null; mutePhase = 0; muteRunId = null;
      received.clear();
      receiver = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        try { receive(JSON.parse(Buffer.concat(chunks).toString("utf8"))); res.writeHead(200).end("ok"); }
        catch { res.writeHead(400).end("invalid input"); }
      });
      await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
      const address = receiver.address();
      const thread = `turn-lab-${randomUUID()}`;
      const codexHome = profile.home && join(profile.home, ".codex");
      if (codexHome) {
        const date = new Date(now()).toISOString().slice(0, 10).split("-");
        const directory = join(codexHome, "sessions", ...date);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        rolloutFile = join(directory, `rollout-${thread}.jsonl`);
        await appendFile(rolloutFile, "");
      }
      child = spawnProcess(program, ["mcp"], { env: { ...connectorEnv(profile), SIDEVOICE_THREAD: thread,
        SIDEVOICE_DELIVERY_URL: `http://127.0.0.1:${address.port}/`, SIDEVOICE_HARNESS: codexHome ? "codex" : "http",
        ...(codexHome ? { CODEX_HOME: codexHome, CODEX_THREAD_ID: thread } : {}) }, stdio: ["pipe", "pipe", "pipe"] });
      const running = child, runGeneration = ++generation;
      const lost = (reason) => {
        if (child !== running) return;
        record("connector-exit", { reason });
        child = null; conversation = null; context = null;
        for (const item of pending.values()) item.reject(new Error(`MCP ${reason}`));
        pending.clear();
      };
      let line = "";
      child.stdout.on("data", (chunk) => {
        line += chunk;
        for (;;) {
          const end = line.indexOf("\n");
          if (end < 0) break;
          const raw = line.slice(0, end); line = line.slice(end + 1);
          try {
            const message = JSON.parse(raw);
            record("mcp-response", message);
            if (message.id != null && pending.has(message.id)) { pending.get(message.id).resolve(message); pending.delete(message.id); }
          } catch (error) { record("mcp-parse-error", String(error)); }
        }
      });
      child.stderr.on("data", (chunk) => record("connector-stderr", String(chunk).slice(0, 1000)));
      child.on("exit", (code) => lost(`exited ${code}`));
      child.on("error", (error) => lost(`failed: ${error.message}`));
      await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "turn-lab", version: "1.0.0" } });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      const joined = await tool("voice_connect", { title: "Turn Lab", input_mode: mode });
      conversation = joined.conversation;
      context = joined.initial_reply_context;
      record("agent-connected", joined);
      if (!conversation) throw new Error(`voice_connect did not join: ${JSON.stringify(joined)}`);
      if (mode === "pull") {
        const pull = async () => {
          if (!child || inputMode !== "pull" || generation !== runGeneration) return;
          try {
            if (now() >= nextPullAt) {
              const answer = await tool("get_messages", { conversation });
              for (const message of answer.messages ?? answer.items ?? []) receive(message);
              const ids = (answer.messages ?? answer.items ?? []).map((message) => message.message_id).filter(Boolean);
              if (ids.length) await tool("get_messages", { conversation, ack_ids: ids, after: answer.cursor });
            }
          } catch (error) { record("pull-error", String(error)); }
          if (child && generation === runGeneration) setTimeout(pull, 850);
        };
        void pull();
      }
      return joined;
    },
    async choose(id) {
      const nextScript = SCRIPTS[id];
      if (!nextScript) throw new Error(`Unknown script ${id}`);
      const continuingMute = id === "T06a" && script === nextScript && mutePhase === 1;
      script = nextScript;
      if (!continuingMute) { mutePhase = 0; muteRunId = id === "T06a" ? randomUUID() : null; }
      // Keep the selected reply in the epoch it answered, even if a later spoken input
      // arrives while a delayed script is waiting. T03 depends on that real race.
      const replyContext = context && { ...context };
      if (inputMode === "pull" && nextScript.pullDelayMs) {
        nextPullAt = now() + nextScript.pullDelayMs;
        record("pull-delayed", { until: nextPullAt });
      }
      if (continuingMute) record("script-phase", { id, phase: 2, run_id: muteRunId, conversation });
      else record("script-start", { id, phase: 1, run_id: muteRunId, conversation, inputMode, session_id: replyContext?.session_id, revision: replyContext?.revision, epoch: replyContext?.epoch, ...nextScript });
      if (nextScript.delay) await wait(nextScript.delay);
      const results = [];
      for (const text of continuingMute ? [nextScript.afterMute] : nextScript.lines) results.push(await say(text, replyContext));
      if (id === "T06a") mutePhase = continuingMute ? 2 : 1;
      return { script: id, phase: continuingMute ? 2 : 1, results };
    },
    async stop() {
      generation++;
      if (child && conversation) await tool("voice_disconnect", { conversation }).catch((error) => record("disconnect-error", String(error)));
      const old = child; child = null; conversation = null; context = null;
      for (const item of pending.values()) item.reject(new Error("MCP stopped"));
      pending.clear();
      old?.kill("SIGTERM");
      if (receiver) await new Promise((resolve) => receiver.close(resolve));
      receiver = null;
      rolloutFile = null;
      script = null; mutePhase = 0; muteRunId = null;
    },
  };
}
