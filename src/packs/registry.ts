// The cams the site shows. To add one: put its memes in public/memes/<id>/,
// list them in public/memes/manifest.json, write src/packs/<id>.ts, and add it here.
import cat from "./cat";
import chiikawa from "./chiikawa";
import hamster from "./hamster";
import jigglypuff from "./jigglypuff";
import monke from "./monke";
import piplup from "./piplup";
import type { Pack } from "./types";

export const CAMS: Pack[] = [cat, hamster, monke, piplup, jigglypuff, chiikawa];

/** Meme sets with no detector yet: shown as galleries, and usable in "Make your own". */
export const COMING_SOON = [
  { id: "rowlett", name: "Rowlett", cover: "rowlett.webp" },
  { id: "dog", name: "Dog", cover: "neutral.jpg" },
  { id: "pokemon", name: "Pokémon", cover: "laugh pika.jpg" },
];

export const findCam = (id: string): Pack | undefined => CAMS.find((c) => c.id === id);
