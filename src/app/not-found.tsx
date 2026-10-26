import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-bold">Contact not found</h1>
      <Link href="/" className="mt-4 inline-block text-indigo-700 hover:underline">
        Back to Your Relationships
      </Link>
    </div>
  );
}
