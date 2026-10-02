import type { ThemeDefinition } from "./theme";
import type { Web3Page } from "./data/web3";
import { createContext, useContext } from "react";
import type { Snapshot, Source, Run } from "./data/types";
import type { LayerEnterResult } from "./data/data";
import type { Graph } from "./lib/graph";

import type { BuildPage } from "./build";

export type ViewId = `web3:${Web3Page}` | `build:${BuildPage}` | "home" | "world" | "missions" | "trace" | "proofs" | "replay" | `intel:${string}` | `ops:${string}` | `pending:${string}`;
export interface Ctx {
  data: Snapshot; source: Source; graph: Graph;
  view: ViewId; go: (v: ViewId, opts?: { runId?: string; focus?: string }) => void;
  runId: string; setRunId: (id: string) => void; focus: string | null;
  openPalette: () => void;
  theme: string; activeTheme: ThemeDefinition; themes: ThemeDefinition[]; setTheme: (t: string) => void;
  importTheme: (text: string) => string; removeTheme: (id: string) => void; themeStorageError: boolean;
  runningMission: string | null; actionError: string | null;
  runMission: (missionId: string) => Promise<Run>;
  enterLayer: (layerId: string) => Promise<LayerEnterResult>;
}
export const OsaCtx = createContext<Ctx>(null as unknown as Ctx);
export const useOsa = () => useContext(OsaCtx);
