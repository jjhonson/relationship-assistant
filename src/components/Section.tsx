export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="mb-4 text-lg font-semibold text-stone-900">{title}</h2>
      {children}
    </section>
  );
}
