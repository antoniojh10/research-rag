import Uploader from "@/components/Uploader";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Assistent</h1>
        <p className="mt-1 text-zinc-500">Sube imágenes o PDFs y visualízalos al instante.</p>
      </header>
      <Uploader />
    </main>
  );
}
