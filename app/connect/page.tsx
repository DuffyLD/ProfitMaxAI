export default function ConnectPage() {
  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-semibold">Connect your Shopify store</h1>
      <p className="opacity-80">OAuth coming next. For now this is a placeholder.</p>
      <a
        className="inline-block rounded-md bg-white/10 px-3 py-2"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          alert("Shopify OAuth wiring is next — this button will start the auth flow.");
        }}
      >
        Start OAuth
      </a>
    </main>
  );
}