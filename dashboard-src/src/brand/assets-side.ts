import { SIDE_1 } from "./assets-side-1";
import { SIDE_2 } from "./assets-side-2";
import { SIDE_3 } from "./assets-side-3";
import { SIDE_4 } from "./assets-side-4";
export const SIDE = { ...SIDE_1, ...SIDE_2, ...SIDE_3, ...SIDE_4 } as const;
