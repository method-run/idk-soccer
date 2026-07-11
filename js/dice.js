// Seedable RNG + dice helpers. Everything random in the game flows through a
// Dice instance so tests can stub it and matches can be replayed.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeDice(seed = Math.floor(Math.random() * 2 ** 31)) {
  const rng = mulberry32(seed);
  return {
    seed,
    d6() {
      return 1 + Math.floor(rng() * 6);
    },
    // Core resolution roll: 2d6 + modifier vs target number.
    roll2d6(mod = 0) {
      const a = this.d6();
      const b = this.d6();
      return {
        a,
        b,
        mod,
        total: a + b + mod,
        doubles: a === b,
      };
    },
    check(mod, tn) {
      const r = this.roll2d6(mod);
      return { ...r, tn, success: r.total >= tn, margin: r.total - tn };
    },
    pick(arr) {
      return arr[Math.floor(rng() * arr.length)];
    },
    random() {
      return rng();
    },
  };
}
