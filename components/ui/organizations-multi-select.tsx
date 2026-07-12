export function OrganizationsMultiSelect({
  organizations,
  selectedIds,
  onChange,
  disabled,
}: {
  organizations: { id: string; name: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((existing) => existing !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  if (organizations.length === 0) {
    return <p className="text-sm text-text-tertiary">Nenhuma organização cadastrada.</p>;
  }

  return (
    <div className="flex max-h-48 flex-col gap-2 overflow-y-auto rounded-md border border-border-default p-3">
      {organizations.map((organization) => (
        <label
          key={organization.id}
          className="flex items-center gap-2 text-sm text-text-primary"
        >
          <input
            type="checkbox"
            checked={selectedIds.includes(organization.id)}
            onChange={() => toggle(organization.id)}
            disabled={disabled}
            className="h-4 w-4 rounded border-border-default text-accent-blue focus:ring-accent-blue"
          />
          {organization.name}
        </label>
      ))}
    </div>
  );
}
