// Neon Vice — shops: the catalogue, the money check and the effect.
//
// Gun shop (the SMG + ammo) and clothing shop (recolour Vera's jacket).
// Open with E near a shop marker; the DOM panel itself is owned by ui.js,
// this module owns what is sold, what it costs and what buying does.

import { CONFIG } from "./config.js";

const { pistol, smg } = CONFIG.weapons;

function catalogue(rows) {
  return rows.map(([id, name, price, desc, color]) => {
    const item = { id, name, price, desc };
    if (color !== undefined) item.color = color;
    return item;
  });
}

const SHOPS = [
  {
    id: "gun",
    name: "Ammo-Nation",
    x: CONFIG.places.gunShop.x,
    z: CONFIG.places.gunShop.z,
    items: catalogue([
      ["smg", "SMG", smg.price, "Rapid fire, 30-round mag"],
      ["pistolAmmo", "Pistol ammo ×24", pistol.ammoPrice, "+24 pistol rounds"],
      ["smgAmmo", "SMG ammo ×60", smg.ammoPrice, "+60 SMG rounds"],
    ]),
  },
  {
    id: "cloth",
    name: "Vice Threads",
    x: CONFIG.places.clothShop.x,
    z: CONFIG.places.clothShop.z,
    items: catalogue([
      ["jacketTeal", "Teal jacket", 0, "Vera's classic teal", 0x14B8A6],
      ["jacketPink", "Pink jacket", 200, "Neon pink", 0xEC4899],
      ["jacketGold", "Gold jacket", 200, "Vice gold", 0xF59E0B],
      ["jacketPurple", "Purple jacket", 200, "Night purple", 0x8B5CF6],
    ]),
  },
];

const SIGN_COLORS = { gun: 0xEF4444, cloth: 0xEC4899 };
const AMMO_PACKS = { pistolAmmo: ["pistol", 24], smgAmmo: ["smg", 60] };

function fail(message) {
  return { ok: false, message };
}

function snapSpot(ctx, x, z) {
  const world = ctx.world;
  let ground = { x, z };
  if (world && typeof world.findOpenGround === "function") {
    try {
      const found = world.findOpenGround(x, z, 40);
      if (found) ground = { x: found.x, z: found.z };
    } catch (ignored) { /* keep the raw spot */ }
  }
  return ground;
}

function boxMesh(w, h, d, material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
}

function buildMarker(scene, ctx, shop) {
  const spot = snapSpot(ctx, shop.x, shop.z);
  shop.x = spot.x;
  shop.z = spot.z;
  const tint = SIGN_COLORS[shop.id];
  const kiosk = boxMesh(
    6, 4, 5,
    new THREE.MeshStandardMaterial({ color: 0x1F2937, roughness: 0.6 }),
  );
  kiosk.position.set(spot.x, 2, spot.z);
  const sign = boxMesh(
    6.4, 1, 0.4,
    new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.9 }),
  );
  sign.position.set(spot.x, 4.6, spot.z);
  scene.add(kiosk, sign);
  return { shop, kiosk, sign };
}

function nearestShop(x, z, maxDist = 12) {
  const closest = SHOPS.reduce(
    (best, shop) => {
      const d = Math.hypot(x - shop.x, z - shop.z);
      return d < best.d ? { shop, d } : best;
    },
    { shop: null, d: maxDist },
  );
  return closest.shop;
}

function createShops(scene, ctx) {
  const markers = SHOPS.map((shop) => buildMarker(scene, ctx, shop));
  const takeCash = (amount) => ctx.spendMoney(amount);

  function done(message) {
    ctx.audio["cash"]();
    return { ok: true, message };
  }

  function buy(shopId, itemId) {
    const shop = SHOPS.find((entry) => entry.id === shopId);
    const item = shop
      ? shop.items.find((entry) => entry.id === itemId)
      : null;
    if (!item) return fail("No such item.");
    const arms = ctx.combat.weapons;
    if (itemId === "smg" && arms.smg.owned) {
      return fail("You already own the SMG.");
    }
    // Validate ownership BEFORE taking money: buying ammo for a weapon
    // Vera does not own used to charge and return ok:true (BUG-4).
    if (itemId === "smgAmmo" && !arms.smg.owned) {
      return fail("You don't own an SMG yet — buy the SMG first.");
    }
    if (itemId === "pistolAmmo" && !arms.pistol.owned) {
      return fail("You don't own a pistol.");
    }
    const pack = AMMO_PACKS[itemId];
    if (pack) {
      const [kind, amount] = pack;
      const w = arms[kind];
      const { reserve, reserveMax } = w;
      const room = reserveMax - reserve;
      if (room <= 0) {
        return fail(
          `${w.name} ammo is full (${w.reserve}/${w.reserveMax}) — nothing bought, no charge.`,
        );
      }
      const take = Math.min(amount, room);
      const price = Math.ceil((item.price * take) / amount);
      if (ctx.getMoney() < price) return fail("Not enough cash.");
      takeCash(price);
      ctx.combat.buyAmmo(kind, take);
      return done(
        `Bought ${take} ${w.name} rounds for $${price} (reserve ${w.reserve}/${w.reserveMax}).`,
      );
    }
    // Ammo is sold by the pack but the reserve has a cap: refuse a full
    // reserve outright, otherwise sell only the rounds that fit, at a
    // proportional price (rounded up, never undercharged). Money is only
    // taken for rounds actually received.
    if (ctx.getMoney() < item.price) return fail("Not enough cash.");
    takeCash(item.price);
    if (itemId === "smg") ctx.combat.buyWeapon("smg");
    else if (item.color !== undefined) {
      ctx.player.setJacket(item.color);
    }
    return done(`Bought ${item.name} for $${item.price}.`);
  }

  return { markers, nearestShop, buy };
}

export { SHOPS, createShops };
