import { layout, type Graph, type GNode, type NodeType } from "./graph";

export const NVIDIA_ROOT = "nvidia:provider";
export const NVIDIA_RESOURCES = [
  { id: "models", label: "Models", type: "MODEL" as NodeType, url: "https://build.nvidia.com/models", description: "Modele i endpointy NVIDIA NIM. Wybierz model i sprawdź dostępność API w katalogu dostawcy.", execution: "API u dostawcy · brak aktywnego połączenia w tej scenie", docs: "https://docs.api.nvidia.com/" },
  { id: "blueprints", label: "Blueprints", type: "CODE" as NodeType, url: "https://build.nvidia.com/blueprints", description: "Gotowe architektury aplikacji AI i kod startowy.", execution: "Kod / instrukcja · wymaga osobnego wdrożenia" },
  { id: "playbooks", label: "Playbooks", type: "KNOWLEDGE" as NodeType, url: "https://build.nvidia.com/station", description: "Instrukcje konfiguracji i uruchamiania na DGX Station.", execution: "Instrukcja · wymaga odpowiedniego sprzętu" },
  { id: "launchables", label: "Launchables", type: "CLOUD" as NodeType, url: "https://build.nvidia.com/models", description: "Wybierz model i dostępną opcję uruchomienia w katalogu NVIDIA.", execution: "Uruchomienie u dostawcy · dostępność i koszty ustala dostawca" },
  { id: "skills", label: "Skills", type: "TOOL" as NodeType, url: "https://build.nvidia.com/skills", description: "Oficjalne instrukcje dla agentów; wybór i instalacja odbywają się osobno.", execution: "Instrukcje dla agenta · nie zainstalowano automatycznie" },
] as const;

/** Provider resources are catalogue nodes, never runtime evidence or owned compute. */
export function mergeNvidiaGraph(base: Graph, expanded: boolean): Graph {
  const nodes: GNode[] = [...base.nodes, {
    id: NVIDIA_ROOT, type: "CLOUD", label: "NVIDIA", r: 14, x: 0, y: 0,
    sub: expanded ? "Kliknij, aby zwinąć" : "Kliknij, aby rozwinąć 5 kategorii",
    detail: { identity: NVIDIA_ROOT, kind: "external provider bridge", owner: "NVIDIA", state: "CATALOGUE",
      description: "Zasoby NVIDIA w scenie World. Kliknij obiekt, aby rozwinąć lub zwinąć katalog.",
      execution: "Zewnętrzny dostawca · katalog nie oznacza uruchomionego GPU ani aktywnego API", url: "https://build.nvidia.com/" },
  }];
  const edges = [...base.edges];
  if (base.byId.has("prj")) edges.push({ id: "prj>nvidia:provider", from: "prj", to: NVIDIA_ROOT, kind: "provider catalogue" });
  if (expanded) for (const resource of NVIDIA_RESOURCES) {
    const id = `nvidia:${resource.id}`;
    nodes.push({ id, type: resource.type, label: resource.label, sub: "NVIDIA resource", x: 0, y: 0, r: 9,
      detail: { ...resource, identity: id, kind: "provider resource", owner: "NVIDIA", state: "CATALOGUE" } });
    edges.push({ id: `${NVIDIA_ROOT}>${id}`, from: NVIDIA_ROOT, to: id, kind: "offers" });
  }
  return layout({ nodes, edges, byId: new Map() });
}
