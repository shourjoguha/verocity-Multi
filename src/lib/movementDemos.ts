// Movement -> demo-GIF mapping. Resolves a logged/library movement name to an
// animated demonstration from the Gym Visual exercise set (redistributed via
// github.com/hasaneyldrm/exercises-dataset). Keyed by lowercased movement name,
// the same key the movements table resolves on (Logger.handlePick).
//
// GENERATED + HAND-VERIFIED. 52/63 of the seeded shared movements map to a
// demo (23 exact depictions, 29 close variations); the rest have no usable
// GIF in the set and render a placeholder. To change a mapping, edit the table
// and keep movementDemos.test.ts green.
//
// Assets are named '<datasetId>-<mediaId>' and served statically from
// public/demos/<asset>.gif (animation) and .jpg (180x180 thumbnail). The media
// is Gym Visual's property; DEMO_ATTRIBUTION must render wherever a demo shows.

export interface MovementDemo {
  /** Asset stem: '<datasetId>-<mediaId>'. Maps to public/demos/<asset>.{gif,jpg}. */
  asset: string;
  /** true = the GIF depicts this movement directly; false = a close variation. */
  exact: boolean;
}

/** Static path prefix for demo assets on the Vercel CDN. */
export const DEMO_MEDIA_BASE = '/demos';

/** Attribution required by the Gym Visual license wherever a demo renders. */
export const DEMO_ATTRIBUTION = '© Gym visual — gymvisual.com';

export const demoGifUrl = (asset: string): string => `${DEMO_MEDIA_BASE}/${asset}.gif`;
export const demoThumbUrl = (asset: string): string => `${DEMO_MEDIA_BASE}/${asset}.jpg`;

// Lowercased movement name -> demo. Absence means no demo (render placeholder).
const MOVEMENT_DEMOS: Record<string, MovementDemo> = {
  'alternating lunge': { asset: '3470-kMzUs9Y', exact: false }, // forward lunge (male)
  'back squat': { asset: '1461-DhMl549', exact: true }, // barbell full squat (back pov)
  'banded pull-up': { asset: '0970-r1XNRYB', exact: false }, // band assisted pull-up
  'bench press': { asset: '0025-EIeI8Vf', exact: true }, // barbell bench press
  'bike': { asset: '2138-H1PESYI', exact: false }, // stationary bike run v. 3
  'box jump': { asset: '1374-iPm26QU', exact: false }, // box jump down with one leg stabilization
  'box step-up': { asset: '0114-Kxquu2E', exact: true }, // barbell step-up
  'burpee': { asset: '1160-dK9394r', exact: true }, // burpee
  'chest-to-bar pull-up': { asset: '0652-lBDjFxJ', exact: false }, // pull-up
  'clean': { asset: '0648-SiWCcTN', exact: false }, // power clean
  'clean and jerk': { asset: '0537-vzAxBtt', exact: false }, // kettlebell one arm clean and jerk
  'deadlift': { asset: '0032-ila4NZS', exact: true }, // barbell deadlift
  'double-under': { asset: '2612-e1e76I2', exact: false }, // jump rope
  'dumbbell box step-up': { asset: '0431-aXtJhlg', exact: true }, // dumbbell step-up
  'dumbbell farmers carry': { asset: '2133-qPEzJjA', exact: true }, // farmers walk
  'dumbbell hang power clean': { asset: '0295-7Hg55JG', exact: false }, // dumbbell clean
  'dumbbell hang snatch': { asset: '3888-6pTkI99', exact: false }, // dumbbell one arm snatch
  'dumbbell push press': { asset: '1700-FS63wTN', exact: true }, // dumbbell push press
  'dumbbell-facing burpee': { asset: '1201-0JtKWum', exact: false }, // dumbbell burpee
  'foot-assisted pull-up': { asset: '0017-kiJ4Z2K', exact: false }, // assisted pull-up
  'foot-assisted ring dip': { asset: '0677-ezTvXcr', exact: false }, // ring dips
  'front squat': { asset: '0042-zG0zs85', exact: true }, // barbell front squat
  'hand-elevated push-up': { asset: '0662-I4hDWkc', exact: false }, // push-up
  'hand-release push-up': { asset: '0662-I4hDWkc', exact: false }, // push-up
  'handstand push-up': { asset: '0471-rQxwMxO', exact: true }, // handstand push-up
  'hang power snatch': { asset: '0776-dG5Smob', exact: false }, // snatch pull
  'hanging knee raise': { asset: '0011-03lzqwk', exact: false }, // assisted hanging knee raise
  'jumping pull-up': { asset: '0652-lBDjFxJ', exact: false }, // pull-up
  'knee push-up': { asset: '3211-ZOuKWir', exact: true }, // kneeling push-up (male)
  'low-hang squat snatch': { asset: '0776-dG5Smob', exact: false }, // snatch pull
  'lunge': { asset: '3470-kMzUs9Y', exact: true }, // forward lunge (male)
  'muscle-up': { asset: '0631-yJUHKTn', exact: true }, // muscle up
  'overhead squat': { asset: '0069-gfk9kD4', exact: true }, // barbell overhead squat
  'pike push-up': { asset: '1296-sVvXT5J', exact: false }, // exercise ball pike push up
  'power clean': { asset: '0648-SiWCcTN', exact: true }, // power clean
  'power snatch': { asset: '0776-dG5Smob', exact: false }, // snatch pull
  'pull-up': { asset: '0652-lBDjFxJ', exact: true }, // pull-up
  'push jerk': { asset: '0786-IMRsOCn', exact: false }, // squat jerk
  'push press': { asset: '1700-FS63wTN', exact: false }, // dumbbell push press
  'push-up': { asset: '0662-I4hDWkc', exact: true }, // push-up
  'ring row': { asset: '0808-4OaumBr', exact: false }, // suspended row
  'rope climb': { asset: '0680-yaAxcQr', exact: true }, // rope climb
  'run': { asset: '0685-oLrKqDH', exact: true }, // run
  'sandbag lunge': { asset: '3470-kMzUs9Y', exact: false }, // forward lunge (male)
  'shoulder press': { asset: '0405-znQUdHY', exact: true }, // dumbbell seated shoulder press
  'single-under': { asset: '2612-e1e76I2', exact: false }, // jump rope
  'sit-up': { asset: '0735-Bn6TXyO', exact: true }, // sit-up v. 2
  'ski erg': { asset: '2142-vpQaQkH', exact: true }, // ski ergometer
  'squat clean': { asset: '0648-SiWCcTN', exact: false }, // power clean
  'thruster': { asset: '3305-f7Y9eDZ', exact: true }, // barbell thruster
  'v-up': { asset: '1014-H6ETwO9', exact: false }, // band v-up
  'walkout to push-up': { asset: '1471-ZgsNQ6d', exact: false }, // inchworm
};

/** Resolve a movement name to its demo, or null when none is mapped. */
export function getMovementDemo(name: string): MovementDemo | null {
  return MOVEMENT_DEMOS[name.trim().toLowerCase()] ?? null;
}
