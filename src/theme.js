/* ================= PALETTE / DESIGN TOKENS ================= */
export const C = {
  sand: "#F6F1E8",        // page background
  cream: "#FFFDF8",       // cards
  line: "#E9DECB",        // borders
  beige: "#EFE6D6",       // muted fills
  mokka: "#7A5C43",       // primary
  mokkaDeep: "#5E4632",
  espresso: "#2E2519",    // text
  muted: "#85755E",       // secondary text (4.5:1 on cream)
  olive: "#6F8052",       // positive
  clay: "#B4694E",        // negative (sparingt)
  gold: "#B08D57",
  // Padel accents: the faded petrol of a court surface and the ball's
  // optic yellow. Used sparingly, as highlights against the warm base.
  court: "#3F7C85",
  courtDeep: "#2C5961",
  courtSoft: "#DCE9E8",
  ball: "#D8E36B",
  ballDeep: "#AEBB3F",
};
export const shadow = "0 1px 2px rgba(46,37,25,.05), 0 10px 30px rgba(46,37,25,.07)";
export const softShadow = "0 1px 2px rgba(46,37,25,.04), 0 4px 14px rgba(46,37,25,.05)";
export const liftShadow = "0 2px 4px rgba(46,37,25,.06), 0 18px 40px rgba(46,37,25,.14)";
export const serif = "'Fraunces', Georgia, serif";
export const sans = "'Outfit', ui-sans-serif, system-ui, sans-serif";

/* Faded gradients ("fades"). One place, so every surface agrees. */
export const G = {
  // Ambient page wash: a hint of court petrol top right, warm gold top left.
  page: `radial-gradient(900px 460px at 100% -120px, rgba(63,124,133,.13), transparent 70%),
         radial-gradient(760px 420px at -10% -60px, rgba(176,141,87,.18), transparent 70%),
         ${C.sand}`,
  // Hero cards: espresso-mokka fading into court petrol.
  hero: `radial-gradient(130% 150% at 100% 0%, rgba(63,124,133,.85), rgba(63,124,133,0) 58%),
         radial-gradient(90% 120% at 0% 100%, rgba(176,141,87,.35), rgba(176,141,87,0) 60%),
         linear-gradient(140deg, #6B4F39, #33271B)`,
  primary: `linear-gradient(135deg, #8A6A4E, ${C.mokkaDeep})`,
  court: `linear-gradient(160deg, #4E8C94, ${C.courtDeep})`,
  ball: `radial-gradient(circle at 35% 30%, #EEF5A0, ${C.ball} 55%, ${C.ballDeep})`,
  warm: `linear-gradient(160deg, ${C.cream}, #F6ECDB)`,
  cool: `linear-gradient(160deg, ${C.cream}, #E9F0EC)`,
  bar: `linear-gradient(90deg, ${C.gold}, ${C.court})`,
};

/* Soft avatar tints so a list of players reads as people, not a column of
   identical beige dots. Picked per name, so a player keeps their colour. */
const AVATAR_TINTS = [
  ["#F1E8D8", "#E2D3B9", "#5E4632"], // sand
  ["#E5ECDC", "#CBD9BC", "#4D5C38"], // sage
  ["#DDEAEA", "#BDD6D8", "#2C5961"], // court
  ["#F4E1D7", "#E6C6B6", "#8A4A33"], // clay
  ["#F4EAD0", "#E4D2A4", "#735A2B"], // gold
  ["#E9E3EC", "#D3C8DA", "#5A4A66"], // dusk
];
export const avatarTint = (name = "") => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
};

/* Global CSS shared by the app shell and the auth screens: fonts, press
   feedback, and the handful of animations. All motion is switched off for
   people who ask their device for less of it. */
export const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Outfit:wght@300;400;500;600;700&display=swap');
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html { background: ${C.sand}; }
  body { margin: 0; overscroll-behavior-y: none; }
  button, a, input, label { touch-action: manipulation; }
  ::-webkit-scrollbar { width: 6px; height: 6px; } ::-webkit-scrollbar-thumb { background: ${C.line}; border-radius: 99px; }
  button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible, [role="button"]:focus-visible { outline: 2px solid ${C.court}; outline-offset: 2px; }
  ::selection { background: ${C.ball}; color: ${C.espresso}; }

  .lp-btn { transition: transform .14s cubic-bezier(.3,.7,.4,1), box-shadow .2s ease, filter .2s ease, background-color .2s ease; }
  .lp-btn:not(:disabled):hover { filter: brightness(1.04); }
  .lp-btn:not(:disabled):active { transform: scale(.965); }
  .lp-press { transition: transform .16s cubic-bezier(.3,.7,.4,1), box-shadow .25s ease, border-color .25s ease; }
  .lp-press:hover { box-shadow: ${liftShadow}; }
  .lp-press:active { transform: scale(.985); }

  @keyframes lp-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  @keyframes lp-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes lp-pop { 0% { opacity: 0; transform: scale(.6); } 60% { opacity: 1; transform: scale(1.08); } 100% { transform: scale(1); } }
  @keyframes lp-toast { from { opacity: 0; transform: translate(-50%, -14px) scale(.96); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
  @keyframes lp-bounce { 0%, 100% { transform: translateY(0) scaleY(.92); animation-timing-function: cubic-bezier(.3,.6,.6,1); } 50% { transform: translateY(-14px) scaleY(1); animation-timing-function: cubic-bezier(.4,0,.8,.5); } }
  @keyframes lp-shadow { 0%, 100% { transform: scaleX(1); opacity: .28; } 50% { transform: scaleX(.6); opacity: .12; } }
  @keyframes lp-pulse { 0% { box-shadow: 0 0 0 0 rgba(216,227,107,.75); } 70%, 100% { box-shadow: 0 0 0 9px rgba(216,227,107,0); } }
  @keyframes lp-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes lp-growy { from { transform: scaleY(0); } to { transform: scaleY(1); } }
  @keyframes lp-drift { 0% { transform: translate(0,0); } 50% { transform: translate(-14px, 10px); } 100% { transform: translate(0,0); } }
  @keyframes lp-burst { 0% { opacity: 0; transform: translate(0,0) scale(.4); } 20% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1); } }
  @keyframes lp-rally { 0% { transform: translate(0, 0); } 50% { transform: translate(var(--rx), var(--ry)); } 100% { transform: translate(0, 0); } }

  .view { animation: lp-rise .38s cubic-bezier(.2,.7,.3,1) both; }
  .lp-stagger > * { animation: lp-rise .42s cubic-bezier(.2,.7,.3,1) both; }
  .lp-stagger > *:nth-child(1) { animation-delay: .02s; } .lp-stagger > *:nth-child(2) { animation-delay: .05s; }
  .lp-stagger > *:nth-child(3) { animation-delay: .08s; } .lp-stagger > *:nth-child(4) { animation-delay: .11s; }
  .lp-stagger > *:nth-child(5) { animation-delay: .14s; } .lp-stagger > *:nth-child(6) { animation-delay: .17s; }
  .lp-stagger > *:nth-child(7) { animation-delay: .20s; } .lp-stagger > *:nth-child(8) { animation-delay: .23s; }
  .lp-stagger > *:nth-child(n+9) { animation-delay: .26s; }
  .lp-pop { animation: lp-pop .5s cubic-bezier(.2,.8,.3,1.2) both; }
  .lp-fade { animation: lp-fade .4s ease both; }
  .lp-grow { transform-origin: left center; animation: lp-grow .9s cubic-bezier(.2,.7,.2,1) both; }
  .lp-growy { transform-origin: center bottom; animation: lp-growy .7s cubic-bezier(.2,.7,.2,1) both; }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .001ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
  }
`;
