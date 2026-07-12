import { VariablesPanel } from '@/components/variables-panel';
import { EffectiveVariables } from '@/components/effective-variables';

export default async function ServiceVariablesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <>
      <section>
        <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">
          Variables
        </h2>
        <p className="text-xs text-(--color-muted) mb-3">
          Service-scoped variables override environment- and project-scoped values of the same
          key. The Effective view below shows what the container actually sees.
        </p>
        <VariablesPanel scope="service" scopeId={id} />
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">
          Effective variables
        </h2>
        <EffectiveVariables serviceId={id} />
      </section>
    </>
  );
}
