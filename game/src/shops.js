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
      if (ctx.getMoney() < item.price) return { ok: false, message: 'Not enough cash.' };
      if (itemId === 'smg' && ctx.combat.weapons.smg.owned) return { ok: false, message: 'You already own the SMG.' };
      ctx.spendMoney(item.price);
      if (itemId === 'smg') ctx.combat.buyWeapon('smg');
      else if (itemId === 'pistolAmmo') ctx.combat.buyAmmo('pistol', 24);
      else if (itemId === 'smgAmmo') ctx.combat.buyAmmo('smg', 60);
      else if (item.color !== undefined) ctx.player.setJacket(item.color);
      ctx.audio.cash();
      return { ok: true, message: `Bought ${item.name} for $${item.price}.` };
    },
  };
}
