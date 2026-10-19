// The desktops the card floats over: Windows 11, macOS and GNOME, each with Sidevoice minimised (its taskbar button,
// its dock icon) and the person's other windows open. Drawn in HTML and CSS (callcard.css), nothing of any OS's own
// artwork: shapes and colours that read as each one. `inset` is the work area the card keeps to (clear of the bars).

/** The Sidevoice app icon: the brand mark's five bars, the fourth (the agent's voice) in mustard, on lila. */
export const SIDEVOICE_ICON = `<svg class="sv-app-icon" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="11" fill="#4a2f6b"/>
<g fill="#c9b6ec"><rect x="7.5" y="20" width="4" height="8" rx="2"/><rect x="14.5" y="15" width="4" height="18" rx="2"/><rect x="21.5" y="9" width="4" height="30" rx="2"/>
<rect x="28.5" y="15" width="4" height="18" rx="2" fill="#e0a82e"/><rect x="35.5" y="20" width="4" height="8" rx="2"/></g></svg>`;

/** The tray's glyphs: wireless, sound, battery, power; plain strokes. */
const TRAY = {
  wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  battery: '<rect x="2.5" y="7" width="17" height="10" rx="2.5"/><rect x="5" y="9.5" width="10" height="5" rx="1" fill="currentColor"/><path d="M21.5 10.5v3"/>',
  power: '<path d="M12 3v8M6.5 6.5a8 8 0 1 0 11 0"/>',
};
const tray = (...names) => names.map((name) => `<span class="tray-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${TRAY[name]}</svg></span>`).join("");

const icon = (cls, label) => `<span class="app-icon ${cls}" title="${label}" aria-label="${label}"></span>`;

/** A terminal with a coding agent at work: the window the person is in while the call goes on. */
const TERMINAL = `<div class="term">
<p><b class="t-dim">~/sidevoice/relay</b> <b class="t-ok">❯</b> agent</p>
<p class="t-dim">● Reading src/relay/session.rs</p>
<p class="t-dim">● Editing src/relay/session.rs <span class="t-ok">+42</span> <span class="t-bad">-17</span></p>
<p>  The reconnect path now keeps the room's epoch, so a dropped</p>
<p>  socket resumes where it was instead of starting over.</p>
<p class="t-dim">● Running cargo test -p relay</p>
<p>  <span class="t-ok">test result: ok.</span> 128 passed; 0 failed</p>
<p class="t-dim">● Running cargo clippy</p>
<p><span class="t-warn">warning:</span> unused import: <span class="t-str">\`std::sync::Arc\`</span></p>
<p>   <span class="t-dim">--&gt;</span> src/relay/session.rs:4:5</p>
<p class="t-cursor">▍</p></div>`;

/** An editor with the file the agent is changing. */
const EDITOR = `<div class="editor"><div class="ed-tabs"><span class="on">session.rs</span><span>room.rs</span><span>lib.rs</span></div><div class="ed-body">
${["<k>use</k> std::sync::Arc;", "<k>use</k> crate::room::{Epoch, Room};", "", "<c>/// A relay session: one socket, one room.</c>", "<k>pub struct</k> <t>Session</t> {",
  "    room: <t>Room</t>,", "    epoch: <t>Epoch</t>,", "    retries: <t>u32</t>,", "}", "", "<k>impl</k> <t>Session</t> {",
  "    <k>pub fn</k> <f>resume</f>(&<k>mut</k> self) -&gt; <t>Result</t>&lt;()&gt; {", "        <k>let</k> epoch = self.epoch;",
  "        self.room.<f>rejoin</f>(epoch)?;", "        self.retries = <n>0</n>;", "        <t>Ok</t>(())", "    }", "}"]
  .map((line, i) => `<p><i>${i + 1}</i>${line}</p>`).join("")}</div></div>`;

const clock = { time: "09:41", date: "19/10/2026" };

export const DESKTOPS = {
  windows: {
    label: "Windows 11",
    theme: "dark",
    corner: "br",
    inset: { top: 0, right: 0, bottom: 48, left: 0 },
    html: `<div class="wallpaper"></div>
<section class="window w-win" style="left:6%;top:7%;width:56%;height:68%"><header><span class="w-ico term-ico"></span><span class="w-title">Windows Terminal</span><span class="w-btns"><i>—</i><i>☐</i><i class="x">✕</i></span></header>${TERMINAL}</section>
<section class="window w-win" style="left:34%;top:20%;width:52%;height:62%"><header><span class="w-ico code-ico"></span><span class="w-title">session.rs · relay · Code</span><span class="w-btns"><i>—</i><i>☐</i><i class="x">✕</i></span></header>${EDITOR}</section>
<footer class="taskbar">
  <div class="tb-apps">${icon("win-start", "Start")}<span class="tb-search">Search</span>${icon("explorer", "File Explorer")}${icon("browser", "Browser")}
    <span class="tb-app running">${icon("terminal", "Terminal")}</span><span class="tb-app running active">${icon("code", "Code")}</span>
    <span class="tb-app running sidevoice" title="Sidevoice (minimised)">${SIDEVOICE_ICON}</span></div>
  <div class="tb-tray"><span>ESP</span>${tray("wifi", "sound", "battery")}<span class="tb-clock"><b>${clock.time}</b><b>${clock.date}</b></span></div>
</footer>`,
  },
  macos: {
    label: "macOS",
    theme: "light",
    corner: "tr",
    inset: { top: 24, right: 0, bottom: 84, left: 0 },
    html: `<div class="wallpaper"></div>
<header class="menubar"><span class="mb-logo"></span><b>Terminal</b><span>Shell</span><span>Edit</span><span>View</span><span>Window</span><span>Help</span>
  <span class="mb-right">${tray("battery", "wifi")}<span>Sun 19 Oct ${clock.time}</span></span></header>
<section class="window w-mac" style="left:5%;top:9%;width:55%;height:66%"><header><span class="lights"><i></i><i></i><i></i></span><span class="w-title">relay — agent — 120×36</span></header>${TERMINAL}</section>
<section class="window w-mac" style="left:33%;top:21%;width:52%;height:60%"><header><span class="lights"><i></i><i></i><i></i></span><span class="w-title">session.rs — relay</span></header>${EDITOR}</section>
<footer class="dock"><div class="dock-shelf">${icon("finder", "Finder")}${icon("browser", "Browser")}
  <span class="dock-app running">${icon("terminal", "Terminal")}</span><span class="dock-app running">${icon("code", "Code")}</span>
  <span class="dock-app running sidevoice" title="Sidevoice">${SIDEVOICE_ICON}</span>
  <span class="dock-sep"></span><span class="dock-mini" title="Sidevoice (minimised)"><span class="mini-win"><i></i><b></b></span>${SIDEVOICE_ICON}</span>${icon("trash", "Bin")}</div></footer>`,
  },
  gnome: {
    label: "GNOME (Ubuntu)",
    theme: "dark",
    corner: "br",
    inset: { top: 32, right: 0, bottom: 0, left: 64 },
    html: `<div class="wallpaper"></div>
<header class="topbar-gnome"><span class="activities"><i class="on"></i><i></i><i></i></span><b class="gn-clock">19 Oct ${clock.time}</b>
  <span class="gn-right">${tray("wifi", "sound", "battery", "power")}</span></header>
<nav class="ubuntu-dock">${icon("files", "Files")}${icon("browser", "Browser")}<span class="dk-app running">${icon("terminal", "Terminal")}</span>
  <span class="dk-app running">${icon("code", "Code")}</span><span class="dk-app running sidevoice" title="Sidevoice (minimised)">${SIDEVOICE_ICON}</span>
  <span class="dk-grid">${"<i></i>".repeat(9)}</span></nav>
<section class="window w-gnome" style="left:10%;top:9%;width:52%;height:66%"><header><span class="w-title">agent — ~/sidevoice/relay</span><span class="w-btns"><i>–</i><i>□</i><i class="x">✕</i></span></header>${TERMINAL}</section>
<section class="window w-gnome" style="left:36%;top:21%;width:50%;height:60%"><header><span class="w-title">session.rs — Code</span><span class="w-btns"><i>–</i><i>□</i><i class="x">✕</i></span></header>${EDITOR}</section>`,
  },
};
