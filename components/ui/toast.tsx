export function Toast({ message, type }: { message: string; type: "success" | "error" }) {
  const styles =
    type === "success" ? "bg-[#eafaf1] text-[#1a9d5c]" : "bg-[#fdecea] text-[#a52820]";

  return (
    <div
      role="status"
      className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md px-4 py-2 text-sm font-medium shadow-lg ${styles}`}
    >
      {message}
    </div>
  );
}
