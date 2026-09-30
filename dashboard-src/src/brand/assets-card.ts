import { CARD_1 } from "./assets-card-1";
import { CARD_2 } from "./assets-card-2";
import { CARD_3 } from "./assets-card-3";
import { CARD_4 } from "./assets-card-4";
import { CARD_5 } from "./assets-card-5";
import { CARD_6 } from "./assets-card-6";
export const CARD = { ...CARD_1, ...CARD_2, ...CARD_3, ...CARD_4, ...CARD_5, ...CARD_6 } as const;
