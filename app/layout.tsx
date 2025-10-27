export const metadata = { title: "SmartDocs Q&A — RAG over PDFs", description: "Upload PDFs and ask questions with cited answers." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'Inter, system-ui, Arial', background:'#f8fafc' }}>{children}</body>
    </html>
  );
}
