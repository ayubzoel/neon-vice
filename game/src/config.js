// Neon Vice — the one shared tuning table for the whole game.
//
// Streets, beach, shops, missions, vehicles, weather and the police all
// read their numbers from here, so a balance tweak means editing this
// file only. The field stays 1200 by 900 metres on purpose: a compact
// map that runs smoothly matters more than a big one.

function keyed(rows, shape) {
  const table = {};
  for (const row of rows) table[row[0]] = shape(row);
  return table;
}

const placeRows = [
  ["plaza", 0, 0, "Plaza"],
  ["ricosBar", 150, 100, "Rico's Bar"],
  ["northMarket", -300, -300, "North Market"],
  ["westDocks", -500, 200, "West Docks"],
  ["eastMarina", 440, 150, "East Marina"],
  ["marinaDock", 465, 150, "Marina Dock"],
  ["southBeach", 100, 400, "South Beach"],
  ["uptown", -400, -350, "Uptown"],
  ["downtown", 300, -300, "Downtown"],
  ["airport", -100, -400, "Airport"],
  ["warehouse", -450, -100, "Warehouse"],
  ["impound", 350, 250, "Police Impound"],
  ["yacht", 440, 0, "Yacht Dock"],
  ["gunShop", -200, -200, "Gun Shop"],
  ["clothShop", 200, -100, "Clothing"],
  ["bank", 300, -280, "Vice Bank"],
  ["safehouse", -400, -330, "Safehouse"],
];

const weaponRows = [
  ["pistol", "Pistol", 34, 12, 120, 60, 0.28, 1.1, 0, 100],
  ["smg", "SMG", 16, 30, 240, 55, 0.09, 1.4, 1500, 150],
];

const colorRows = [
  ["sky", 0x8EC9EE],
  ["fog", 0x9FC6E2],
  ["ground", 0x3A3F46],
  ["gridLine", 0x565D68],
  ["plaza", 0x8A8F98],
  ["pylon", 0x22D3EE],
  ["heroBody", 0x14B8A6],
  ["heroHead", 0xE8B88A],
  ["heroHair", 0x1F2937],
];

const tierRows = [[0, 0], [2, 0], [2, 1], [3, 2], [3, 3], [4, 4]];

const CONFIG = {
  title: "Neon Vice",
  city: "Vice Harbor",
  heroName: "Vera Cruz",
  world: { width: 1200, depth: 900, plazaRadius: 26 },
  spawn: Object.assign({ x: 0, z: 0 }, { heading: 0 }),
  player: { walkSpeed: 6, runSpeed: 11, turnSpeed: 2.6, radius: 0.6 },
  camera: { distance: 9, height: 4.5, lookHeight: 1.6, fov: 60, near: 0.1, far: 2500 },
  colors: Object.fromEntries(colorRows),
  money: { start: 25 * 10, debt: 50 * 1000 },
  weapons: keyed(weaponRows, (r) => ({
    name: r[1], damage: r[2], magSize: r[3], reserveMax: r[4], range: r[5],
    fireInterval: r[6], reloadTime: r[7], price: r[8], ammoPrice: r[9],
  })),
  places: keyed(placeRows, (r) => ({ x: r[1], z: r[2], name: r[3] })),
  water: { z0: -450, z1: 450, x0: 470, x1: 600 },
  weather: { startHour: 7, dayLengthSec: 600, rainChance: 0.25 },
  wanted: { // police tiers, escape timer per star
    max: 5,
    sightRange: 7 * 10,
    escapeSeconds: Object.fromEntries([[1, 5], [2, 6], [3, 12], [4, 16], [5, 20]]),
    tiers: tierRows.map(([foot, cars]) => ({ foot, cars })),
  },
};

export { CONFIG };
