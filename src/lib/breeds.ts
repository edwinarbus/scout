/**
 * Short, plain-language notes on common shelter-dog breeds — shown in a tooltip
 * when hovering a dog's breed. Not a rigorous breed standard; a friendly gist
 * of temperament + care so an adopter knows roughly what to expect. Mixes are
 * matched loosely by substring (breed strings are messy: "terrier mix",
 * "chihuahua / short coat", "shepherd, german").
 */

export interface BreedInfo {
  name: string;
  blurb: string;
}

// Ordered most-specific → most-generic; first substring match wins.
const BREEDS: Array<{ keys: string[]; info: BreedInfo }> = [
  { keys: ["german shepherd", "gsd"], info: { name: "German Shepherd", blurb: "Loyal, smart, and protective. Thrives with training and a job to do; bonds closely and needs real exercise." } },
  { keys: ["australian shepherd", "aussie"], info: { name: "Australian Shepherd", blurb: "Brilliant, high-energy herder. Happiest with lots of activity and mental work — not a couch dog." } },
  { keys: ["australian cattle", "blue heeler", "red heeler", "heeler"], info: { name: "Cattle Dog (Heeler)", blurb: "Tireless, clever herder. Devoted to their person, needs a job and plenty of exercise." } },
  { keys: ["border collie"], info: { name: "Border Collie", blurb: "Possibly the smartest breed — intense focus and endless energy. Needs serious daily work." } },
  { keys: ["labrador", "lab retriever", "lab mix", " lab", "lab"], info: { name: "Labrador Retriever", blurb: "Friendly, eager, and food-motivated. Easygoing family dogs who love activity and water." } },
  { keys: ["golden retriever", "golden"], info: { name: "Golden Retriever", blurb: "Gentle, people-loving, and eager to please. Playful and affectionate; sheds a lot." } },
  { keys: ["poodle", "doodle", "goldendoodle", "labradoodle"], info: { name: "Poodle / Doodle", blurb: "Very smart and trainable with a low-shedding curly coat that needs regular grooming." } },
  { keys: ["pit bull", "pitbull", "pit-bull", "american staffordshire", "staffordshire", "amstaff", "american bully"], info: { name: "Pit Bull–type", blurb: "Affectionate, people-oriented, and strong. Often goofy 'velcro' dogs who adore their humans." } },
  { keys: ["chihuahua"], info: { name: "Chihuahua", blurb: "Tiny, bold, and devoted — usually bonds hard to one person. Loves warmth and laps; can be vocal." } },
  { keys: ["dachshund", "doxie", "wiener"], info: { name: "Dachshund", blurb: "Bold, curious 'wiener dog' with a huge personality. Loves to burrow; mind the long back." } },
  { keys: ["yorkshire", "yorkie"], info: { name: "Yorkshire Terrier", blurb: "Tiny, brave, and affectionate lap dog with a silky, low-shedding coat." } },
  { keys: ["shih tzu", "shih-tzu"], info: { name: "Shih Tzu", blurb: "Affectionate indoor companion with a long coat. Happy on laps; needs regular grooming." } },
  { keys: ["maltese"], info: { name: "Maltese", blurb: "Gentle, playful toy dog with a silky white coat. Loves company and stays close." } },
  { keys: ["pomeranian", "pom"], info: { name: "Pomeranian", blurb: "Fluffy, lively, and confident. Alert and often chatty little watchdogs." } },
  { keys: ["schnauzer"], info: { name: "Schnauzer", blurb: "Alert, spirited, and smart with a wiry beard. Loyal and often good little watchdogs." } },
  { keys: ["shiba"], info: { name: "Shiba Inu", blurb: "Clean, fox-like, and independent. Loyal but strong-willed — a cat-like dog." } },
  { keys: ["husky", "malamute"], info: { name: "Husky / Malamute", blurb: "High-energy, vocal, and independent. Needs lots of exercise and very secure fencing." } },
  { keys: ["beagle"], info: { name: "Beagle", blurb: "Cheerful, food-driven scent hound. Friendly and vocal, and always following its nose." } },
  { keys: ["boxer"], info: { name: "Boxer", blurb: "Playful, muscular, and devoted. Stays puppy-like for years and loves their people." } },
  { keys: ["corgi"], info: { name: "Corgi", blurb: "Smart, sturdy herder on short legs, with a big personality. Can be vocal and bossy." } },
  { keys: ["rottweiler", "rottie"], info: { name: "Rottweiler", blurb: "Confident, loyal guardian. Calm and steady with good training and socializing." } },
  { keys: ["great dane", "mastiff", "great pyrenees", "saint bernard"], info: { name: "Giant breed", blurb: "A gentle giant — usually calm and affectionate indoors despite the impressive size." } },
  { keys: ["catahoula"], info: { name: "Catahoula", blurb: "Athletic, independent working dog. Smart and driven; needs exercise and a confident owner." } },
  { keys: ["jack russell", "rat terrier", "fox terrier"], info: { name: "Working Terrier", blurb: "Small but tireless and clever — bred to hunt, so busy, bold, and always up to something." } },
  { keys: ["pointer", "vizsla", "weimaraner", "brittany"], info: { name: "Pointer / bird dog", blurb: "Athletic, affectionate, and energetic. Bred to run all day — needs a lot of exercise." } },
  { keys: ["hound"], info: { name: "Hound", blurb: "Friendly and nose-driven. Often mellow at home but will follow a scent anywhere." } },
  { keys: ["terrier"], info: { name: "Terrier", blurb: "Feisty, smart, and busy — bred to hunt, so curious and energetic with a stubborn streak." } },
  { keys: ["shepherd"], info: { name: "Shepherd-type", blurb: "Smart, loyal, and driven. Usually happiest with training, exercise, and a purpose." } },
  { keys: ["retriever"], info: { name: "Retriever-type", blurb: "Friendly and eager to please. Playful, social, and usually great with people." } },
];

export function breedInfo(breed: string | null | undefined): BreedInfo | null {
  if (!breed) return null;
  const s = breed.toLowerCase();
  for (const b of BREEDS) {
    if (b.keys.some((k) => s.includes(k))) return b.info;
  }
  return null;
}
