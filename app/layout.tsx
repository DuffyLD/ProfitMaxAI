export const metadata = { title: "ProfitMaxAI", description: "AI-native profit engine for Shopify" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="mx-auto max-w-5xl p-6">{children}</div>
      </body>
    </html>
  );
}