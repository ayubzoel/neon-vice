// Neon Vice — Builder C: shops.
// Gun shop (buy the SMG + ammo) and clothing shop (recolour Vera's jacket).
// Open with E near a shop marker; the DOM panel is owned by ui.js, this
// module owns the catalogue, the money check and the effect.

import { CONFIG } from './config.js';

export const SHOPS = [
  {
    id: 'gun', name: 'Ammo-Nation', x: CONFIG.places.gunShop.x, z: CONFIG.places.gunShop.z,
    items: [
      { id: 'smg', name: 'SMG', price: CONFIG.weapons.smg.price, desc: 'Rapid fire, 30-round mag' },
      { id: 'pistolAmmo', name: 'Pistol ammo ×24', price: CONFIG.weapons.pistol.ammoPrice, desc: '+24 pistol rounds' },
      { id: 'smgAmmo', name: 'SMG ammo ×60', price: CONFIG.weapons.smg.ammoPrice, desc: '+60 SMG rounds' },
    ],
  },
  {
    id: 'cloth', name: 'Vice Threads', x: CONFIG.places.clothShop.x, z: CONFIG.places.clothShop.z,
    items: [
      { id: 'jacketTeal', name: 'Teal jacket', price: 0, color: 0x14b8a6, desc: 'Vera\'s classic teal' },
      { id: 'jacketPink', name: 'Pink jacket', price: 200, color: 0xec4899, desc: 'Neon pink' },
      { id: 'jacketGold', name: 'Gold jacket', price: 200, color: 0xf59e0b, desc: 'Vice gold' },
      { id: 'jacketPurple', name: 'Purple jacket', price: 200, color: 0x8b5cf6, desc: 'Night purple' },
    ],
  },
];

export function createShops(scene, ctx) {
  // Visible shop markers: a small kiosk box + floating sign colour.
  // Shop spots are snapped to open ground (B's city has buildings in block
  // interiors) so the kiosk never lands inside a footprint.
  const markers = [];
  for (const shop of SHOPS) {
    let sx = shop.x;
    let sz = shop.z;
    try {
      const g = ctx.world && ctx.world.findOpenGround ? ctx.world.findOpenGround(shop.x, shop.z, 40) : null;
      if (g) { sx = g.x; sz = g.z; }
    } catch { /* keep raw */ }
    shop.x = sx;
    shop.z = sz;
    const color = shop.id === 'gun' ? 0xef4444 : 0xec4899;
    const kiosk = new THREE.Mesh(
      new THREE.BoxGeometry(6, 4, 5),
      new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6 }),
    );
    kiosk.position.set(shop.x, 2, shop.z);
    scene.add(kiosk);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(6.4, 1, 0.4),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9 }),
    );
    sign.position.set(shop.x, 4.6, shop.z);
    scene.add(sign);
    markers.push({ shop, kiosk, sign });
  }

  return {
    markers,
    nearestShop(x, z, maxDist = 12) {
      let best = null;
      let bestD = maxDist;
      for (const shop of SHOPS) {
        const d = Math.hypot(shop.x - x, shop.z - z);
        if (d < bestD) {
          bestD = d;
          best = shop;
        }
      }
      return best;
    },
    // Returns {ok, message}. Money is only taken on success.
    buy(shopId, itemId) {
      const shop = SHOPS.find((s) => s.id === shopId);
      const item = shop && shop.items.find((i) => i.id === itemId);
      if (!item) return { ok: false, message: 'No such item.' };
      if (itemId === 'smg' && ctx.combat.weapons.smg.owned) return { ok: false, message: 'You already own the SMG.' };
      // BUG-4: validate ownership BEFORE taking money. Buying ammo for a
      // weapon Vera does not own used to charge $150 and return ok:true.
      if (itemId === 'smgAmmo' && !ctx.combat.weapons.smg.owned) return { ok: false, message: 'You don\'t own an SMG yet — buy the SMG first.' };
      if (itemId === 'pistolAmmo' && !ctx.combat.weapons.pistol.owned) return { ok: false, message: 'You don\'t own a pistol.' };
      // Ammo is sold by the pack but the reserve has a cap: buying a full
      // pack at a full reserve used to charge $150 for +0 rounds. Refuse a
      // full reserve outright; otherwise sell only the rounds that fit, at
      // a proportional price (rounded up, never undercharged). Money is
      // only taken for rounds actually received.
      const ammoPack = { pistolAmmo: { kind: 'pistol', amount: 24 }, smgAmmo: { kind: 'smg', amount: 60 } }[itemId];
      if (ammoPack) {
        const w = ctx.combat.weapons[ammoPack.kind];
        const room = w.reserveMax - w.reserve;
        if (room <= 0) return { ok: false, message: `${w.name} ammo is full (${w.reserve}/${w.reserveMax}) — nothing bought, no charge.` };
        const take = Math.min(ammoPack.amount, room);
        const price = Math.ceil((item.price * take) / ammoPack.amount);
        if (ctx.getMoney() < price) return { ok: false, message: 'Not enough cash.' };
        ctx.spendMoney(price);
        ctx.combat.buyAmmo(ammoPack.kind, take);
        ctx.audio.cash();
        return { ok: true, message: `Bought ${take} ${w.name} rounds for $${price} (reserve ${w.reserve}/${w.reserveMax}).` };
      }
      if (ctx.getMoney() < item.price) return { ok: false, message: 'Not enough cash.' };
      ctx.spendMoney(item.price);
      if (itemId === 'smg') ctx.combat.buyWeapon('smg');
      else if (item.color !== undefined) ctx.player.setJacket(item.color);
      ctx.audio.cash();
      return { ok: true, message: `Bought ${item.name} for $${item.price}.` };
    },
  };
}
