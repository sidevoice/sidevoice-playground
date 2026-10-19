// The customiser's English names, in one table: every option it shows, by what it is. The bichos engine names its
// parts by id and labels them in Spanish (its data, for the app's own i18n); none of those reach this page's UI.
// Every name here was written for this exploration; where the engine's word was a coined one (a pet name, a made-up
// creature), the English one is ours, not a translation.

/** The slots, as a person would call them, and what each one changes. */
export const SLOTS = {
  top: ["Head top", "Ears, horns, antennae, sprouts"], eyes: ["Eyes", "The eyes and how they look"], mouth: ["Mouth", "Smiles, teeth, beaks"],
  nose: ["Nose", "A nose or a snout"], cheeks: ["Cheeks", "Blush, freckles"], marks: ["Face marks", "Whiskers, masks, stripes on the face"],
  headgear: ["Hat", "Something worn on the head"], earwear: ["Ears gear", "Headphones or earmuffs"], eyewear: ["Glasses", "Glasses, goggles, a moustache"],
  arms: ["Arms", "Arms, paws, wings, fins"], legs: ["Feet", "Feet, paws, wheels, wisps"], tail: ["Tail", "A tail, if any"],
  back: ["Back", "Capes, packs, shells, wings, spines"], pattern: ["Body pattern", "Belly, spots, stripes; up to two"],
  neckwear: ["Neck", "Scarves, ties, collars"], held: ["In hand", "Something to hold"], pins: ["Paper pins", "Brass split pins at the joints"],
};

/** The engine's part batches (its parts files), as the themes their options are grouped under. */
export const THEMES = {
  "core-tops": "Classic", "core-face": "Classic", "core-limbs": "Classic", "core-gear": "Classic", "core-bodies": "Classic",
  "b02-sprouts": "Plants", "b03-faces": "More faces", "b04-mouths": "More faces", "b05-monsters": "Monster", "b06-furry": "Furry",
  "b07-snacks": "Sweets", "b08-birds": "Birds", "b09-gear-head": "Gear", "b10-gear-body": "Gear", "b11-pond-sea": "Pond and sea",
  "b12-bugs-spirits": "Bugs and spirits", "b13-bots": "Robot", "b15-elementals": "Elements",
};

/** Every part, per slot. */
export const PARTS = {
  top: {
    "horns": "Horns", "antenna": "Antenna", "spikes": "Spikes", "ears": "Monster ears", "cat": "Cat ears",
    "fox": "Fox ears", "bunny": "Bunny ears", "bear": "Bear ears", "owl": "Owl tufts", "frog": "Frog eye bumps",
    "sprout": "Sprout", "sprout-single": "Single leaf", "sprout-bud": "Flower bud", "sprout-flower": "Daisy",
    "sprout-seedling": "Seedling", "sprout-vine": "Vine", "leafy-tuft": "Leafy tuft", "clover": "Clover",
    "clover-four": "Four-leaf clover", "tulip": "Tulip", "cactus-flower": "Cactus flower",
    "stem-curl": "Curly stem", "cap-mushroom": "Mushroom cap", "cap-acorn": "Acorn cap",
    "bone-through": "Bone through the head", "bone-clip": "Bone clip", "bone-horns": "Bone horns",
    "horns-nub": "Stubby horns", "horn-uni": "Unicorn horn", "horns-ram": "Ram horns", "antlers": "Antlers",
    "tuft": "Hair tuft", "mohawk": "Mohawk", "ears-long": "Long ears", "drip": "Slime drip",
    "ears-mouse": "Mouse ears", "ears-floppy": "Floppy ears", "ears-pig": "Pig ears", "ears-pointy": "Pointy ears",
    "ears-lop": "Lop ears", "ears-panda": "Panda ears", "butter": "Pat of butter", "caramel": "Caramel",
    "caramel-cherry": "Caramel and cherry", "cherry": "Cherry", "frosting": "Frosting", "pleats": "Paper pleats",
    "eggshell": "Eggshell", "calyx": "Strawberry leaves", "feather-curl": "Curly feather", "crest": "Crest",
    "comb": "Rooster comb", "gills": "Axolotl gills", "eyestalks": "Eye stalks", "casque": "Casque",
    "fin-crown": "Fin crown", "spout": "Water spout", "antennae-bobble": "Bobble antennae",
    "antennae-feather": "Feathery antennae", "antennae-bent": "Bent antennae", "horn-beetle": "Beetle horn",
    "flame": "Flame", "cloud-puffs": "Cloud puffs", "halo": "Halo", "star": "Star", "mane": "Mane",
    "mane-uni": "Unicorn mane", "bolt": "Bolt", "rabbit-ears": "TV aerial", "dish": "Satellite dish",
    "propeller": "Propeller", "chimney": "Chimney", "coil": "Coil", "beacon": "Beacon light", "dials": "Dials",
    "wave": "Wave crest", "rock-crown": "Rock crown", "crystals": "Crystals", "swirl": "Swirl",
    "lightning": "Lightning bolt", "ice-shards": "Ice shards", "leaf-flame": "Leaf flame", "crater": "Crater",
  },
  eyes: {
    "two": "Round", "beady": "Beady", "big": "Big owl eyes", "cyclops": "One eye", "three": "Three eyes",
    "wonky": "Mismatched", "led": "LED screen", "button": "Button", "sparkle": "Sparkly", "sleepy": "Sleepy",
    "wide-set": "Wide apart", "googly": "Googly", "lashes": "With lashes", "hollow": "Hollow", "four": "Four eyes",
    "led-dot": "LED dots", "led-pill": "LED pills", "led-square": "LED squares", "visor": "Visor",
    "lens": "Camera lens", "led-heart": "LED hearts",
  },
  mouth: {
    "smile": "Smile", "fangs": "Fangs", "teeth": "Big teeth", "gap": "Missing tooth", "tongue": "Tongue out",
    "cat": "Cat mouth", "beak": "Beak", "led": "LED mouth", "buck": "Buck teeth", "tusks": "Tusks",
    "fang-single": "One fang", "grin": "Grin", "smirk": "Smirk", "tiny": "Tiny", "stitch": "Stitched",
    "saw": "Zigzag teeth", "wavy": "Wobbly", "pout": "Pout", "beak-small": "Small beak", "bill": "Duck bill",
    "beak-hook": "Hooked beak", "beak-big": "Toucan beak", "led-bar": "LED bar", "grill": "Grille",
    "led-smile": "LED smile",
  },
  arms: {
    "nubs": "Little arms", "leaf": "Leaves", "cactus": "Cactus arms", "noodle": "Noodle arms", "paws": "Paws",
    "mitts": "Mittens", "wing": "Wings", "flipper": "Flippers", "fins": "Fins", "claws": "Claws",
    "tentacle": "Tentacles", "bot": "Robot arms",
  },
  legs: {
    "feet": "Feet", "root": "Roots", "paws": "Paws", "bird": "Bird feet", "webbed": "Webbed feet", "boots": "Boots",
    "tentacles": "Tentacles", "ribbons": "Ribbons", "many": "Many legs", "stick": "Stick legs", "hem": "Ghost hem",
    "wisp": "Wisp", "hover": "Hovering", "wheel": "Unicycle wheel", "wheels": "Wheels", "treads": "Tank treads",
    "springs": "Springs", "puddle": "Puddle", "tornado": "Tornado", "cloud-base": "Cloud",
  },
  tail: {
    "cat": "Cat tail", "fox": "Fox tail", "devil": "Devil tail", "mouse": "Mouse tail", "puff": "Bunny puff",
    "curl": "Piggy curl", "ringed": "Raccoon tail", "squirrel": "Squirrel tail", "feathers": "Tail feathers",
    "lizard": "Lizard tail", "dino": "Dino tail", "spiral": "Chameleon curl", "fishtail": "Fish tail",
    "fluke": "Whale fluke", "stinger": "Stinger", "glow": "Glowing tip", "dragon": "Dragon tail",
    "bolt-tail": "Lightning tail", "ember-tail": "Ember tail",
  },
  back: {
    "spines": "Spines", "quills": "Hedgehog quills", "cape": "Cape", "backpack": "Backpack", "jetpack": "Jetpack",
    "shell-turtle": "Turtle shell", "shell-snail": "Snail shell", "plates": "Dino plates",
    "fin-dorsal": "Shark fin", "wings-bee": "Bee wings", "wings-butterfly": "Butterfly wings",
    "wings-bat": "Bat wings", "wings-angel": "Angel wings", "shell-ladybug": "Ladybird shell",
    "elytra": "Beetle wings", "windup": "Wind-up key", "fuzz": "Fuzz",
  },
  pattern: {
    "belly": "Belly", "spots": "Spots", "stripes": "Stripes", "prickles": "Prickles", "ribs": "Ribs",
    "fur-tips": "Fur tips", "ribcage": "Ribcage", "patch": "Patch", "moon-chest": "Crescent chest",
    "nori": "Nori wrap", "crust": "Crust", "wrapper": "Muffin case", "seeds": "Seeds", "sprinkles": "Sprinkles",
    "crack": "Cracked shell", "tux": "Tuxedo", "grooves": "Grooves", "heart-chest": "Heart chest",
    "scales": "Scales", "bands": "Bands", "segments": "Segments", "rivets": "Rivets", "panel": "Panel",
    "lava-cracks": "Lava cracks", "facets": "Facets", "frost": "Frost", "specks": "Specks",
  },
  cheeks: {
    "blush": "Blush", "freckles": "Freckles", "swirls": "Swirls", "shy-lines": "Shy lines",
    "pouches": "Cheek pouches",
  },
  marks: {
    "whiskers": "Whiskers", "mask": "Bandit mask", "eyepatch": "Panda patches", "face-stripes": "Tiger stripes",
    "face-patch": "Face patch", "forehead-gem": "Forehead gem", "forehead-star": "Forehead star",
    "bandaid": "Plaster",
  },
  nose: {
    "nose": "Nose", "button": "Button nose", "heart": "Heart nose", "snout-pig": "Pig snout",
    "snout-dog": "Dog nose", "muzzle": "Muzzle", "nostrils": "Nostrils", "bulb": "Bulb nose",
  },
  neckwear: {
    "scarf": "Scarf", "bow": "Bow tie", "bell-collar": "Bell collar", "bandana": "Bandana", "necktie": "Tie",
    "lei": "Flower garland", "bib": "Bib", "medal": "Medal",
  },
  headgear: {
    "beanie": "Beanie", "cap": "Cap", "crown": "Crown", "party-hat": "Party hat", "tophat": "Top hat",
    "beret": "Beret", "chef-hat": "Chef's hat", "hardhat": "Hard hat", "bucket": "Bucket hat",
    "xx-bucket-purple": "Bucket hat, purple", "xx-bucket-lime": "Bucket hat, lime",
    "xx-bucket-orange": "Bucket hat, orange", "straw": "Straw hat", "leaf-hat": "Leaf hat",
    "propeller-cap": "Propeller cap", "hairbow": "Hair bow", "flower-clip": "Flower clip",
  },
  earwear: {
    "headphones": "Headphones", "earmuffs": "Earmuffs",
  },
  pins: {
    "pins": "Paper pins",
  },
  eyewear: {
    "glasses": "Glasses", "sunglasses": "Sunglasses", "monocle": "Monocle", "goggles": "Aviator goggles",
    "star-glasses": "Star glasses", "mustache": "Moustache", "visor-glass": "Visor",
  },
  held: {
    "fork": "Fork", "microphone": "Microphone", "flower": "Tulip", "lollipop": "Lollipop", "heart": "Heart",
    "wand": "Magic wand", "mug": "Mug", "balloon": "Balloon", "umbrella-leaf": "Leaf umbrella",
    "fatuo": "Will-o'-the-wisp",
  },
};

/** The creature: a kind (what it is), then that kind's variants (the engine's family members). The theme is the part
 *  batch whose options suit it, shown first in every grid. `fill` slots are ones the kind brings its own part for. */
export const KINDS = [
  { id: "monster", name: "Monster", shelf: "Creatures", theme: "Monster", variants: { "monsters/monster": "Classic", "monsters/flotin": "Floaty",
    "monsters/ciclope": "Cyclops", "monsters/huesitos": "Bones", "monsters/peludo": "Shaggy", "monsters/ogrito": "Ogre", "monsters/pinchito": "Spiky",
    "monsters/babosin": "Slug", "monsters/diablillo": "Imp" } },
  { id: "spirit", name: "Spirit", shelf: "Creatures", theme: "Bugs and spirits", variants: { "spirits/fantasmita": "Ghost", "spirits/nubecita": "Cloud",
    "spirits/dragoncito": "Little dragon", "spirits/poni": "Pony", "spirits/yeti": "Yeti", "spirits/kodama": "Kodama", "spirits/estrellita": "Star" } },
  { id: "element", name: "Element", shelf: "Creatures", theme: "Elements", variants: { "elementals/llamita": "Flame", "elementals/olita": "Wave",
    "pond/gotita": "Droplet", "elementals/pedrusco": "Rock", "elementals/cuarzo": "Quartz", "elementals/remolino": "Whirlwind",
    "elementals/chispita": "Spark", "elementals/copito": "Snowflake", "elementals/hojarasca": "Leaf pile", "elementals/magmita": "Magma",
    "elementals/hollin": "Soot" } },
  { id: "cat", name: "Cat", shelf: "Animals", theme: "Furry", variants: { "furry/cat": "Classic", "furry/gato-largo": "Long cat" } },
  { id: "fox", name: "Fox", shelf: "Animals", theme: "Furry", variants: { "furry/fox": "Classic" } },
  { id: "bunny", name: "Bunny", shelf: "Animals", theme: "Furry", variants: { "furry/bunny": "Classic" } },
  { id: "bear", name: "Bear", shelf: "Animals", theme: "Furry", variants: { "furry/bear": "Classic", "furry/oso-panzon": "Chubby",
    "furry/oso-luna": "Moon bear", "furry/panda": "Panda" } },
  { id: "critter", name: "Small critter", shelf: "Animals", theme: "Furry", variants: { "furry/raton": "Mouse", "furry/perrito": "Puppy",
    "furry/mapache": "Raccoon", "furry/cerdito": "Piglet", "furry/erizo": "Hedgehog" } },
  { id: "owl", name: "Owl", shelf: "Animals", theme: "Birds", variants: { "birds/owl": "Classic", "birds/mochuelo": "Little owl" } },
  { id: "bird", name: "Bird", shelf: "Animals", theme: "Birds", variants: { "birds/pollito": "Chick", "birds/gallinita": "Hen", "birds/pinguino": "Penguin",
    "birds/patito": "Duckling", "birds/loro": "Parrot", "birds/tucan": "Toucan" } },
  { id: "frog", name: "Frog", shelf: "Animals", theme: "Pond and sea", variants: { "pond/frog": "Classic" } },
  { id: "pond", name: "Pond critter", shelf: "Animals", theme: "Pond and sea", variants: { "pond/ajolote": "Axolotl", "pond/triton": "Newt",
    "pond/tortuga": "Turtle", "pond/caracol": "Snail", "pond/dinosaurito": "Little dino", "pond/camaleon": "Chameleon" } },
  { id: "sea", name: "Sea creature", shelf: "Animals", theme: "Pond and sea", variants: { "sea/pececito": "Fish", "sea/pez-globo": "Pufferfish",
    "sea/tiburoncin": "Little shark", "sea/pulpito": "Octopus", "sea/medusa": "Jellyfish", "sea/cangrejo": "Crab", "sea/ballenita": "Whale",
    "sea/foquita": "Seal" } },
  { id: "bug", name: "Bug", shelf: "Animals", theme: "Bugs and spirits", variants: { "bugs/mariquita": "Ladybird", "bugs/abejita": "Bee",
    "bugs/oruga": "Caterpillar", "bugs/polilla": "Moth", "bugs/luciernaga": "Firefly", "bugs/escarabajo": "Beetle", "bugs/hormiguita": "Ant" } },
  { id: "robot", name: "Robot", shelf: "Things", theme: "Robot", variants: { "bots/robot": "Classic", "bots/latita": "Tin can", "bots/tele": "TV",
    "bots/dron": "Drone", "bots/orbe": "Orb", "bots/calderita": "Boiler", "bots/cabezon": "Big head", "bots/cupula": "Dome" } },
  { id: "plant", name: "Plant", shelf: "Things", theme: "Plants", variants: { "sprouts/brotecito": "Sprout", "sprouts/rabanito": "Radish",
    "sprouts/setita": "Mushroom", "sprouts/bellota": "Acorn", "sprouts/cactus": "Cactus", "sprouts/capullo": "Bud", "sprouts/trebol": "Clover",
    "sprouts/calabacita": "Pumpkin" } },
  { id: "snack", name: "Snack", shelf: "Things", theme: "Sweets", variants: { "snacks/onigiri": "Rice ball", "snacks/tostada": "Toast",
    "snacks/mochi": "Mochi", "snacks/fresita": "Strawberry", "snacks/empanadilla": "Dumpling", "snacks/flan": "Flan", "snacks/magdalena": "Muffin",
    "snacks/huevito": "Egg" } },
];
/** The kind and variant of an engine member ("family/id"). */
export function kindOf(memberKey) {
  for (const kind of KINDS) if (memberKey in kind.variants) return { kind, variant: kind.variants[memberKey] };
  return null;
}

export const BODIES = { blob: "Blob", round: "Round", wide: "Wide", tall: "Tall", box: "Box", pear: "Pear", drop: "Drop", tri: "Triangle", dome: "Bell",
  pill: "Capsule", can: "Can", tv: "TV set", orb: "Orb", stack: "Big head", domehead: "Dome head" };
export const COATS = { mostaza: "Mustard", terracota: "Terracotta", "verde azulado": "Teal", salvia: "Sage", ciruela: "Plum", "añil": "Indigo",
  frambuesa: "Raspberry", naranja: "Orange", lima: "Lime", cielo: "Sky", chicle: "Bubblegum", nube: "Cloud" };
export const BACKDROPS = { tone: "Its colour", plain: "Plain", sunset: "Sunset", lagoon: "Lagoon", mountains: "Mountains", beach: "Beach", city: "City",
  space: "Space", forest: "Forest", room: "Room", clouds: "Clouds", night: "Night", underwater: "Underwater", candy: "Candy land", aurora: "Aurora",
  bookshelf: "Bookshelf", meadow: "Meadow", flat: "Flat colour", fade: "Fade", duo: "Two-tone" };
export const DESKS = { wood: "Wood", oak: "Light oak", white: "White", pink: "Pastel pink", mint: "Mint", navy: "Navy", steel: "Steel" };
export const DESK_PROPS = { plant: "Plant", mug: "Mug", lamp: "Lamp", books: "Books", cactus: "Cactus", duck: "Rubber duck", clock: "Clock", notes: "Sticky notes" };
export const WORKS = { crank: "Crank", hammer: "Hammer", read: "Book", type: "Laptop" };
export const IDLES = { quiet: "Resting", juggle: "Juggling", soup: "Soup", water: "Watering", fish: "Fishing", bubbles: "Bubbles", music: "Music",
  stretch: "Stretching", nap: "Nap" };
