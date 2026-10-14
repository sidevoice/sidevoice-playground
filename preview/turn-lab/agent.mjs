import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { connectorEnv } from "../runs.mjs";

const longReply = "I am walking through the result carefully. ".repeat(22) + "The final point is é🐙ab.";
export const SCRIPTS = {
  T01: { title: "Interrupt a long reply", lines: [longReply], instruction: "Speak for at least one second while the reply plays." },
  T02a: { title: "Accepted before speech, with words", lines: [longReply], instruction: "Begin speaking just as playback would start." },
  T02b: { title: "Accepted before speech, empty", lines: [longReply], instruction: "Begin speaking, then stop without words." },
  T02c: { title: "Reply during open turn, with words", lines: ["This should be refused immediately."], delay: 400, instruction: "Start speaking before you run this script; finish with words." },
  T02d: { title: "Reply during open turn, empty", lines: ["This should be refused immediately."], delay: 400, instruction: "Start a turn, run this, then cancel with no words." },
  T03: { title: "Late stale reply", lines: ["This reply belongs to the earlier turn."], delay: 3000, instruction: "Speak a new message before the delayed reply." },
  T04a: { title: "Three replies, one epoch", lines: ["Acknowledged.", "Checkpoint: I found the first fact.", "Result: all three messages should play in order."] },
  T04b: { title: "Withdraw several replies", lines: [longReply, "Second queued reply.", "Third queued reply."], instruction: "Open a new spoken turn during the first reply." },
  T05: { title: "Acknowledgement, checkpoint, result", lines: ["I understand. I will check.", longReply, "Here is the result."], instruction: "Interrupt the checkpoint." },
  T06a: { title: "Mute agents", lines: [longReply], instruction: "Mute agents during playback, then run again while muted." },
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
  T15: { title: "Working after three seconds", lines: [], instruction: "Observe Working at 2.9 and 3.0 seconds of continuous activity." },
  T16: { title: "Push and pull parity", lines: [longReply], instruction: "Repeat notice cases once per delivery mode." },
};

export function scriptedAgent({ program, profile, emit, now = Date.now, spawnProcess = spawn }) {
  let child, receiver, inputMode, conversation, context, script = null, counter = 0;
  const pending = new Map();
  const received = new Set();
  const record = (kind, data) => emit({ at: now(), kind, data });
  const decode = (value) => {
    const content = value?.result?.content?.find((part) => part.type === "text")?.text;
    try { return content ? JSON.parse(content) : value?.result ?? value?.error; } catch { return content ?? value?.result ?? value?.error; }
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++counter;
    pending.set(id, { resolve, reject });
    record("mcp-request", { id, method, params });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const tool = async (name, args) => {
    const result = decode(await send("tools/call", { name, arguments: args }));
    record("tool-result", { name, args, result });
    return result;
  };
  const say = async (text) => {
    const args = { text, utterance_id: randomUUID(), conversation };
    if (context?.session_id && context.epoch != null) Object.assign(args, context);
    return tool("voice_say", args);
  };
  const receive = (message) => {
    record("agent-input", message);
    const id = message.message_id;
    if (id && received.has(id)) return;
    if (id) received.add(id);
    if (message.session_id && message.epoch != null) context = { session_id: message.session_id, revision: message.revision, epoch: message.epoch };
    if (script?.autoReply && message.channel === "voice" && message.text) void say(script.autoReply);
  };
  return {
    get state() { return { inputMode, conversation, ready: Boolean(conversation) }; },
    async start(mode) {
      if (child) await this.stop();
      inputMode = mode;
      received.clear();
      receiver = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        try { receive(JSON.parse(Buffer.concat(chunks).toString("utf8"))); res.writeHead(200).end("ok"); }
        catch { res.writeHead(400).end("invalid input"); }
      });
      await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
      const address = receiver.address();
      child = spawnProcess(program, ["mcp"], { env: { ...connectorEnv(profile), SIDEVOICE_THREAD: `turn-lab-${randomUUID()}`, SIDEVOICE_DELIVERY_URL: `http://127.0.0.1:${address.port}/`, SIDEVOICE_HARNESS: "http" }, stdio: ["pipe", "pipe", "pipe"] });
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
      child.on("exit", (code) => { record("connector-exit", { code }); for (const item of pending.values()) item.reject(new Error(`MCP exited ${code}`)); pending.clear(); });
      await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "turn-lab", version: "1.0.0" } });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      const joined = await tool("voice_connect", { title: "Turn Lab", input_mode: mode });
      conversation = joined.conversation;
      context = joined.initial_reply_context;
      record("agent-connected", joined);
      if (!conversation) throw new Error(`voice_connect did not join: ${JSON.stringify(joined)}`);
      if (mode === "pull") {
        const pull = async () => {
          if (!child || inputMode !== "pull") return;
          try {
            const answer = await tool("get_messages", { conversation });
            for (const message of answer.messages ?? answer.items ?? []) receive(message);
            const ids = (answer.messages ?? answer.items ?? []).map((message) => message.message_id).filter(Boolean);
            if (ids.length) await tool("get_messages", { conversation, ack_ids: ids, operation: "check" });
          } catch (error) { record("pull-error", String(error)); }
          setTimeout(pull, 850);
        };
        void pull();
      }
      return joined;
    },
    async choose(id) {
      script = SCRIPTS[id];
      if (!script) throw new Error(`Unknown script ${id}`);
      record("script-start", { id, ...script });
      if (script.delay) await new Promise((resolve) => setTimeout(resolve, script.delay));
      const results = [];
      for (const text of script.lines) results.push(await say(text));
      return { script: id, results };
    },
    async stop() {
      const old = child; child = null; conversation = null; context = null;
      old?.kill("SIGTERM");
      if (receiver) await new Promise((resolve) => receiver.close(resolve));
      receiver = null;
    },
  };
}
