export const metadata = {
  title: "SmartDocs — RAG over PDFs",
  description: "Upload PDFs and ask questions with citations (Jina + OpenRouter).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "Inter, system-ui, Arial", background: "#f8fafc" }}>
        {children}
      </body>
    </html>
  );
}
