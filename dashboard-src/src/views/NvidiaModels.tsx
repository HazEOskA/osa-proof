import NvidiaChat from "../ui/NvidiaChat";
export default function NvidiaModels() {
  return <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
    <div><h2 className="text-xl font-semibold">Modele NVIDIA</h2><p className="mt-2 text-dim">Skonfiguruj API, dodaj model i rozpocznij rozmowę.</p></div>
    <a href="https://build.nvidia.com/models" target="_blank" rel="noopener noreferrer" className="focus-ring inline-block rounded border border-line px-4 py-3">Otwórz katalog modeli NVIDIA ↗</a>
    <div className="rounded-lg border border-line bg-panel p-4"><NvidiaChat /></div>
  </div>;
}
