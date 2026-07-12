export function ErrorMessage({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-[#fbe3e1] bg-[#fdecea] px-4 py-6 text-center">
      <p className="text-sm text-[#a52820]">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-sm font-medium text-accent-blue hover:underline"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}
